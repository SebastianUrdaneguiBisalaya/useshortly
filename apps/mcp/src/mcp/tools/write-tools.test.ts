import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../../test/oauth-harness.js';

let h: Harness;
let write: string;
let readOnly: string;
beforeAll(async () => {
	h = await createHarness();
	write = await h.accessToken('mcp:read mcp:write');
	readOnly = await h.accessToken('mcp:read');
});
afterAll(() => h.close());
beforeEach(() => {
	h.reset();
	h.apiCalls.length = 0;
});

const created =
	(extra: Record<string, unknown> = {}) =>
	() =>
		Response.json(
			{
				data: {
					id: 41,
					code: 'abc1234',
					short_url: 'http://short.test/abc1234',
					domain_id: null,
					origin_url: 'https://example.com/landing',
					expires_at: null,
					max_clicks: null,
					protected: false,
					created_at: '2026-02-01T00:00:00Z',
					...extra,
				},
			},
			{ status: 201 }
		);
const apiError = (status: number, code: string, message: string) => () => Response.json({ error: { code, message } }, { status });

const toolNames = async (token: string) => ((await h.rpcResult(await h.rpc(token, 'tools/list'))).tools as { name: string }[]).map(t => t.name);

describe('write tools are only for write connections', () => {
	it('shows them to a write token, with the right hints', async () => {
		const tools = (await h.rpcResult(await h.rpc(write, 'tools/list'))).tools as { name: string; annotations: Record<string, boolean> }[];
		expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(['create_link', 'delete_link']));
		expect(tools.find(t => t.name === 'delete_link')!.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
		expect(tools.find(t => t.name === 'create_link')!.annotations).toMatchObject({ destructiveHint: false, readOnlyHint: false });
	});

	it('hides them from a read-only token and refuses to run them', async () => {
		const names = await toolNames(readOnly);
		expect(names).not.toContain('create_link');
		expect(names).not.toContain('delete_link');
		expect(names).toEqual(expect.arrayContaining(['whoami', 'list_organizations', 'list_links']));

		for (const [name, args] of [
			['create_link', { organization_id: 3, url: 'https://example.com' }],
			['delete_link', { organization_id: 3, link_id: 1 }],
		] as const) {
			const res = await h.rpc(readOnly, 'tools/call', { name, arguments: args });
			const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
			expect(body.error !== undefined || body.result?.isError === true, name).toBe(true);
		}
		expect(h.apiCalls).toHaveLength(0);
	});
});

