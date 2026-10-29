import { z } from 'zod';
import { InviteMemberBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

export function inviteMemberSchema(t: Translate) {
	return InviteMemberBody.pick({
		email: true,
	})
		.required()
		.extend({
			email: z.email(t('protected.users.invite.emailInvalid')),
		});
}
