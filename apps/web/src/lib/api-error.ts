import { isAxiosError } from 'axios';
import type { ErrorResponse } from '~/api/model';
import { getI18n, type TranslationKey } from '~/i18n';

/** Backend error codes (`error.code`) that have their own translated message. */
const errorKeys = {
	code_too_soon: 'errors.codeTooSoon',
	email_taken: 'errors.emailTaken',
	google_email_not_verified: 'errors.googleEmailNotVerified',
	invalid_code: 'errors.invalidCode',
	invalid_credentials: 'errors.invalidCredentials',
	invalid_description: 'errors.invalidDescription',
	invalid_name: 'errors.invalidName',
	name_taken: 'errors.nameTaken',
	provider_mismatch: 'errors.providerMismatch',
	too_many_attempts: 'errors.tooManyAttempts',
} satisfies Record<string, TranslationKey>;

function isKnownCode(code: string | undefined): code is keyof typeof errorKeys {
	return code !== undefined && Object.hasOwn(errorKeys, code);
}

/**
 * Message for a failed API request: the translation of its error code when there is one, else the
 * backend's own message, else a generic one. Client side only (it reads the browser's i18n instance).
 */
export function getApiErrorMessage(error: unknown) {
	const { t } = getI18n();
	const apiError = isAxiosError<ErrorResponse>(error) ? error.response?.data?.error : undefined;
	if (isKnownCode(apiError?.code)) return t(errorKeys[apiError.code]);
	return apiError?.message || t('errors.generic');
}

/** `true` when the request failed with 401 on an endpoint other than /auth/*, i.e. the session is over. */
export function isSessionExpired(error: unknown) {
	return isAxiosError(error) && error.response?.status === 401 && !error.config?.url?.startsWith('/auth/');
}