describe('create_link', () => {
	it('creates a link, acting as the user with the write scope', async () => {
		h.apiReplies['POST /orgs/3/links'] = created();
		const out = await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com/landing' });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe('Created http://short.test/abc1234 -> https://example.com/landing (link id 41).');
		expect(out.structuredContent.link).toMatchObject({ id: 41, code: 'abc1234', short_url: 'http://short.test/abc1234' });

		expect(h.apiCalls).toHaveLength(1);
		expect(h.apiCalls[0]).toMatchObject({ method: 'POST', path: '/orgs/3/links', body: { url: 'https://example.com/landing' } });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'write' });
		expect(Object.keys(h.apiCalls[0]!.body)).toEqual(['url']); // nothing the caller did not set
	});

	it('passes every option and says which ones are on', async () => {
		h.apiReplies['POST /orgs/3/links'] = created({ code: 'launch', protected: true, max_clicks: 100, expires_at: '2030-01-01T00:00:00Z', domain_id: 5 });
		const out = await h.callTool(write, 'create_link', {
			organization_id: 3,
			url: 'https://example.com/landing',
			alias: 'launch',
			expires_at: '2030-01-01T00:00:00Z',
			max_clicks: 100,
			password: 'hunter22',
			domain_id: 5,
		});
		expect(h.apiCalls[0]!.body).toEqual({
			url: 'https://example.com/landing',
			alias: 'launch',
			expires_at: '2030-01-01T00:00:00Z',
			max_clicks: 100,
			password: 'hunter22',
			domain_id: 5,
		});
		expect(out.content[0].text).toContain('password protected, expires 2030-01-01T00:00:00Z, max 100 clicks');
		expect(out.structuredContent.link).toMatchObject({ password_protected: true, max_clicks: 100, domain_id: 5 });
	});

	it('never echoes the password back', async () => {
		h.apiReplies['POST /orgs/3/links'] = created({ protected: true });
		const out = await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com', password: 'hunter22' });
		expect(JSON.stringify(out)).not.toContain('hunter22');
	});

	it.each([
		['a javascript: URL', { url: 'javascript:alert(1)' }],
		['an ftp URL', { url: 'ftp://example.com/file' }],
		['a URL without a host', { url: 'https:///nohost' }],
		['text that is not a URL', { url: 'example.com' }],
		['a URL over 255 characters', { url: `https://example.com/${'a'.repeat(250)}` }],
		['an alias that is too short', { url: 'https://example.com', alias: 'ab' }],
		['an alias with spaces', { url: 'https://example.com', alias: 'my link' }],
		['an expiration without a time zone', { url: 'https://example.com', expires_at: '2030-01-01T00:00:00' }],
		['an expiration that is not a date', { url: 'https://example.com', expires_at: 'tomorrow' }],
		['zero max clicks', { url: 'https://example.com', max_clicks: 0 }],
		['a password that is too short', { url: 'https://example.com', password: 'abc' }],
		['a bad organization', { url: 'https://example.com', organization_id: 0 }],
	])('rejects %s without calling the API', async (_name, extra) => {
		const res = await h.rpc(write, 'tools/call', { name: 'create_link', arguments: { organization_id: 3, ...extra } });
		const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
		expect(body.error !== undefined || body.result?.isError === true).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('relays what the API says when the alias is taken', async () => {
		h.apiReplies['POST /orgs/3/links'] = apiError(409, 'alias_taken', 'the alias is already in use');
		const out = await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com', alias: 'launch' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('the alias is already in use');
	});

	it("relays the API's validation message", async () => {
		h.apiReplies['POST /orgs/3/links'] = apiError(400, 'invalid_expiry', 'expires_at must be in the future');
		const out = await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com', expires_at: '2001-01-01T00:00:00Z' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('expires_at must be in the future');
	});

	it('explains a refusal to the model', async () => {
		h.apiReplies['POST /orgs/8/links'] = apiError(403, 'not_member', 'you are not a member of this organization');
		const out = await h.callTool(write, 'create_link', { organization_id: 8, url: 'https://example.com' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('not a member');
	});
});

describe('delete_link', () => {
	it('deletes the link as the user', async () => {
		h.apiReplies['DELETE /orgs/3/links/10'] = () => new Response(null, { status: 204 });
		const out = await h.callTool(write, 'delete_link', { organization_id: 3, link_id: 10 });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe('Deleted link 10.');
		expect(out.structuredContent).toEqual({ deleted: true, link_id: 10 });
		expect(h.apiCalls).toHaveLength(1);
		expect(h.apiCalls[0]).toMatchObject({ method: 'DELETE', path: '/orgs/3/links/10' });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'write' });
	});

	it('reports a link that does not exist', async () => {
		h.apiReplies['DELETE /orgs/3/links/99'] = apiError(404, 'not_found', 'resource not found');
		const out = await h.callTool(write, 'delete_link', { organization_id: 3, link_id: 99 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('Not found');
	});

	it.each([
		['a zero link', { organization_id: 3, link_id: 0 }],
		['a text link', { organization_id: 3, link_id: '10' }],
		['a path-like link', { organization_id: 3, link_id: '10/../../me' }],
		['a missing link', { organization_id: 3 }],
		['a fractional organization', { organization_id: 1.5, link_id: 1 }],
	])('rejects %s without calling the API', async (_name, args) => {
		const res = await h.rpc(write, 'tools/call', { name: 'delete_link', arguments: args });
		const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
		expect(body.error !== undefined || body.result?.isError === true).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});
});
