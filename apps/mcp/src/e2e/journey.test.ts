import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cimdClient, createHarness, redirectUri, trustedClient, type Harness } from '../test/oauth-harness.js';

/**
 * The whole thing, the way a real MCP client lives it, against the real server (Better Auth, Hono,
 * the MCP handler) on a real port. Only the useshortly API and the internet are simulated.
 */
let h: Harness;
beforeAll(async () => {
	h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => {
	h.reset();
	h.apiCalls.length = 0;
	h.db.prepare('delete from mcp_oauth_consent').run(); // a remembered consent would skip the screen
	h.apiReplies['GET /me'] = () => Response.json({ data: { id: 7, email: 'ana@example.com', email_verified: true, first_name: 'Ana', last_name: 'Lopez' } });
});

const json = async (res: Response) => (await res.json()) as Record<string, any>;
const issuer = () => `${h.base}/api/auth`;

/** Authorizes the CIMD client through sign-in and the consent screen; returns what the client holds afterwards. */
async function authorizeThroughConsent(o: { scope?: string; allow?: string[]; verifierOverride?: string } = {}) {
	const { verifier, challenge } = h.pkce();
	const query = await h.startFlow(challenge, { client: cimdClient, scope: o.scope ?? 'mcp:read mcp:write offline_access' });
	const { cookie, resumed } = await h.signInAndResume(query);
	const consentUrl = new URL(resumed.headers.get('location')!, h.base);
	expect(consentUrl.pathname, consentUrl.href).toBe('/consent');

	const page = await h.req(`/consent?${consentUrl.searchParams}`, { headers: { cookie } });
	expect(page.status).toBe(200);
	const decision = await h.req('/consent', {
		...h.form({ oauth_query: consentUrl.search.slice(1), decision: 'allow', scope: o.allow ?? ['mcp:read', 'mcp:write'] }),
		headers: { ...h.origin, cookie, 'content-type': 'application/x-www-form-urlencoded' },
	});
	expect(decision.status).toBe(303);
	const back = new URL(decision.headers.get('location')!);
	return { verifier, back, code: back.searchParams.get('code') };
}

const tokenRequest = (fields: Record<string, string>) =>
	h.req('/api/auth/oauth2/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields),
	});

describe('a client that only knows the MCP URL', () => {
	it('discovers, authorizes, gets a token, uses a tool, and refreshes', async () => {
		// 1. No token: the 401 says where to look.
		const denied = await h.rpc(null, 'tools/list');
		expect(denied.status).toBe(401);
		const metadataUrl = /resource_metadata="([^"]+)"/.exec(denied.headers.get('www-authenticate') ?? '')?.[1];
		expect(metadataUrl).toBe(`${h.base}/.well-known/oauth-protected-resource/mcp`);

		// 2. Protected resource metadata names the authorization server and the scopes.
		const resourceMeta = await json(await h.req(new URL(metadataUrl!).pathname));
		expect(resourceMeta.resource).toBe(h.resource);
		expect(resourceMeta.authorization_servers).toEqual([issuer()]);

		// 3. Authorization server metadata, at the RFC 8414 location for an issuer with a path.
		const as = await json(await h.req(`/.well-known/oauth-authorization-server${new URL(issuer()).pathname}`));
		expect(as.issuer).toBe(issuer());
		expect(as.code_challenge_methods_supported).toEqual(['S256']);
		expect(as.client_id_metadata_document_supported).toBe(true);
		expect(as.registration_endpoint).toBeUndefined();

		// 4. Sign in through the API, consent, and come back with a code (and the issuer, RFC 9207).
		const { verifier, back, code } = await authorizeThroughConsent();
		expect(code).toBeTruthy();
		expect(back.searchParams.get('state')).toBe('xyz');
		expect(back.searchParams.get('iss')).toBe(issuer());
		expect(`${back.origin}${back.pathname}`).toBe(redirectUri);

		// 5. Exchange the code for tokens.
		const tokens = await json(await h.exchange(code!, verifier, cimdClient));
		expect(tokens.access_token).toBeTruthy();
		expect(tokens.refresh_token).toBeTruthy();
		expect(tokens.expires_in).toBeLessThanOrEqual(15 * 60);
		expect(String(tokens.scope).split(' ')).toEqual(expect.arrayContaining(['mcp:read', 'mcp:write', 'offline_access']));
		const { payload } = h.jwtParts(tokens.access_token);
		expect(payload).toMatchObject({ iss: issuer(), api_user_id: 7 });
		expect([payload.aud].flat()).toContain(h.resource);

		// 6. Use the MCP endpoint: tools of a write connection, and a call that reaches the API as the user.
		const tools = (await h.rpcResult(await h.rpc(tokens.access_token, 'tools/list'))).tools.map((t: { name: string }) => t.name);
		expect(tools).toEqual(expect.arrayContaining(['whoami', 'list_organizations', 'list_links', 'create_link', 'delete_link']));
		const who = await h.callTool(tokens.access_token, 'whoami');
		expect(who.content[0].text).toBe('Signed in as Ana Lopez <ana@example.com> with read and write access.');
		expect(h.apiCalls[0]!.claims).toMatchObject({ iss: 'useshortly-mcp', aud: 'useshortly-api', sub: '7', scope: 'write' });
		expect(h.apiCalls[0]!.token).not.toBe(tokens.access_token);

		// 7. Refresh: a new access token that works, for the same user and scopes.
		const refreshed = await json(await tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id: cimdClient, resource: h.resource }));
		expect(refreshed.access_token).toBeTruthy();
		expect(refreshed.access_token).not.toBe(tokens.access_token);
		expect(h.jwtParts(refreshed.access_token).payload).toMatchObject({ api_user_id: 7 });
		expect((await h.callTool(refreshed.access_token, 'whoami')).isError).toBeFalsy();
	});

	it('holds only the scopes the user left ticked', async () => {
		const { verifier, code } = await authorizeThroughConsent({ allow: ['mcp:read'] });
		const tokens = await json(await h.exchange(code!, verifier, cimdClient));
		const tools = (await h.rpcResult(await h.rpc(tokens.access_token, 'tools/list'))).tools.map((t: { name: string }) => t.name);
		expect(tools).toContain('list_links');
		expect(tools).not.toContain('create_link');
		expect((await h.callTool(tokens.access_token, 'whoami')).content[0].text).toContain('read-only access');
	});
});

