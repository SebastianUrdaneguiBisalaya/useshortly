import { z } from 'zod';
import type { Translate } from '~/i18n';

export const ALIAS_MIN_LENGTH = 3;
export const ALIAS_MAX_LENGTH = 15;
// Generated codes are this long, so the API refuses aliases of this length.
export const GENERATED_CODE_LENGTH = 7;

export function createLinkSchema(t: Translate) {
	return z
		.object({
			alias: z
				.string()
				.trim()
				.regex(/^[0-9A-Za-z_-]*$/, t('protected.links.create.alias.invalid'))
				.refine(
					value => value === '' || (value.length >= ALIAS_MIN_LENGTH && value.length <= ALIAS_MAX_LENGTH && value.length !== GENERATED_CODE_LENGTH),
					t('protected.links.create.alias.invalid')
				),
			// The campaign only narrows the channels on offer; the API takes the channel alone.
			campaign_id: z.number().int().optional(),
			channel_id: z.number().int().optional(),
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
		})
		.refine(data => data.campaign_id === undefined || data.channel_id !== undefined, {
			message: t('protected.links.create.channel.required'),
			path: ['channel_id'],
		});
}
