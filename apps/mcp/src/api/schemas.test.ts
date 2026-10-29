import { describe, expect, it } from 'vitest';
import { campaign, campaignChannel, campaignStats, link } from './schemas.js';

const baseLink = {
	id: 1,
	code: 'abc1234',
	short_url: 'https://s.test/abc1234',
	domain_id: null,
	origin_url: 'https://example.com',
	expires_at: null,
	max_clicks: null,
	protected: false,
	created_at: '2026-06-01T12:00:00Z',
};

describe('link', () => {
	it('carries the campaign and channel it was shared in', () => {
		const parsed = link.parse({ ...baseLink, campaign_id: 3, channel_id: 11, campaign_name: 'Black Friday', channel_name: 'Instagram' });
		expect(parsed).toMatchObject({ campaign_id: 3, channel_id: 11, campaign_name: 'Black Friday', channel_name: 'Instagram' });
	});

	it('is outside every campaign when the API says so, or says nothing', () => {
		for (const input of [baseLink, { ...baseLink, campaign_id: null, channel_id: null, campaign_name: '', channel_name: '' }]) {
			expect(link.parse(input)).toMatchObject({ campaign_id: null, channel_id: null, campaign_name: '', channel_name: '' });
		}
	});
});

describe('campaign', () => {
	it('keeps what a tool shows and fills the optional fields', () => {
		expect(campaign.parse({ id: 3, name: 'Black Friday', created_at: '2026-06-01T12:00:00Z', unknown: true })).toEqual({
			id: 3,
			name: 'Black Friday',
			description: '',
			channel_count: 0,
			link_count: 0,
			created_at: '2026-06-01T12:00:00Z',
			updated_at: null,
		});
	});

	it('refuses an answer without an id or a name', () => {
		expect(campaign.safeParse({ name: 'x', created_at: 'now' }).success).toBe(false);
		expect(campaign.safeParse({ id: 1, created_at: 'now' }).success).toBe(false);
	});
});

describe('campaignChannel', () => {
	it('needs the campaign it belongs to', () => {
		expect(campaignChannel.parse({ id: 11, campaign_id: 3, name: 'Instagram', created_at: 'now' })).toMatchObject({ campaign_id: 3 });
		expect(campaignChannel.safeParse({ id: 11, name: 'Instagram', created_at: 'now' }).success).toBe(false);
	});
});

describe('campaignStats', () => {
	const stats = { campaign_id: 3, from: '2026-06-01', to: '2026-06-30', total: 5, previous_total: 2, daily: null, referrers: null, countries: null, devices: null };

	it('turns the lists the API leaves null into empty ones', () => {
		const parsed = campaignStats.parse({ ...stats, channels: null });
		expect(parsed).toMatchObject({ campaign_id: 3, total: 5, previous_total: 2, daily: [], referrers: [], countries: [], devices: [], by_hour: [], by_weekday: [], channels: [] });
		expect(parsed).not.toHaveProperty('link_id');
	});

	it('lists the clicks of each channel in the order the API gives', () => {
		const channels = [
			{ id: 11, name: 'Instagram', clicks: 4 },
			{ id: 12, name: 'Email', clicks: 0 },
		];
		expect(campaignStats.parse({ ...stats, channels }).channels).toEqual(channels);
	});
});
