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
