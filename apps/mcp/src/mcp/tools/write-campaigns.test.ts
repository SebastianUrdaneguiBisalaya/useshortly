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

const apiError = (status: number, code: string, message: string) => () => Response.json({ error: { code, message } }, { status });
const campaignOf = (extra: Record<string, unknown> = {}) => ({
	id: 7,
	name: 'Black Friday',
	description: '',
	channel_count: 0,
	link_count: 0,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: null,
	...extra,
});
const linkOf = (extra: Record<string, unknown> = {}) => ({
	id: 9,
	code: 'c9',
	short_url: 'http://short.test/c9',
	domain_id: null,
	origin_url: 'https://example.com/',
	expires_at: null,
	max_clicks: null,
	protected: false,
	created_at: '2026-01-01T00:00:00Z',
	...extra,
});
const inChannel = { campaign_id: 7, channel_id: 11, campaign_name: 'Black Friday', channel_name: 'Instagram', origin_url: 'https://example.com/?utm_source=Instagram' };

const rejected = async (token: string, name: string, args: Record<string, unknown>) => {
	const res = await h.rpc(token, 'tools/call', { name, arguments: args });
	const body = (await res.json()) as { result?: { isError?: boolean }; error?: unknown };
	return body.error !== undefined || body.result?.isError === true;
};
const toolNames = async (token: string) => ((await h.rpcResult(await h.rpc(token, 'tools/list'))).tools as { name: string }[]).map(t => t.name);

const WRITE_TOOLS = {
	create_campaign: { organization_id: 3, name: 'Black Friday' },
	update_campaign: { organization_id: 3, campaign_id: 7, name: 'BF 2026' },
	delete_campaign: { organization_id: 3, campaign_id: 7 },
	add_campaign_channel: { organization_id: 3, campaign_id: 7, name: 'Instagram' },
	delete_campaign_channel: { organization_id: 3, campaign_id: 7, channel_id: 11 },
	set_link_channel: { organization_id: 3, link_id: 9, channel_id: 11 },
};

