import { describe, expect, it, vi } from "vitest";
import {
  createIdentityClient,
  IdentityUnavailableError,
  InvalidCredentialsError,
  RateLimitedError,
} from "./identity.js";

const apiUser = { id: 7, email: "Ana@Example.com", email_verified: true, first_name: "Ana", last_name: "Lopez" };
const sessionBody = { data: { user: apiUser, token: "jwt", refresh_token: "rft_abc" } };

function fakeApi(login: () => Response) {
  const calls: { url: string; body: any; headers: Headers }[] = [];
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) };
    calls.push(call);
    return call.url.endsWith("/auth/logout") ? new Response(null, { status: 204 }) : login();
  });
  return { calls, client: createIdentityClient({ apiUrl: "http://api.test", fetch: fetchFn as typeof fetch }) };
}

describe("identity client", () => {
  it("maps the API user, lowercases the email and ends the API session it created", async () => {
    const { client, calls } = fakeApi(() => Response.json(sessionBody));
    const identity = await client.password("ana@example.com", "s3cret", "203.0.113.9");
    expect(identity).toEqual({
      apiUserId: 7,
      email: "ana@example.com",
      emailVerified: true,
      name: "Ana Lopez",
      imageUrl: null,
    });
    expect(calls.map((c) => c.url)).toEqual(["http://api.test/api/v1/auth/login", "http://api.test/api/v1/auth/logout"]);
    expect(calls[0]?.body).toEqual({ email: "ana@example.com", password: "s3cret" });
    expect(calls[0]?.headers.get("x-forwarded-for")).toBe("203.0.113.9");
    expect(calls[1]?.body).toEqual({ refresh_token: "rft_abc" });
  });

  it("signs in with a Google code", async () => {
    const { client, calls } = fakeApi(() => Response.json(sessionBody));
    await client.google("4/0AbC");
    expect(calls[0]?.url).toBe("http://api.test/api/v1/auth/google");
    expect(calls[0]?.body).toEqual({ code: "4/0AbC" });
  });

  it.each([400, 401, 403])("treats %i as invalid credentials", async (status) => {
    const { client } = fakeApi(() => new Response("{}", { status }));
    await expect(client.password("a@b.c", "x")).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("reports rate limiting", async () => {
    const { client } = fakeApi(() => new Response("{}", { status: 429 }));
    await expect(client.password("a@b.c", "x")).rejects.toBeInstanceOf(RateLimitedError);
  });

  it.each([
    ["server error", () => new Response("{}", { status: 500 })],
    ["unexpected body", () => Response.json({ data: {} })],
    ["not json", () => new Response("oops", { status: 200 })],
  ])("treats %s as unavailable", async (_name, login) => {
    const { client } = fakeApi(login);
    await expect(client.password("a@b.c", "x")).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("treats a network failure as unavailable", async () => {
    const client = createIdentityClient({
      apiUrl: "http://api.test",
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(client.password("a@b.c", "x")).rejects.toBeInstanceOf(IdentityUnavailableError);
  });

  it("still signs in when revoking the API session fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith("/auth/logout") ? new Response("{}", { status: 500 }) : Response.json(sessionBody),
    );
    const client = createIdentityClient({ apiUrl: "http://api.test", fetch: fetchFn as typeof fetch });
    await expect(client.password("a@b.c", "x")).resolves.toMatchObject({ apiUserId: 7 });
    warn.mockRestore();
  });
});
