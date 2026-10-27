import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { consentClient, createHarness, redirectUri, type Harness } from "../test/oauth-harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.db.close());
beforeEach(() => {
  h.reset();
  h.db.prepare("delete from mcp_oauth_consent").run(); // every scenario starts without a stored consent
});

const allScopes = "mcp:read mcp:write offline_access";

/** Signs in and lands on the consent screen: its signed query, the session cookie and the PKCE verifier. */
async function toConsent(scope = allScopes) {
  const { verifier, challenge } = h.pkce();
  const query = await h.startFlow(challenge, { client: consentClient, scope });
  const { cookie, resumed } = await h.signInAndResume(query);
  expect(resumed.status).toBe(302);
  const location = new URL(resumed.headers.get("location")!, h.base);
  expect(location.pathname, location.href).toBe("/consent");
  return { verifier, cookie, query: location.search.slice(1) };
}

const decide = (query: string, cookie: string, fields: Record<string, string | string[]>) =>
  h.req("/consent", { ...h.form({ oauth_query: query, ...fields }), headers: { ...h.origin, cookie, "content-type": "application/x-www-form-urlencoded" } });

const grantedScope = async (code: string, verifier: string) => {
  const res = await h.exchange(code, verifier, consentClient);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { access_token: string; refresh_token?: string };
  return { scope: String(h.jwtParts(body.access_token).payload.scope).split(" "), refresh: body.refresh_token };
};

const codeOf = (res: Response) => {
  expect(res.status).toBe(303);
  return new URL(res.headers.get("location")!).searchParams.get("code")!;
};

describe("consent screen", () => {
  it("shows who asks, for what, for which account and where the user returns", async () => {
    const { cookie, query } = await toConsent();
    const page = await h.req(`/consent?${query}`, { headers: { cookie } });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Authorize Example Client");
    expect(html).toContain("client.example");
    expect(html).toContain("ana@example.com");
    expect(html).toContain("View your useshortly data");
    expect(html).toContain("Change your useshortly data");
    expect(html).toContain("Stay connected");
    expect(html).toContain("localhost:9999");
    expect(html.match(/name="scope"/g)).toHaveLength(2); // only mcp:read and mcp:write are a choice
    expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("escapes what the client says about itself", async () => {
    h.db.prepare("update mcp_oauth_client set name = ? where clientId = ?").run("<img src=x onerror=alert(1)>", consentClient);
    try {
      const { cookie, query } = await toConsent();
      const html = await (await h.req(`/consent?${query}`, { headers: { cookie } })).text();
      expect(html).not.toContain("<img src=x");
      expect(html).toContain("&lt;img src=x");
    } finally {
      h.db.prepare("update mcp_oauth_client set name = ? where clientId = ?").run("Example Client", consentClient);
    }
  });

  it("grants every scope on Allow and the token carries them, with a refresh token", async () => {
    const { verifier, cookie, query } = await toConsent();
    const res = await decide(query, cookie, { decision: "allow", scope: ["mcp:read", "mcp:write"] });
    const { scope, refresh } = await grantedScope(codeOf(res), verifier);
    expect(scope).toEqual(expect.arrayContaining(["mcp:read", "mcp:write"]));
    expect(refresh).toBeTruthy();
  });

  it("lets the user narrow the grant by unticking a permission", async () => {
    const { verifier, cookie, query } = await toConsent();
    const res = await decide(query, cookie, { decision: "allow", scope: "mcp:read" });
    const { scope } = await grantedScope(codeOf(res), verifier);
    expect(scope).toContain("mcp:read");
    expect(scope).not.toContain("mcp:write");
  });

  it("ignores a scope the request never asked for", async () => {
    const { verifier, cookie, query } = await toConsent("mcp:read");
    const res = await decide(query, cookie, { decision: "allow", scope: ["mcp:read", "mcp:write"] });
    const { scope } = await grantedScope(codeOf(res), verifier);
    expect(scope).not.toContain("mcp:write");
  });

  it("refuses to allow with nothing ticked", async () => {
    const { cookie, query } = await toConsent();
    const res = await decide(query, cookie, { decision: "allow" });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toContain("Choose at least one permission");
  });

  it("sends access_denied to the client on Deny", async () => {
    const { cookie, query } = await toConsent();
    const res = await decide(query, cookie, { decision: "deny", scope: ["mcp:read", "mcp:write"] });
    expect(res.status).toBe(303);
    const back = new URL(res.headers.get("location")!);
    expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("xyz");
    expect(back.searchParams.get("code")).toBeNull();
  });

  it("remembers an allowed grant: the same request later skips the screen", async () => {
    const first = await toConsent();
    codeOf(await decide(first.query, first.cookie, { decision: "allow", scope: ["mcp:read", "mcp:write"] }));

    const { challenge } = h.pkce();
    const query = await h.startFlow(challenge, { client: consentClient, scope: allScopes });
    const { resumed } = await h.signInAndResume(query);
    expect(new URL(resumed.headers.get("location")!, h.base).searchParams.get("code")).toBeTruthy();
  });
});

describe("consent safeguards", () => {
  it("needs a session", async () => {
    const { query } = await toConsent();
    const page = await h.req(`/consent?${query}`);
    expect(page.status).toBe(401);
    expect(await page.text()).toContain("session ended");
    const post = await h.req("/consent", h.form({ oauth_query: query, decision: "allow", scope: "mcp:read" }));
    expect(post.status).toBe(401);
    expect(post.headers.get("location")).toBeNull();
  });

  it("refuses a decision posted from another origin", async () => {
    const { cookie, query } = await toConsent();
    const res = await h.req("/consent", {
      ...h.form({ oauth_query: query, decision: "allow", scope: "mcp:read" }),
      headers: { origin: "https://evil.example", cookie, "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not grant anything for a request whose signature does not match", async () => {
    const { cookie, query } = await toConsent("mcp:read");
    const forged = new URLSearchParams(query);
    forged.set("scope", "mcp:read mcp:write");
    const res = await decide(forged.toString(), cookie, { decision: "allow", scope: ["mcp:read", "mcp:write"] });
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });

  it("shows nothing without a signed request", async () => {
    const page = await h.req("/consent");
    expect(page.status).toBe(400);
    expect(await page.text()).toContain("invalid or has expired");
  });
});