describe('what must not work', () => {
	it('does not take an authorization code twice', async () => {
		const { verifier, code } = await authorizeThroughConsent();
		expect((await h.exchange(code!, verifier, cimdClient)).status).toBe(200);
		const again = await h.exchange(code!, verifier, cimdClient);
		expect(again.status).toBeGreaterThanOrEqual(400);
		expect(await again.text()).not.toContain('access_token');
	});

	it('does not take a code with the wrong PKCE verifier', async () => {
		const { code } = await authorizeThroughConsent();
		const res = await h.exchange(code!, h.pkce().verifier, cimdClient);
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(await res.text()).not.toContain('access_token');
	});

	it('does not take a code for a different redirect_uri', async () => {
		const { verifier, code } = await authorizeThroughConsent();
		const res = await h.exchange(code!, verifier, cimdClient, { redirectUri: 'http://localhost:9999/elsewhere' });
		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(await res.text()).not.toContain('access_token');
	});

	it('never issues a code to an authorization request without PKCE', async () => {
		const url = new URL(h.authorizeUrl(h.pkce().challenge, { client: cimdClient }), h.base);
		url.searchParams.delete('code_challenge');
		url.searchParams.delete('code_challenge_method');
		const first = await h.req(`${url.pathname}${url.search}`);
		const location = new URL(first.headers.get('location')!, h.base);
		if (location.pathname === '/sign-in') {
			const { resumed } = await h.signInAndResume(location.search.slice(1));
			expect(resumed.headers.get('location') ?? '').not.toContain('code=');
		} else {
			expect(location.searchParams.get('error')).toBeTruthy();
		}
		expect(location.searchParams.get('code')).toBeNull();
	});

	it('does not accept a token meant for another resource', async () => {
		const other = `${h.base}/other-resource`;
		const ctx = await h.auth.$context;
		await ctx.adapter.create({
			model: 'oauthResource',
			data: { identifier: other, name: 'Other', allowedScopes: ['mcp:read'], disabled: false, createdAt: new Date(), updatedAt: new Date() },
		});
		await ctx.adapter.create({ model: 'oauthClientResource', data: { clientId: trustedClient, resourceId: other, createdAt: new Date() } });

		const token = await h.accessToken('mcp:read', { resource: other });
		expect([h.jwtParts(token).payload.aud].flat()).toContain(other);
		const res = await h.rpc(token, 'tools/list');
		expect(res.status).toBe(401);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('does not accept a token without an MCP scope', async () => {
		const res = await h.rpc(await h.accessToken('offline_access'), 'tools/list');
		expect(res.status).toBe(403);
		expect(res.headers.get('www-authenticate')).toContain('insufficient_scope');
	});

	it('does not accept a tampered token', async () => {
		const token = await h.accessToken('mcp:read');
		const [head, body, sig] = token.split('.') as [string, string, string];
		const forgedBody = Buffer.from(JSON.stringify({ ...h.jwtParts(token).payload, api_user_id: 8 })).toString('base64url');
		for (const bad of [`${head}.${forgedBody}.${sig}`, `${head}.${body}.${sig.slice(0, -2)}AA`, `${head}.${body}.`]) {
			expect((await h.rpc(bad, 'tools/list')).status).toBe(401);
		}
		expect(h.apiCalls).toHaveLength(0);
	});

	it('stops working for a user the API no longer knows', async () => {
		const token = await h.accessToken('mcp:read mcp:write');
		expect((await h.callTool(token, 'whoami')).isError).toBeFalsy();

		// The account is deleted in the API: it refuses the MCP server's token for that user...
		h.apiReplies['GET /me'] = () => Response.json({ error: { code: 'invalid_credentials', message: 'invalid credentials' } }, { status: 401 });
		const out = await h.callTool(token, 'whoami');
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('reconnect');

		// ...and nobody can sign in as them to get a new one.
		delete h.state.known['ana@example.com'];
		const query = await h.startFlow(h.pkce().challenge);
		const signIn = await h.req('/sign-in', h.form({ oauth_query: query, email: 'ana@example.com', password: 's3cret' }));
		expect(signIn.status).toBe(401);
		expect(signIn.headers.getSetCookie()).toEqual([]);
	});
});
