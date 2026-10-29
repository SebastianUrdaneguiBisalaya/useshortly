import { z } from 'zod';
import type { Translate } from '~/i18n';

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

export function createDomainSchema(t: Translate) {
	return z.object({
		host: z.string().trim().min(1, t('protected.domains.create.host.required')).regex(HOST, t('protected.domains.create.host.invalid')),
	});
}
