import { createHash, createPublicKey, type JsonWebKeyInput, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const config = loadConfig({
  MCP_SIGNING_KEY: generateKeyPairSync("ed25519").privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  AUTH_SECRET: "x".repeat(32),
  GOOGLE_CLIENT_ID: "google-client-id",
});

const base = config.publicUrl;
const resource = `${base}/mcp`;
const redirectUri = "http://localhost:9999/callback";
const clientId = "test-client";

const ana: Identity = { apiUserId: 7, email: "ana@example.com", emailVerified: true, name: "Ana Lopez", imageUrl: null };

// The API is the only judge of credentials; this stands in for it.
let known: Record<string, { password: string; who: Identity }>;
const identity: IdentityProvider = {
  async password(email, password) {
    if (email === "down@example.com") throw new IdentityUnavailableError();
    const u = known[email];
    if (!u || u.password !== password) throw new InvalidCredentialsError();
    return u.who;
  },
  async google(code) {
    if (code !== "good-code") throw new InvalidCredentialsError();
    return ana;
  },
};

const db = openLocal(":memory:");
let auth: Auth;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const options = authOptions(config, db);
  await migrate(options);
  auth = createAuth(options);
  app = createApp({ config, auth, identity });
  // A public client that skips the consent screen (its page is a separate piece).
  const ctx = await auth.$context;
  await ctx.adapter.create({
    model: "oauthClient",
    data: {
      clientId,
      name: "Test client",
      redirectUris: [redirectUri],
      public: true,
      skipConsent: true,
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
  expect(
    db.prepare("select 1 from mcp_oauth_resource where identifier = ?").get(resource),
    "the MCP resource is registered by the mcp() plugin",
  ).toBeTruthy();
  await ctx.adapter.create({
    model: "oauthClientResource",
    data: { clientId, resourceId: resource, createdAt: new Date() },
  });
});
afterAll(() => db.close());
beforeEach(() => {
  known = { "ana@example.com": { password: "s3cret", who: ana } };
});

const req = (path: string, init?: RequestInit) => app.request(`${base}${path}`, { redirect: "manual", ...init });
const origin = { origin: new URL(base).origin };

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

function authorizeUrl(challenge: string, scope = "mcp:read") {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    state: "xyz",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });
  return `/api/auth/oauth2/authorize?${q}`;
}

/** Runs authorize -> sign-in page, returning the signed query the page carries. */
async function startFlow(challenge: string) {
  const res = await req(authorizeUrl(challenge));
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("location")!, base);
  expect(location.pathname, location.href).toBe("/sign-in");
  return location.search.slice(1);
}

