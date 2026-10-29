import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { ApiClient, segment } from './client.js';
import { ApiAuthError, ApiForbiddenError, ApiNotFoundError, ApiRateLimitedError, ApiRequestError, ApiUnavailableError } from './errors.js';
import { audience, createTokenSigner, issuer } from './token.js';

const { privateKey } = generateKeyPairSync('ed25519');
const publicKey = createPublicKey(privateKey);
const sign = createTokenSigner(privateKey);

type Seen = { url: URL; init: RequestInit; token: string; claims: Record<string, unknown> };

function setup(reply: (seen: Seen) => Response | Promise<Response>) {
	const calls: Seen[] = [];
	const fetchFn = vi.fn(async (url: URL | string, init?: RequestInit) => {
		const token = String((init?.headers as Record<string, string>).authorization).replace('Bearer ', '');
		const [h, p, s] = token.split('.') as [string, string, string];
		expect(verify(null, Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))).toBe(true);
		const seen = { url: new URL(String(url)), init: init!, token, claims: JSON.parse(Buffer.from(p, 'base64url').toString()) };
		calls.push(seen);
		return reply(seen);
	});
	const client = new ApiClient({ apiUrl: 'http://api.test', sign, fetch: fetchFn as typeof fetch });
	return { calls, api: client.as({ userId: 7, scope: 'write' }) };
}

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);
const apiError = (status: number, code: string, headers?: ResponseInit['headers']) => json({ error: { code, message: `${code} happened` } }, { status, headers });

describe('ApiClient', () => {
	it('signs every call with a fresh token for the principal, and sends no other credential', async () => {
		const { api, calls } = setup(() => json({ data: { id: 1 } }));
		await api.get('/me', z.object({ id: z.number() }));
		await api.get('/me', z.object({ id: z.number() }));
		expect(calls).toHaveLength(2);
		expect(calls[0]!.claims).toMatchObject({ iss: issuer, aud: audience, sub: '7', scope: 'write' });
		expect(calls[0]!.token).not.toBe(calls[1]!.token);
		const headers = calls[0]!.init.headers as Record<string, string>;
		expect(Object.keys(headers).sort()).toEqual(['accept', 'authorization']);
		expect(calls[0]!.init.redirect).toBe('error');
	});

	it('builds the URL under /api/v1 and skips undefined query values', async () => {
		const { api, calls } = setup(() => json({ data: [], meta: { total: 0 } }));
		const res = await api.get(`/orgs/${segment(3)}/links`, z.array(z.unknown()), { query: { limit: 10, offset: undefined, q: 'a b&c' } });
		expect(calls[0]!.url.toString()).toBe('http://api.test/api/v1/orgs/3/links?limit=10&q=a+b%26c');
		expect(res).toEqual({ data: [], meta: { total: 0 } });
	});

	it('posts JSON and returns the validated data', async () => {
		const { api, calls } = setup(() => json({ data: { id: 9, code: 'abc' } }, { status: 201 }));
		const res = await api.post('/orgs/3/links', z.object({ id: z.number(), code: z.string() }), { body: { url: 'https://x.test' } });
		expect(res.data).toEqual({ id: 9, code: 'abc' });
		expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ url: 'https://x.test' });
		expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
	});

	it.each([
		['put', 'PUT'],
		['patch', 'PATCH'],
	] as const)('sends %s as JSON and returns the validated data', async (call, method) => {
		const { api, calls } = setup(() => json({ data: { id: 4 } }));
		const res = await api[call]('/orgs/3/links/4/channel', z.object({ id: z.number() }), { body: { channel_id: 11 } });
		expect(res.data).toEqual({ id: 4 });
		expect(calls[0]!.init.method).toBe(method);
		expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ channel_id: 11 });
		expect((calls[0]!.init.headers as Record<string, string>)['content-type']).toBe('application/json');
	});

	it('deletes with no body in the answer', async () => {
		const { api, calls } = setup(() => new Response(null, { status: 204 }));
		await expect(api.delete('/orgs/3/links/4')).resolves.toBeUndefined();
		expect(calls[0]!.init.method).toBe('DELETE');
	});

	it('returns binary bodies with their type', async () => {
		const png = new Uint8Array([137, 80, 78, 71]);
		const { api } = setup(() => new Response(png, { headers: { 'content-type': 'image/png' } }));
		const { bytes, contentType } = await api.getBytes('/orgs/3/links/4/qr');
		expect([...bytes]).toEqual([...png]);
		expect(contentType).toBe('image/png');
	});

	it.each([
		[401, ApiAuthError],
		[403, ApiForbiddenError],
		[404, ApiNotFoundError],
		[400, ApiRequestError],
		[409, ApiRequestError],
		[422, ApiRequestError],
	])("maps status %i to a typed error carrying the API's code and message", async (status, type) => {
		const { api } = setup(() => apiError(status, 'some_code'));
		const error = await api.get('/x', z.unknown()).catch(e => e);
		expect(error).toBeInstanceOf(type);
		expect(error).toMatchObject({ status, code: 'some_code', message: 'some_code happened' });
	});

	it('reports rate limiting with the wait', async () => {
		const { api } = setup(() => apiError(429, 'rate_limited', { 'retry-after': '12' }));
		const error = await api.get('/x', z.unknown()).catch(e => e);
		expect(error).toBeInstanceOf(ApiRateLimitedError);
		expect(error.retryAfterSeconds).toBe(12);
	});

	it.each([
		['a server error', () => new Response('boom', { status: 500 })],
		['an unreadable reply', () => new Response('not json', { status: 200 })],
		['a reply without the envelope', () => json({ nope: true })],
		['data of the wrong shape', () => json({ data: { id: 'text' } })],
		['an oversized reply', () => new Response(new Uint8Array(3 * 1024 * 1024))],
	])('treats %s as unavailable', async (_name, reply) => {
		const { api } = setup(reply);
		await expect(api.get('/x', z.object({ id: z.number() }))).rejects.toBeInstanceOf(ApiUnavailableError);
	});

	it('treats a network failure or timeout as unavailable', async () => {
		const client = new ApiClient({
			apiUrl: 'http://api.test',
			sign,
			fetch: (async () => {
				throw new TypeError('fetch failed');
			}) as typeof fetch,
		});
		await expect(client.as({ userId: 1, scope: 'read' }).get('/x', z.unknown())).rejects.toBeInstanceOf(ApiUnavailableError);
	});

	it('does not leak the token in an error', async () => {
		const { api, calls } = setup(() => apiError(401, 'unauthorized'));
		const error = await api.get('/x', z.unknown()).catch(e => e);
		expect(JSON.stringify(error) + String(error.stack)).not.toContain(calls[0]!.token);
	});
});

describe('segment', () => {
	it('accepts ids and refuses anything that could change a path', () => {
		expect(segment(12)).toBe('12');
		for (const bad of [0, -3, 1.5, Number.NaN, 2 ** 60]) expect(() => segment(bad)).toThrow('invalid id');
	});
});
