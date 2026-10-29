import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../../test/oauth-harness.js';

let h: Harness;
let read: string;
let write: string;
beforeAll(async () => {
	h = await createHarness();
	read = await h.accessToken('mcp:read');
	write = await h.accessToken('mcp:read mcp:write');
});
afterAll(() => h.close());
beforeEach(() => {
	h.reset();
	h.apiCalls.length = 0;
});

const txt = { type: 'TXT', name: '_useshortly.go.example.com', value: 'useshortly-verify=abc123' };
const pending = { id: 5, host: 'go.example.com', verified: false, verified_at: null, created_at: '2026-03-01T00:00:00Z', verification: txt };
const verified = { id: 6, host: 'links.example.org', verified: true, verified_at: '2026-03-02T00:00:00Z', created_at: '2026-03-01T00:00:00Z' };

const json =
	(data: unknown, status = 200) =>
	() =>
		Response.json({ data }, { status });
const apiError = (status: number, code: string, message: string) => () => Response.json({ error: { code, message } }, { status });
const invalid = async (token: string, name: string, args: Record<string, unknown>) => {
	const res = await h.rpc(token, 'tools/call', { name, arguments: args });
	const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
	return body.error !== undefined || body.result?.isError === true;
};

describe('list_domains', () => {
	it('lists domains and gives the DNS record for the one that is not verified', async () => {
		h.apiReplies['GET /orgs/3/domains'] = json([pending, verified]);
		const out = await h.callTool(read, 'list_domains', { organization_id: 3 });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe(
			['- id 5: go.example.com — not verified. Create this DNS record: type TXT, name _useshortly.go.example.com, value useshortly-verify=abc123.', '- id 6: links.example.org — verified'].join(
				'\n'
			)
		);
		expect(out.structuredContent.domains[0]).toMatchObject({ id: 5, verified: false, dns_record: txt });
		expect(out.structuredContent.domains[1]).toMatchObject({ id: 6, verified: true, dns_record: null });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'read' });
	});

	it('says so when there are none', async () => {
		h.apiReplies['GET /orgs/3/domains'] = json([]);
		const out = await h.callTool(read, 'list_domains', { organization_id: 3 });
		expect(out.content[0].text).toBe('This organization has no custom domains.');
	});

	it('is open to a read-only connection', async () => {
		const names = ((await h.rpcResult(await h.rpc(read, 'tools/list'))).tools as { name: string }[]).map(t => t.name);
		expect(names).toContain('list_domains');
		expect(names).not.toContain('add_domain');
		expect(names).not.toContain('verify_domain');
	});
});

describe('add_domain', () => {
	it('registers the host and tells the model what the user must do next', async () => {
		h.apiReplies['POST /orgs/3/domains'] = json(pending, 201);
		const out = await h.callTool(write, 'add_domain', { organization_id: 3, host: 'go.example.com' });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe(
			'Added go.example.com (domain id 5). Create this DNS record: type TXT, name _useshortly.go.example.com, value useshortly-verify=abc123. DNS changes can take a while; then call verify_domain with domain id 5.'
		);
		expect(out.structuredContent.domain).toMatchObject({ id: 5, dns_record: txt });
		expect(h.apiCalls[0]).toMatchObject({ method: 'POST', path: '/orgs/3/domains', body: { host: 'go.example.com' } });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'write' });
	});

	it.each([
		['a URL', 'https://go.example.com'],
		['a host with a port', 'go.example.com:8080'],
		['a host with a path', 'go.example.com/links'],
		['a wildcard', '*.example.com'],
		['a single label', 'localhost'],
		['an IP address', '203.0.113.7'],
		['a label starting with a hyphen', '-bad.example.com'],
		['spaces', 'go example.com'],
		['text over 253 characters', `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(20)}.com`],
	])('rejects %s without calling the API', async (_name, host) => {
		expect(await invalid(write, 'add_domain', { organization_id: 3, host })).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('relays that the host is already registered', async () => {
		h.apiReplies['POST /orgs/3/domains'] = apiError(409, 'host_taken', 'the host is already registered');
		const out = await h.callTool(write, 'add_domain', { organization_id: 3, host: 'go.example.com' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('the host is already registered');
	});
});

describe('verify_domain', () => {
	it('reports a verified domain', async () => {
		h.apiReplies['POST /orgs/3/domains/5/verify'] = json({ ...pending, verified: true, verified_at: '2026-03-03T00:00:00Z', verification: undefined });
		const out = await h.callTool(write, 'verify_domain', { organization_id: 3, domain_id: 5 });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe('go.example.com is verified and can be used for links (domain id 5).');
		expect(out.structuredContent.domain).toMatchObject({ id: 5, verified: true, dns_record: null });
		expect(h.apiCalls[0]).toMatchObject({ method: 'POST', path: '/orgs/3/domains/5/verify' });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'write' });
	});

	it('tells the model to wait and retry when the record is not there yet', async () => {
		h.apiReplies['POST /orgs/3/domains/5/verify'] = apiError(422, 'verification_failed', 'the DNS TXT record was not found, check its name and value (DNS changes can take a while)');
		const out = await h.callTool(write, 'verify_domain', { organization_id: 3, domain_id: 5 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('the DNS TXT record was not found');
	});

	it('treats a failed DNS lookup as temporary', async () => {
		h.apiReplies['POST /orgs/3/domains/5/verify'] = apiError(503, 'dns_unavailable', 'the DNS lookup failed, try again');
		const out = await h.callTool(write, 'verify_domain', { organization_id: 3, domain_id: 5 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('Try again shortly');
	});

	it('reports an unknown domain', async () => {
		h.apiReplies['POST /orgs/3/domains/99/verify'] = apiError(404, 'not_found', 'domain not found');
		const out = await h.callTool(write, 'verify_domain', { organization_id: 3, domain_id: 99 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('Not found');
	});

	it.each([
		['a zero domain', { organization_id: 3, domain_id: 0 }],
		['a text domain', { organization_id: 3, domain_id: '5' }],
		['a missing domain', { organization_id: 3 }],
	])('rejects %s without calling the API', async (_name, args) => {
		expect(await invalid(write, 'verify_domain', args)).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});
});
