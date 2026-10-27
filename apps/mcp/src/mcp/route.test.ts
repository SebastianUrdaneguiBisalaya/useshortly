import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "../test/oauth-harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => {
  h.reset();
  h.apiCalls.length = 0;
});

const rpc = (...a: Parameters<Harness["rpc"]>) => h.rpc(...a);
const result = (res: Response) => h.rpcResult(res);

describe("POST /mcp authentication", () => {
  it("challenges a request without a token and points to the resource metadata", async () => {
    const res = await rpc(null, "tools/list");
    expect(res.status).toBe(401);
    const challenge = res.headers.get("www-authenticate") ?? "";
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`${h.base}/.well-known/oauth-protected-resource`);
    expect(h.apiCalls).toHaveLength(0);
  });

  it("refuses a token that was not issued by this server", async () => {
    const res = await rpc("not-a-token", "tools/list");
    expect(res.status).toBe(401);
    expect(h.apiCalls).toHaveLength(0);
  });

  it("asks for the MCP scope when the token has none", async () => {
    const token = await h.accessToken("offline_access");
    const res = await rpc(token, "tools/list");
    expect(res.status).toBe(403);
    expect(res.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(h.apiCalls).toHaveLength(0);
  });

  it("answers CORS preflight for browser clients and exposes the challenge header", async () => {
    const res = await h.req("/mcp", {
      method: "OPTIONS",
      headers: {
        origin: "https://inspector.example",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type,mcp-protocol-version,x-future-header",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-future-header");
    const post = await rpc(null, "tools/list", {}, { headers: { origin: "https://inspector.example", "content-type": "application/json" } });
    expect(post.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
  });
});

describe("POST /mcp protocol", () => {
  it("lists the tools", async () => {
    const token = await h.accessToken();
    const out = await result(await rpc(token, "tools/list"));
    expect(out.tools.map((t: { name: string }) => t.name)).toContain("whoami");
    const whoami = out.tools.find((t: { name: string }) => t.name === "whoami");
    expect(whoami.annotations.readOnlyHint).toBe(true);
  });

  it("runs whoami for the user behind the token, with a token of its own for the API", async () => {
    const token = await h.accessToken();
    const out = await result(await rpc(token, "tools/call", { name: "whoami", arguments: {} }));
    expect(out.isError).toBeFalsy();
    expect(out.content[0].text).toBe("Signed in as Ana Lopez <ana@example.com> with read-only access.");
    expect(out.structuredContent).toEqual({ id: 7, name: "Ana Lopez", email: "ana@example.com", access: "read" });

    expect(h.apiCalls).toHaveLength(1);
    const call = h.apiCalls[0]!;
    expect(call).toMatchObject({ method: "GET", path: "/me" });
    expect(call.claims).toMatchObject({ iss: "useshortly-mcp", aud: "useshortly-api", sub: "7", scope: "read" });
    // The access token the client sent is never what reaches the API.
    expect(call.token).not.toBe(token);
    expect(JSON.stringify(out)).not.toContain(token);
  });

  it("carries the write scope to the API when the user granted it", async () => {
    const token = await h.accessToken("mcp:read mcp:write");
    const out = await result(await rpc(token, "tools/call", { name: "whoami", arguments: {} }));
    expect(out.content[0].text).toContain("read and write access");
    expect(h.apiCalls[0]!.claims.scope).toBe("write");
  });

  it("reports an API failure as a tool error the model can read", async () => {
    h.apiReplies["GET /me"] = () => Response.json({ error: { code: "unauthorized", message: "invalid token" } }, { status: 401 });
    const token = await h.accessToken();
    const out = await result(await rpc(token, "tools/call", { name: "whoami", arguments: {} }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("reconnect");
  });

  it("reports an unreachable API as a tool error", async () => {
    h.apiReplies["GET /me"] = () => new Response("down", { status: 502 });
    const token = await h.accessToken();
    const out = await result(await rpc(token, "tools/call", { name: "whoami", arguments: {} }));
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toContain("unavailable");
  });

  it("does not serve the 2025 protocol", async () => {
    const token = await h.accessToken();
    const res = await h.req("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } },
      }),
    });
    const body = (await res.json()) as { error?: { message?: string }; result?: unknown };
    expect(body.result).toBeUndefined();
    expect(body.error).toBeTruthy();
    expect(h.apiCalls).toHaveLength(0);
  });

  it("takes POST only", async () => {
    const token = await h.accessToken();
    for (const method of ["GET", "DELETE", "PUT"]) {
      const res = await h.req("/mcp", { method, headers: { authorization: `Bearer ${token}` } });
      expect(res.status, method).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });
});
