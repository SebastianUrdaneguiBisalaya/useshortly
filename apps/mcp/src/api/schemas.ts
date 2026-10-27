import * as z from "zod";

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
  daily: z.array(z.object({ date: z.string(), clicks: z.number() })).nullable().transform((v) => v ?? []),
  referrers: z.array(count).nullable().transform((v) => v ?? []),
  countries: z.array(count).nullable().transform((v) => v ?? []),
  devices: z.array(count).nullable().transform((v) => v ?? []),
});
