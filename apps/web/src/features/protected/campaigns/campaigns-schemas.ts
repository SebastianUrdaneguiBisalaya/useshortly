import { z } from 'zod';
import { CreateCampaignBody, CreateCampaignChannelBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

/** Same limits the backend applies to a campaign. */
export const CAMPAIGN_NAME_MAX_LENGTH = 100;
export const CAMPAIGN_DESCRIPTION_MAX_LENGTH = 500;
export const CHANNEL_NAME_MAX_LENGTH = 50;

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

export function createChannelSchema(t: Translate) {
	return CreateCampaignChannelBody.required().extend({
		name: z
			.string()
			.trim()
			.min(1, t('protected.campaigns.validation.nameRequired'))
			.max(CHANNEL_NAME_MAX_LENGTH, t('protected.campaigns.validation.tooLong', { max: CHANNEL_NAME_MAX_LENGTH })),
	});
}
