import { z } from 'zod';
import { CreateCampaignBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

/** Same limits the backend applies to a campaign. */
export const CAMPAIGN_NAME_MAX_LENGTH = 100;
export const CAMPAIGN_DESCRIPTION_MAX_LENGTH = 500;

export function createCampaignSchema(t: Translate) {
	return CreateCampaignBody.required().extend({
		description: z
			.string()
			.trim()
			.max(CAMPAIGN_DESCRIPTION_MAX_LENGTH, t('protected.campaigns.validation.tooLong', { max: CAMPAIGN_DESCRIPTION_MAX_LENGTH })),
		name: z
			.string()
			.trim()
			.min(1, t('protected.campaigns.validation.nameRequired'))
			.max(CAMPAIGN_NAME_MAX_LENGTH, t('protected.campaigns.validation.tooLong', { max: CAMPAIGN_NAME_MAX_LENGTH })),
	});
}
