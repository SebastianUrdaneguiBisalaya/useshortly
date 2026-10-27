import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Identity } from '../api/identity.js';
import { createApp } from '../app.js';
import { InvalidCredentialsError } from '../api/identity.js';
import { ana, createHarness, type Harness } from '../test/oauth-harness.js';

let h: Harness;
beforeAll(async () => {
	h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const creds = { email: 'ana@example.com', password: 's3cret' };

describe('sign-in through the API', () => {
	it('runs the whole flow: authorize, sign in, code, token bound to the API user', async () => {
		const { verifier, challenge } = h.pkce();
		const query = await h.startFlow(challenge);

		const page = await h.req(`/sign-in?${query}`);
		expect(page.status).toBe(200);
		const html = await page.text();
		expect(html).toContain('name="email"');
		expect(html).toContain('Continue with Google');
		expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
		expect(page.headers.get('cache-control')).toBe('no-store');

		const signIn = await h.req('/sign-in', h.form({ oauth_query: query, email: 'Ana@Example.com', password: 's3cret' }));
		expect(signIn.status).toBe(303);
		expect(h.cookieOf(signIn)).toContain('session_token');
		expect(signIn.headers.get('set-cookie')).toMatch(/HttpOnly/i);
		expect(signIn.headers.get('location')).toBe(`/api/auth/oauth2/authorize?${query}`);

		const resumed = await h.req(signIn.headers.get('location')!, { headers: { cookie: h.cookieOf(signIn) } });
		expect(resumed.status).toBe(302);
		const back = new URL(resumed.headers.get('location')!);
		expect(back.searchParams.get('state')).toBe('xyz');
		const code = back.searchParams.get('code')!;
		expect(code).toBeTruthy();

		const token = await h.exchange(code, verifier);
		expect(token.status).toBe(200);
		const { access_token, token_type } = (await token.json()) as { access_token: string; token_type: string };
		expect(token_type.toLowerCase()).toBe('bearer');

		const { header, payload } = h.jwtParts(access_token);
		expect(header.alg).toBe('EdDSA');
		expect(payload.iss).toBe(`${h.base}/api/auth`);
		expect([payload.aud].flat()).toContain(h.resource);
		expect(payload.api_user_id).toBe(7);
		expect(payload.scope).toContain('mcp:read');
		expect(await h.signatureIsValid(access_token)).toBe(true);
	});

	it('refuses a wrong password without starting a session', async () => {
		const query = await h.startFlow(h.pkce().challenge);
		const res = await h.req('/sign-in', h.form({ oauth_query: query, email: creds.email, password: 'nope' }));
		expect(res.status).toBe(401);
		expect(res.headers.getSetCookie()).toEqual([]);
		expect(await res.text()).toContain('Incorrect email or password.');
	});

	it('refuses a form posted from another origin', async () => {
		const query = await h.startFlow(h.pkce().challenge);
		const ok = h.form({ oauth_query: query, ...creds });
		for (const headers of [{ origin: 'https://evil.example' }, {}]) {
			const res = await h.req('/sign-in', { ...ok, headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' } });
			expect(res.status).toBe(403);
			expect(res.headers.getSetCookie()).toEqual([]);
		}
	});

	it('never sends the code to a redirect_uri the client did not register', async () => {
		const query = new URLSearchParams(await h.startFlow(h.pkce().challenge));
		query.set('redirect_uri', 'https://evil.example/cb');
		const signIn = await h.req('/sign-in', h.form({ oauth_query: query.toString(), ...creds }));
		// The form only ever resumes on this server's authorize endpoint: no open redirect.
		expect(signIn.headers.get('location')).toMatch(/^\/api\/auth\/oauth2\/authorize\?/);
		const resumed = await h.req(signIn.headers.get('location')!, { headers: { cookie: h.cookieOf(signIn) } });
		const next = resumed.headers.get('location');
		expect(next === null || !next.startsWith('https://evil.example')).toBe(true);
		expect(next ?? '').not.toContain('code=');
	});

	it('shows no form without a signed authorization request', async () => {
		const res = await h.req('/sign-in');
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).not.toContain('name="password"');
		expect(html).toContain('missing or expired');
		const post = await h.req('/sign-in', h.form(creds));
		expect(post.status).toBe(200);
		expect(post.headers.getSetCookie()).toEqual([]);
	});

	it('signs in with Google', async () => {
		const query = await h.startFlow(h.pkce().challenge);
		const post = (code: string) =>
			h.req('/sign-in/google', {
				method: 'POST',
				headers: { ...h.origin, 'content-type': 'application/json' },
				body: JSON.stringify({ code, oauth_query: query }),
			});
		const ok = await post('good-code');
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ redirect: `/api/auth/oauth2/authorize?${query}` });
		expect(h.cookieOf(ok)).toContain('session_token');

		const bad = await post('bad-code');
		expect(bad.status).toBe(401);
		expect(bad.headers.getSetCookie()).toEqual([]);

		const crossSite = await h.req('/sign-in/google', {
			method: 'POST',
			headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
			body: JSON.stringify({ code: 'good-code', oauth_query: query }),
		});
		expect(crossSite.status).toBe(403);
	});

	it('limits repeated failures on one account and keeps the form usable', async () => {
		const query = await h.startFlow(h.pkce().challenge);
		const attempt = () => h.req('/sign-in', h.form({ oauth_query: query, email: 'victim@example.com', password: 'guess' }));
		const responses = [];
		for (let i = 0; i < 10; i++) responses.push(await attempt());
		expect(responses.slice(0, 8).map(r => r.status)).toEqual(Array(8).fill(401));
		expect(responses.slice(8).map(r => r.status)).toEqual([429, 429]);

		const limited = responses[8]!;
		expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
		const html = await limited.text();
		expect(html).toContain('Too many attempts');
		expect(html).toContain('name="password"');
	});

	it('does not spend attempts on successful sign-ins or on an unreachable API', async () => {
		const query = await h.startFlow(h.pkce().challenge);
		for (let i = 0; i < 12; i++) {
			const ok = await h.req('/sign-in', h.form({ oauth_query: query, ...creds }));
			expect(ok.status).toBe(303);
		}
		for (let i = 0; i < 12; i++) {
			const down = await h.req('/sign-in', h.form({ oauth_query: query, email: 'down@example.com', password: 'x' }));
			expect(down.status).toBe(503);
		}
	});

	it('limits one address that tries many accounts', async () => {
		const isolated = createApp({ config: h.config, auth: h.auth, api: h.api, identity: { password: async () => Promise.reject(new InvalidCredentialsError()), google: async () => ana } });
		const query = await h.startFlow(h.pkce().challenge);
		const statuses: number[] = [];
		for (let i = 0; i < 22; i++) {
			const res = await isolated.request(`${h.base}/sign-in`, {
				redirect: 'manual',
				...h.form({ oauth_query: query, email: `guess${i}@example.com`, password: 'x' }),
			});
			statuses.push(res.status);
		}
		expect(statuses.slice(0, 20).every(s => s === 401)).toBe(true);
		expect(statuses.slice(20)).toEqual([429, 429]);
	});
});

describe('mcp_user mapping', () => {
	const countUsers = () => (h.db.prepare('select count(*) as n from mcp_user').get() as { n: number }).n;

	async function signInAs(email: string, who: Identity) {
		h.state.known[email] = { password: 'pw', who };
		const query = await h.startFlow(h.pkce().challenge);
		const res = await h.req('/sign-in', h.form({ oauth_query: query, email, password: 'pw' }));
		expect(res.status).toBe(303);
	}

	it('keeps one row per API user and refreshes its data on the next sign-in', async () => {
		await signInAs('ana@example.com', ana);
		const before = countUsers();
		await signInAs('ana@example.com', { ...ana, name: 'Ana L. Lopez' });
		expect(countUsers()).toBe(before);
		const row = h.db.prepare('select name, user_id from mcp_user where user_id = 7').get() as { name: string; user_id: number };
		expect(row).toEqual({ name: 'Ana L. Lopez', user_id: 7 });
	});

	it('replaces a stale row when the email now belongs to a different API user', async () => {
		await signInAs('ana@example.com', ana);
		await signInAs('ana-new@example.com', { ...ana, apiUserId: 8, email: 'ana@example.com', name: 'Ana Again' });
		const rows = h.db.prepare("select user_id from mcp_user where email = 'ana@example.com'").all() as { user_id: number }[];
		expect(rows).toEqual([{ user_id: 8 }]);
	});

	it('has no HTTP route to create a session directly', async () => {
		const res = await h.req('/api/auth/delegated-session', {
			method: 'POST',
			headers: { ...h.origin, 'content-type': 'application/json' },
			body: JSON.stringify({ apiUserId: 1, email: 'x@y.z', emailVerified: true, name: 'X' }),
		});
		expect(res.status).toBe(404);
		expect(res.headers.getSetCookie()).toEqual([]);
	});
});
