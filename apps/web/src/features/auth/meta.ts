import type { MetaFunction } from 'react-router';
import type { loader as rootLoader } from '~/app/root';
import { getI18n } from '~/i18n';

type AuthPage = 'forgotPassword' | 'resetPassword' | 'signIn' | 'signUp' | 'verifyEmail';

/** Tab title and description of an `/auth/*` page, from `meta.auth.<page>` in the locale catalogs, in the visitor's language. */
export function authMeta(page: AuthPage): MetaFunction<unknown, { root: typeof rootLoader }> {
	return ({ matches }) => {
		const t = getI18n(matches.find(match => match.id === 'root')?.loaderData?.locale).t;
		return [{ title: t(`meta.auth.${page}.title`) }, { name: 'description', content: t(`meta.auth.${page}.description`) }];
	};
}