describe('campaign write tools are only for write connections', () => {
	it('shows them to a write token with the right hints', async () => {
		const tools = (await h.rpcResult(await h.rpc(write, 'tools/list'))).tools as { name: string; annotations: Record<string, boolean> }[];
		expect(tools.map(t => t.name)).toEqual(expect.arrayContaining(Object.keys(WRITE_TOOLS)));
		for (const name of ['delete_campaign', 'delete_campaign_channel']) expect(tools.find(t => t.name === name)!.annotations, name).toMatchObject({ destructiveHint: true, readOnlyHint: false });
		for (const name of ['create_campaign', 'update_campaign', 'add_campaign_channel', 'set_link_channel']) {
			expect(tools.find(t => t.name === name)!.annotations, name).toMatchObject({ destructiveHint: false, readOnlyHint: false });
		}
	});

	it('hides them from a read-only token and refuses to run them', async () => {
		const names = await toolNames(readOnly);
		for (const name of Object.keys(WRITE_TOOLS)) expect(names, name).not.toContain(name);
		expect(names).toEqual(expect.arrayContaining(['list_campaigns', 'get_campaign', 'list_campaign_channels', 'get_campaign_stats']));
		for (const [name, args] of Object.entries(WRITE_TOOLS)) expect(await rejected(readOnly, name, args), name).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('tells the model what changes the data it cannot see', async () => {
		const tools = (await h.rpcResult(await h.rpc(write, 'tools/list'))).tools as { name: string; description: string }[];
		const description = (name: string) => tools.find(t => t.name === name)!.description;
		expect(description('add_campaign_channel')).toContain('utm_source');
		expect(description('set_link_channel')).toContain('rewritten');
		expect(description('set_link_channel')).toContain('removes those three parameters');
		expect(description('delete_campaign')).toContain('Confirm with the user');
		expect(description('delete_campaign')).toContain('links are not deleted');
		expect(description('delete_campaign_channel')).toContain('Confirm with the user');
		expect(description('create_link')).toContain('255 characters');
	});
});

describe('create_campaign', () => {
	it('creates a campaign, acting as the user with the write scope', async () => {
		h.apiReplies['POST /orgs/3/campaigns'] = () => Response.json({ data: campaignOf() }, { status: 201 });
		const out = await h.callTool(write, 'create_campaign', { organization_id: 3, name: 'Black Friday' });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toBe('Created campaign Black Friday (campaign id 7). It has no channels yet: add one with add_campaign_channel.');
		expect(out.structuredContent.campaign).toMatchObject({ id: 7, name: 'Black Friday' });
		expect(h.apiCalls[0]).toMatchObject({ method: 'POST', path: '/orgs/3/campaigns', body: { name: 'Black Friday' } });
		expect(h.apiCalls[0]!.claims).toMatchObject({ sub: '7', scope: 'write' });
	});

	it('sends the description when there is one', async () => {
		h.apiReplies['POST /orgs/3/campaigns'] = () => Response.json({ data: campaignOf({ description: 'Sale links' }) }, { status: 201 });
		await h.callTool(write, 'create_campaign', { organization_id: 3, name: 'Black Friday', description: 'Sale links' });
		expect(h.apiCalls[0]!.body).toEqual({ name: 'Black Friday', description: 'Sale links' });
	});

	it.each([
		['an empty name', { name: '   ' }],
		['a name over 100 characters', { name: 'a'.repeat(101) }],
		['a description over 500 characters', { name: 'ok', description: 'a'.repeat(501) }],
		['a bad organization', { name: 'ok', organization_id: 0 }],
	])('rejects %s without calling the API', async (_name, extra) => {
		expect(await rejected(write, 'create_campaign', { organization_id: 3, ...extra })).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('tells the model what to do when the name is taken', async () => {
		h.apiReplies['POST /orgs/3/campaigns'] = apiError(409, 'name_taken', 'the organization already has a campaign with that name');
		const out = await h.callTool(write, 'create_campaign', { organization_id: 3, name: 'Black Friday' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('already has a campaign with that name');
		expect(out.content[0].text).toContain('list the existing campaigns or channels');
	});
});

describe('update_campaign', () => {
	it('sends only what changed', async () => {
		h.apiReplies['PATCH /orgs/3/campaigns/7'] = () => Response.json({ data: campaignOf({ name: 'BF 2026' }) });
		const out = await h.callTool(write, 'update_campaign', { organization_id: 3, campaign_id: 7, name: 'BF 2026' });
		expect(out.content[0].text).toBe('Updated campaign 7: BF 2026.');
		expect(h.apiCalls[0]).toMatchObject({ method: 'PATCH', body: { name: 'BF 2026' } });
		expect(Object.keys(h.apiCalls[0]!.body)).toEqual(['name']);
	});

	it('clears the description with an empty one', async () => {
		h.apiReplies['PATCH /orgs/3/campaigns/7'] = () => Response.json({ data: campaignOf() });
		await h.callTool(write, 'update_campaign', { organization_id: 3, campaign_id: 7, description: '' });
		expect(h.apiCalls[0]!.body).toEqual({ description: '' });
	});

	it('needs something to change', async () => {
		expect(await rejected(write, 'update_campaign', { organization_id: 3, campaign_id: 7 })).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});
});

describe('delete_campaign', () => {
	it('deletes the campaign and says its links stay', async () => {
		h.apiReplies['DELETE /orgs/3/campaigns/7'] = () => new Response(null, { status: 204 });
		const out = await h.callTool(write, 'delete_campaign', { organization_id: 3, campaign_id: 7 });
		expect(out.content[0].text).toBe('Deleted campaign 7. Its links still work.');
		expect(out.structuredContent).toEqual({ deleted: true, campaign_id: 7 });
		expect(h.apiCalls[0]).toMatchObject({ method: 'DELETE', path: '/orgs/3/campaigns/7' });
	});

	it('reports an unknown campaign as not found', async () => {
		h.apiReplies['DELETE /orgs/3/campaigns/99'] = apiError(404, 'not_found', 'campaign not found');
		const out = await h.callTool(write, 'delete_campaign', { organization_id: 3, campaign_id: 99 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('Not found');
	});
});

describe('add_campaign_channel and delete_campaign_channel', () => {
	it('adds a channel', async () => {
		h.apiReplies['POST /orgs/3/campaigns/7/channels'] = () => Response.json({ data: { id: 11, campaign_id: 7, name: 'Instagram', created_at: '2026-01-01T00:00:00Z' } }, { status: 201 });
		const out = await h.callTool(write, 'add_campaign_channel', { organization_id: 3, campaign_id: 7, name: 'Instagram' });
		expect(out.content[0].text).toBe('Added channel Instagram (channel id 11) to campaign 7.');
		expect(out.structuredContent.channel).toMatchObject({ id: 11, campaign_id: 7, name: 'Instagram' });
		expect(h.apiCalls[0]).toMatchObject({ method: 'POST', body: { name: 'Instagram' } });
	});

	it('tells the model what to do at the limit of 100 channels', async () => {
		h.apiReplies['POST /orgs/3/campaigns/7/channels'] = apiError(409, 'too_many_channels', 'a campaign has at most 100 channels');
		const out = await h.callTool(write, 'add_campaign_channel', { organization_id: 3, campaign_id: 7, name: 'One more' });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('Reuse an existing channel');
	});

	it.each([
		['an empty name', { name: '' }],
		['a name over 50 characters', { name: 'a'.repeat(51) }],
	])('rejects %s without calling the API', async (_name, extra) => {
		expect(await rejected(write, 'add_campaign_channel', { organization_id: 3, campaign_id: 7, ...extra })).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});

	it('deletes a channel', async () => {
		h.apiReplies['DELETE /orgs/3/campaigns/7/channels/11'] = () => new Response(null, { status: 204 });
		const out = await h.callTool(write, 'delete_campaign_channel', { organization_id: 3, campaign_id: 7, channel_id: 11 });
		expect(out.content[0].text).toBe('Deleted channel 11. Its links still work.');
		expect(out.structuredContent).toEqual({ deleted: true, campaign_id: 7, channel_id: 11 });
	});
});

describe('set_link_channel', () => {
	it('puts a link in a channel and shows its new destination', async () => {
		h.apiReplies['PUT /orgs/3/links/9/channel'] = () => Response.json({ data: linkOf(inChannel) });
		const out = await h.callTool(write, 'set_link_channel', { organization_id: 3, link_id: 9, channel_id: 11 });
		expect(out.isError).toBeFalsy();
		expect(out.content[0].text).toContain('Link 9 is now in campaign "Black Friday", channel "Instagram".');
		expect(out.content[0].text).toContain('https://example.com/?utm_source=Instagram');
		expect(out.structuredContent.link).toMatchObject({ channel_id: 11, campaign_id: 7 });
		expect(h.apiCalls[0]).toMatchObject({ method: 'PUT', path: '/orgs/3/links/9/channel', body: { channel_id: 11 } });
	});

	it('takes a link out of its campaign when there is no channel', async () => {
		h.apiReplies['PUT /orgs/3/links/9/channel'] = () => Response.json({ data: linkOf() });
		const out = await h.callTool(write, 'set_link_channel', { organization_id: 3, link_id: 9 });
		expect(out.content[0].text).toContain('Link 9 is no longer in a campaign.');
		expect(h.apiCalls[0]!.body).toEqual({});
	});

	it('tells the model what to do when the channel does not exist', async () => {
		h.apiReplies['PUT /orgs/3/links/9/channel'] = apiError(404, 'channel_not_found', 'channel not found');
		const out = await h.callTool(write, 'set_link_channel', { organization_id: 3, link_id: 9, channel_id: 99 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain("List the campaign's channels");
	});

	it('tells the model what to do when the destination gets too long', async () => {
		h.apiReplies['PUT /orgs/3/links/9/channel'] = apiError(400, 'campaign_url_too_long', 'the url plus the campaign utm parameters must be at most 255 characters');
		const out = await h.callTool(write, 'set_link_channel', { organization_id: 3, link_id: 9, channel_id: 11 });
		expect(out.isError).toBe(true);
		expect(out.content[0].text).toContain('shorter URL');
	});
});

describe('create_link in a channel', () => {
	const created =
		(extra: Record<string, unknown> = {}) =>
		() =>
			Response.json({ data: linkOf({ id: 41, code: 'abc1234', short_url: 'http://short.test/abc1234', ...extra }) }, { status: 201 });

	it('passes the channel on and says where the link was shared', async () => {
		h.apiReplies['POST /orgs/3/links'] = created(inChannel);
		const out = await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com/', channel_id: 11 });
		expect(h.apiCalls[0]!.body).toEqual({ url: 'https://example.com/', channel_id: 11 });
		expect(out.content[0].text).toContain('campaign "Black Friday", channel "Instagram"');
		expect(out.structuredContent.link).toMatchObject({ id: 41, campaign_id: 7, channel_id: 11, campaign_name: 'Black Friday' });
	});

	it('sends nothing about a channel when none was given', async () => {
		h.apiReplies['POST /orgs/3/links'] = created();
		await h.callTool(write, 'create_link', { organization_id: 3, url: 'https://example.com/' });
		expect(Object.keys(h.apiCalls[0]!.body)).toEqual(['url']);
	});

	it('rejects a channel id that is not an id', async () => {
		expect(await rejected(write, 'create_link', { organization_id: 3, url: 'https://example.com/', channel_id: 0 })).toBe(true);
		expect(h.apiCalls).toHaveLength(0);
	});
});
