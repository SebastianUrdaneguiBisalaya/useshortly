import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify, type JsonWebKeyInput } from "node:crypto";
import { expect } from "vitest";
import {
  IdentityUnavailableError,
  InvalidCredentialsError,
  type Identity,
  type IdentityProvider,
} from "../api/identity.js";
import { createApp } from "../app.js";
import { createAuth, type Auth } from "../auth/auth.js";
import { migrate } from "../auth/migrate.js";
import { authOptions } from "../auth/options.js";
import { loadConfig } from "../config.js";
import { openLocal } from "../db/local.js";

export const ana: Identity = { apiUserId: 7, email: "ana@example.com", emailVerified: true, name: "Ana Lopez", imageUrl: null };

export const redirectUri = "http://localhost:9999/callback";
/** Skips the consent screen. */
export const trustedClient = "test-client";
/** Goes through the consent screen, like any client that identifies itself by metadata document. */
export const consentClient = "https://client.example/metadata.json";

/**
 * A real Better Auth + Hono app on an in-memory database. Only the API is faked: it is the
 * one judge of credentials, so tests set who exists in `known`.
 */
export async function createHarness() {
  const config = loadConfig({
    MCP_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "google-client-id",
  });
  const base = config.publicUrl;
  const resource = `${base}/mcp`;

  const state = { known: {} as Record<string, { password: string; who: Identity }> };
  const reset = () => (state.known = { "ana@example.com": { password: "s3cret", who: ana } });
  reset();

  const identity: IdentityProvider = {
    async password(email, password) {
      if (email === "down@example.com") throw new IdentityUnavailableError();
      const u = state.known[email];
      if (!u || u.password !== password) throw new InvalidCredentialsError();
      return u.who;
    },
    async google(code) {
      if (code !== "good-code") throw new InvalidCredentialsError();
      return ana;
    },
  };

  const db = openLocal(":memory:");
  const options = authOptions(config, db);
  await migrate(options);
  const auth: Auth = createAuth(options);
  const app = createApp({ config, auth, identity });

  const ctx = await auth.$context;
  for (const [clientId, skipConsent] of [
    [trustedClient, true],
    [consentClient, false],
  ] as const) {
    await ctx.adapter.create({
      model: "oauthClient",
      data: {
        clientId,
        name: skipConsent ? "Trusted client" : "Example Client",
        redirectUris: [redirectUri],
        public: true,
        skipConsent,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        scopes: ["mcp:read", "mcp:write", "offline_access"],
        disabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    // What CIMD registration does for a real client: link it to the MCP resource.
    await ctx.adapter.create({ model: "oauthClientResource", data: { clientId, resourceId: resource, createdAt: new Date() } });
  }
  expect(db.prepare("select 1 from mcp_oauth_resource where identifier = ?").get(resource), "mcp() registers the resource").toBeTruthy();

  const req = (path: string, init?: RequestInit) => app.request(`${base}${path}`, { redirect: "manual", ...init });
  const origin = { origin: new URL(base).origin };

  const pkce = () => {
    const verifier = randomBytes(32).toString("base64url");
    return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
  };

  const authorizeUrl = (challenge: string, o: { scope?: string; client?: string } = {}) =>
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      client_id: o.client ?? trustedClient,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: o.scope ?? "mcp:read",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    })}`;

  /** authorize -> the sign-in page, returning the signed query it carries. */
  const startFlow = async (challenge: string, o: { scope?: string; client?: string } = {}) => {
    const res = await req(authorizeUrl(challenge, o));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!, base);
    expect(location.pathname, location.href).toBe("/sign-in");
    return location.search.slice(1);
  };

  const form = (fields: Record<string, string | string[]>) => {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) body.append(k, x);
    return { method: "POST", headers: { ...origin, "content-type": "application/x-www-form-urlencoded" }, body };
  };

  const cookieOf = (res: Response) =>
    res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");

  /** Signs in and follows the resumed authorize request; returns that response and the session cookie. */
  const signInAndResume = async (query: string, email = "ana@example.com", password = "s3cret") => {
    const signIn = await req("/sign-in", form({ oauth_query: query, email, password }));
    expect(signIn.status).toBe(303);
    const cookie = cookieOf(signIn);
    return { cookie, resumed: await req(signIn.headers.get("location")!, { headers: { cookie } }) };
  };

  const exchange = (code: string, verifier: string, client = trustedClient) =>
    req("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: client,
        code_verifier: verifier,
        resource,
      }),
    });

  const jwtParts = (token: string) => {
    const [h, p, s] = token.split(".") as [string, string, string];
    return {
      header: JSON.parse(Buffer.from(h, "base64url").toString()),
      payload: JSON.parse(Buffer.from(p, "base64url").toString()),
      signed: `${h}.${p}`,
      sig: Buffer.from(s, "base64url"),
    };
  };

  /** True when the token's signature checks out against the published JWKS. */
  const signatureIsValid = async (token: string) => {
    const { header, signed, sig } = jwtParts(token);
    const jwks = (await (await req("/api/auth/jwks")).json()) as { keys: (JsonWebKeyInput["key"] & { kid: string })[] };
    const jwk = jwks.keys.find((k) => k.kid === header.kid)!;
    return verify(null, Buffer.from(signed), createPublicKey({ key: jwk, format: "jwk" }), sig);
  };

  return {
    config, base, resource, db, auth, app, state, reset,
    req, origin, pkce, authorizeUrl, startFlow, form, cookieOf, signInAndResume, exchange, jwtParts, signatureIsValid,
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
