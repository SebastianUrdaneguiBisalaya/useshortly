import { z } from 'zod';
import { CreateOrganizationBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

/** Same limit the backend applies to names and descriptions. */
export const ORGANIZATION_FIELD_MAX_LENGTH = 255;

export function createOrganizationSchema(t: Translate) {
	const tooLong = t('protected.organization.validation.tooLong', {
		max: ORGANIZATION_FIELD_MAX_LENGTH,
	});
	return CreateOrganizationBody.required().extend({
		description: z.string().trim().max(ORGANIZATION_FIELD_MAX_LENGTH, tooLong),
		name: z.string().trim().min(1, t('protected.organization.validation.nameRequired')).max(ORGANIZATION_FIELD_MAX_LENGTH, tooLong),
	});
}
