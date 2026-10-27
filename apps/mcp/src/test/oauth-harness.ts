import { createHash, createPublicKey, generateKeyPairSync, randomBytes, verify, type JsonWebKeyInput } from "node:crypto";
import { serve } from "@hono/node-server";
import { createServer } from "node:net";
import { expect } from "vitest";
import {
  IdentityUnavailableError,
  InvalidCredentialsError,
  type Identity,
  type IdentityProvider,
} from "../api/identity.js";
import { ApiClient } from "../api/client.js";
import { createApp } from "../app.js";
import { createTokenSigner } from "../api/token.js";
import { createAuth, type Auth } from "../auth/auth.js";
import { migrate } from "../auth/migrate.js";
import { authOptions, type Network } from "../auth/options.js";
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
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** The client whose metadata document the test network serves. */
export const cimdClient = "https://client.example/mcp-client.json";

export async function createHarness() {
  // The server listens on a real port because the access token check fetches its keys over HTTP.
  const port = await freePort();
  const config = loadConfig({
    PORT: String(port),
    MCP_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    AUTH_SECRET: "x".repeat(32),
    GOOGLE_CLIENT_ID: "google-client-id",
  });
  const base = config.publicUrl;
  expect(config.publicUrl, "tests assume the default public URL").toBe("http://localhost:4001");
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

  // The useshortly API, faked: records each call (with the token's claims) and answers from `apiReplies`.
  const apiCalls: { method: string; path: string; token: string; claims: Record<string, unknown>; body?: any }[] = [];
  const apiReplies: Record<string, () => Response> = {};
  const apiFetch = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    const token = String((init?.headers as Record<string, string>).authorization).replace("Bearer ", "");
    const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
    const method = init?.method ?? "GET";
    const path = u.pathname.replace("/api/v1", "") + u.search;
    apiCalls.push({ method, path, token, claims, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = apiReplies[`${method} ${path}`];
    return reply ? reply() : Response.json({ error: { code: "not_found", message: "no such route in the test API" } }, { status: 404 });
  }) as typeof fetch;
  const api = new ApiClient({ apiUrl: "http://api.test", sign: createTokenSigner(config.signingKey), fetch: apiFetch });
  apiReplies["GET /me"] = () =>
    Response.json({ data: { id: 7, email: "ana@example.com", email_verified: true, first_name: "Ana", last_name: "Lopez" } });

  // Client metadata documents (CIMD) are served from here instead of the internet.
  const metadataDocs: Record<string, unknown> = {
    [cimdClient]: {
      client_id: cimdClient,
      client_name: "Journey Client",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "mcp:read mcp:write offline_access",
    },
  };
  const fetchClientMetadataResource = (async (input: string | URL | Request) => {
    const doc = metadataDocs[String(input)];
    return doc ? Response.json(doc, { headers: { "cache-control": "max-age=60" } }) : new Response("not found", { status: 404 });
  }) as Network["fetchClientMetadataResource"];

  const db = openLocal(":memory:");
  const options = authOptions(config, db, { fetchClientMetadataResource });
  await migrate(options);
  const auth: Auth = createAuth(options);
  const app = createApp({ config, auth, identity, api });
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
  const close = async () => {
    server.close();
    db.close();
  };

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

  const authorizeUrl = (challenge: string, o: { scope?: string; client?: string; resource?: string } = {}) =>
    `/api/auth/oauth2/authorize?${new URLSearchParams({
      client_id: o.client ?? trustedClient,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: o.scope ?? "mcp:read",
      state: "xyz",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: o.resource ?? resource,
    })}`;

  /** authorize -> the sign-in page, returning the signed query it carries. */
  const startFlow = async (challenge: string, o: { scope?: string; client?: string; resource?: string } = {}) => {
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

  const exchange = (code: string, verifier: string, client = trustedClient, o: { resource?: string; redirectUri?: string } = {}) =>
    req("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: o.redirectUri ?? redirectUri,
        client_id: client,
        code_verifier: verifier,
        resource: o.resource ?? resource,
      }),
    });

  /** A real access token for the trusted client, obtained through the whole authorization flow. */
  const accessToken = async (scope = "mcp:read", o: { resource?: string } = {}) => {
    const { verifier, challenge } = pkce();
    const query = await startFlow(challenge, { scope, resource: o.resource });
    const { resumed } = await signInAndResume(query);
    const code = new URL(resumed.headers.get("location")!).searchParams.get("code")!;
    const res = await exchange(code, verifier, trustedClient, { resource: o.resource });
    expect(res.status).toBe(200);
    return ((await res.json()) as { access_token: string }).access_token;
  };

  const mcpVersion = "2026-07-28";

  /** A minimal 2026-07-28 client: one JSON-RPC request per POST, with the per-request envelope. */
  const rpc = (token: string | null, method: string, params: Record<string, unknown> = {}, extra: RequestInit = {}) =>
    req("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": mcpVersion,
        // The 2026-07-28 transport repeats the method (and a tool's name) in headers, so a proxy can route on them.
        "mcp-method": method,
        ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": mcpVersion,
            "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
      ...extra,
    });

  /** The JSON-RPC result of a successful call; fails the test on a protocol error. */
  const rpcResult = async (res: Response) => {
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: any; error?: any };
    expect(body.error, JSON.stringify(body.error)).toBeUndefined();
    return body.result;
  };

  /** Calls a tool and returns its result. */
  const callTool = async (token: string, name: string, args: Record<string, unknown> = {}) =>
    rpcResult(await rpc(token, "tools/call", { name, arguments: args }));

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
    config, base, resource, db, auth, app, close, state, reset, api, apiCalls, apiReplies, metadataDocs,
    req, origin, pkce, authorizeUrl, startFlow, form, cookieOf, signInAndResume, exchange, accessToken, rpc, rpcResult, callTool, jwtParts, signatureIsValid,
  };
}

export type Harness = Awaited<ReturnType<typeof createHarness>>;
