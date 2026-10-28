import { z } from 'zod';
import type { Translate } from '~/i18n';

export const ALIAS_MAX_LENGTH = 15;

export function createLinkSchema(t: Translate) {
	return z.object({
		alias: z
			.string()
			.trim()
			.max(ALIAS_MAX_LENGTH, t('protected.links.create.alias.invalid'))
			.regex(/^[0-9A-Za-z_-]*$/, t('protected.links.create.alias.invalid')),
		domain_id: z.number().int().optional(),
		expires_at: z.string(),
		max_clicks: z.number(t('protected.links.create.maxClicks.invalid')).int(t('protected.links.create.maxClicks.invalid')).positive(t('protected.links.create.maxClicks.invalid')).optional(),
		password: z.string(),
		url: z
			.string()
			.trim()
			.min(1, t('protected.links.create.url.required'))
			.refine(value => {
				try {
					return ['http:', 'https:'].includes(new URL(value).protocol);
				} catch {
					return false;
				}
			}, t('protected.links.create.url.invalid')),
	});
}
