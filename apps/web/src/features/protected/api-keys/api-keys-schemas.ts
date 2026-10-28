import { z } from 'zod';
import { CreateApiKeyBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

export const API_KEY_NAME_MAX_LENGTH = 100;

export function createApiKeySchema(t: Translate) {
	return CreateApiKeyBody.pick({
		name: true,
		scope: true,
	})
		.required()
		.extend({
			name: z
				.string()
				.trim()
				.min(1, t('protected.apiKeys.create.nameRequired'))
				.max(
					API_KEY_NAME_MAX_LENGTH,
					t('protected.organization.validation.tooLong', {
						max: API_KEY_NAME_MAX_LENGTH,
					})
				),
		});
}