const form = (fields: Record<string, string>) => ({
  method: "POST",
  headers: { ...origin, "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields),
});

const cookieOf = (res: Response) =>
  res
    .headers.getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

function jwtParts(token: string) {
  const [h, p, s] = token.split(".") as [string, string, string];
  return { header: JSON.parse(Buffer.from(h, "base64url").toString()), payload: JSON.parse(Buffer.from(p, "base64url").toString()), signed: `${h}.${p}`, sig: Buffer.from(s, "base64url") };
}

describe("sign-in through the API", () => {
  it("runs the whole flow: authorize, sign in, code, token bound to the API user", async () => {
    const { verifier, challenge } = pkce();
    const query = await startFlow(challenge);

    const page = await req(`/sign-in?${query}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('name="email"');
    expect(html).toContain("Continue with Google");
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(page.headers.get("cache-control")).toBe("no-store");

    const signIn = await req("/sign-in", form({ oauth_query: query, email: "Ana@Example.com", password: "s3cret" }));
    expect(signIn.status).toBe(303);
    const cookie = cookieOf(signIn);
    expect(cookie).toContain("session_token");
    expect(signIn.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(signIn.headers.get("location")).toBe(`/api/auth/oauth2/authorize?${query}`);

    const resumed = await req(signIn.headers.get("location")!, { headers: { cookie } });
    expect(resumed.status).toBe(302);
    const back = new URL(resumed.headers.get("location")!);
    expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;
    expect(code).toBeTruthy();

    const token = await req("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    });
    expect(token.status).toBe(200);
    const body = (await token.json()) as { access_token: string; token_type: string };
    expect(body.token_type.toLowerCase()).toBe("bearer");

    const { header, payload, signed, sig } = jwtParts(body.access_token);
    expect(header.alg).toBe("EdDSA");
    expect(payload.iss).toBe(`${base}/api/auth`);
    expect([payload.aud].flat()).toContain(resource);
    expect(payload.api_user_id).toBe(7);
    expect(payload.scope).toContain("mcp:read");

    const jwks = (await (await req("/api/auth/jwks")).json()) as { keys: (JsonWebKeyInput["key"] & { kid: string })[] };
    const jwk = jwks.keys.find((k) => k.kid === header.kid)!;
    expect(verify(null, Buffer.from(signed), createPublicKey({ key: jwk, format: "jwk" }), sig)).toBe(true);
  });

  it("refuses a wrong password without starting a session", async () => {
    const query = await startFlow(pkce().challenge);
    const res = await req("/sign-in", form({ oauth_query: query, email: "ana@example.com", password: "nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(await res.text()).toContain("Incorrect email or password.");
  });

  it("refuses a form posted from another origin", async () => {
    const query = await startFlow(pkce().challenge);
    const bad = form({ oauth_query: query, email: "ana@example.com", password: "s3cret" });
    for (const headers of [{ origin: "https://evil.example" }, {}]) {
      const res = await req("/sign-in", { ...bad, headers: { ...headers, "content-type": "application/x-www-form-urlencoded" } });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });

  it("never sends the code to a redirect_uri the client did not register", async () => {
    const query = new URLSearchParams(await startFlow(pkce().challenge));
    query.set("redirect_uri", "https://evil.example/cb");
    const signIn = await req("/sign-in", form({ oauth_query: query.toString(), email: "ana@example.com", password: "s3cret" }));
    // The form only ever resumes on this server's authorize endpoint: no open redirect.
    expect(signIn.headers.get("location")).toMatch(/^\/api\/auth\/oauth2\/authorize\?/);
    const resumed = await req(signIn.headers.get("location")!, { headers: { cookie: cookieOf(signIn) } });
    const next = resumed.headers.get("location");
    expect(next === null || !next.startsWith("https://evil.example")).toBe(true);
    expect(next ?? "").not.toContain("code=");
  });

  it("shows no form without a signed authorization request", async () => {
    const res = await req("/sign-in");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain('name="password"');
    expect(html).toContain("missing or expired");
    const post = await req("/sign-in", form({ email: "ana@example.com", password: "s3cret" }));
    expect(post.status).toBe(200);
    expect(post.headers.getSetCookie()).toEqual([]);
  });

  it("signs in with Google", async () => {
    const query = await startFlow(pkce().challenge);
    const post = (code: string) =>
      req("/sign-in/google", {
        method: "POST",
        headers: { ...origin, "content-type": "application/json" },
        body: JSON.stringify({ code, oauth_query: query }),
      });
    const ok = await post("good-code");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ redirect: `/api/auth/oauth2/authorize?${query}` });
    expect(cookieOf(ok)).toContain("session_token");

    const bad = await post("bad-code");
    expect(bad.status).toBe(401);
    expect(bad.headers.getSetCookie()).toEqual([]);

    const crossSite = await req("/sign-in/google", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ code: "good-code", oauth_query: query }),
    });
    expect(crossSite.status).toBe(403);
  });

  it("limits repeated failures on one account and keeps the form usable", async () => {
    const query = await startFlow(pkce().challenge);
    const attempt = () => req("/sign-in", form({ oauth_query: query, email: "victim@example.com", password: "guess" }));
    const responses = [];
    for (let i = 0; i < 10; i++) responses.push(await attempt());
    expect(responses.slice(0, 8).map((r) => r.status)).toEqual(Array(8).fill(401));
    expect(responses.slice(8).map((r) => r.status)).toEqual([429, 429]);

    const limited = responses[8]!;
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const html = await limited.text();
    expect(html).toContain("Too many attempts");
    expect(html).toContain('name="password"');
  });

  it("does not spend attempts on successful sign-ins or on an unreachable API", async () => {
    const query = await startFlow(pkce().challenge);
    for (let i = 0; i < 12; i++) {
      const ok = await req("/sign-in", form({ oauth_query: query, email: "ana@example.com", password: "s3cret" }));
      expect(ok.status).toBe(303);
    }
    for (let i = 0; i < 12; i++) {
      const down = await req("/sign-in", form({ oauth_query: query, email: "down@example.com", password: "x" }));
      expect(down.status).toBe(503);
    }
  });

  it("limits one address that tries many accounts", async () => {
    const isolated = createApp({ config, auth, identity }); // its own counters
    const query = await startFlow(pkce().challenge);
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) {
      const res = await isolated.request(`${base}/sign-in`, {
        redirect: "manual",
        ...form({ oauth_query: query, email: `guess${i}@example.com`, password: "x" }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});

describe("mcp_user mapping", () => {
  const countUsers = () => (db.prepare("select count(*) as n from mcp_user").get() as { n: number }).n;

  async function signInAs(email: string, who: Identity) {
    known[email] = { password: "pw", who };
    const query = await startFlow(pkce().challenge);
    const res = await req("/sign-in", form({ oauth_query: query, email, password: "pw" }));
    expect(res.status).toBe(303);
  }

  it("keeps one row per API user and refreshes its data on the next sign-in", async () => {
    await signInAs("ana@example.com", ana);
    const before = countUsers();
    await signInAs("ana@example.com", { ...ana, name: "Ana L. Lopez" });
    expect(countUsers()).toBe(before);
    const row = db.prepare("select name, user_id from mcp_user where user_id = 7").get() as { name: string; user_id: number };
    expect(row).toEqual({ name: "Ana L. Lopez", user_id: 7 });
  });

  it("replaces a stale row when the email now belongs to a different API user", async () => {
    await signInAs("ana@example.com", ana);
    await signInAs("ana-new@example.com", { ...ana, apiUserId: 8, email: "ana@example.com", name: "Ana Again" });
    const rows = db.prepare("select user_id from mcp_user where email = 'ana@example.com'").all() as { user_id: number }[];
    expect(rows).toEqual([{ user_id: 8 }]);
  });

  it("has no HTTP route to create a session directly", async () => {
    const res = await req("/api/auth/delegated-session", {
      method: "POST",
      headers: { ...origin, "content-type": "application/json" },
      body: JSON.stringify({ apiUserId: 1, email: "x@y.z", emailVerified: true, name: "X" }),
    });
    expect(res.status).toBe(404);
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
