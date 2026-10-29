import * as z from 'zod';

// What the API answers, reduced to the fields tools use. Unknown fields are dropped.

export const organization = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().optional(),
});

export const link = z.object({
	id: z.number(),
	code: z.string(),
	short_url: z.string(),
	domain_id: z.number().nullable(),
	// The campaign channel the link was shared in; null (and empty names) when it is in no campaign.
	campaign_id: z.number().nullable().default(null),
	channel_id: z.number().nullable().default(null),
	campaign_name: z.string().default(''),
	channel_name: z.string().default(''),
	origin_url: z.string(),
	expires_at: z.string().nullable(),
	max_clicks: z.number().nullable(),
	protected: z.boolean(),
	created_at: z.string(),
});

export const pageMeta = z.object({ limit: z.number(), offset: z.number(), total: z.number() });

const count = z.object({ name: z.string(), clicks: z.number() });

export const linkStats = z.object({
	link_id: z.number(),
	from: z.string(),
	to: z.string(),
	total: z.number(),
	previous_total: z.number().default(0),
	by_hour: z
		.array(z.number())
		.nullable()
		.default([])
		.transform(v => v ?? []),
	by_weekday: z
		.array(z.number())
		.nullable()
		.default([])
		.transform(v => v ?? []),
	daily: z
		.array(z.object({ date: z.string(), clicks: z.number() }))
		.nullable()
		.transform(v => v ?? []),
	referrers: z
		.array(count)
		.nullable()
		.transform(v => v ?? []),
	countries: z
		.array(count)
		.nullable()
		.transform(v => v ?? []),
	devices: z
		.array(count)
		.nullable()
		.transform(v => v ?? []),
});

export const domain = z.object({
	id: z.number(),
	host: z.string(),
	verified: z.boolean(),
	verified_at: z.string().nullable(),
	created_at: z.string(),
	// The DNS record to create; the API leaves it out once the domain is verified.
	verification: z.object({ type: z.string(), name: z.string(), value: z.string() }).optional(),
});

export const campaign = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().default(''),
	channel_count: z.number().default(0),
	link_count: z.number().default(0),
	created_at: z.string(),
	updated_at: z.string().nullable().default(null),
});

export const campaignChannel = z.object({
	id: z.number(),
	campaign_id: z.number(),
	name: z.string(),
	created_at: z.string(),
});

const channelClicks = z.object({ id: z.number(), name: z.string(), clicks: z.number() });

/** Like `linkStats` for every link of a campaign, plus the clicks of each channel (most clicks first, quiet ones included). */
export const campaignStats = linkStats.omit({ link_id: true }).extend({
	campaign_id: z.number(),
	channels: z
		.array(channelClicks)
		.nullable()
		.transform(v => v ?? []),
});
