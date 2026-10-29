import { z } from 'zod';
import { ForgotPasswordBody, LoginBody, RegisterBody, ResetPasswordBody, VerifyRegistrationBody } from '~/api/zod/index.zod';
import type { Translate } from '~/i18n';

// The generated bodies mirror the backend contract but have every field optional and no messages.
// Each schema starts from the generated one (`.required()` keeps its field names tied to the API) and
// overrides the fields with the validation rules and translated messages the form needs.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const OTP_LENGTH = 6;

function emailField(t: Translate) {
	return z.email(t('auth.validation.emailInvalid'));
}

function codeField(t: Translate) {
	return z.string().length(
		OTP_LENGTH,
		t('auth.validation.codeInvalid', {
			length: OTP_LENGTH,
		})
	);
}

function newPasswordField(t: Translate) {
	return z
		.string()
		.min(
			PASSWORD_MIN_LENGTH,
			t('auth.validation.passwordMin', {
				min: PASSWORD_MIN_LENGTH,
			})
		)
		.max(
			PASSWORD_MAX_LENGTH,
			t('auth.validation.passwordMax', {
				max: PASSWORD_MAX_LENGTH,
			})
		);
}

export function createSignInSchema(t: Translate) {
	return LoginBody.required().extend({
		email: emailField(t),
		// No length rule: accounts created under an older policy must still be able to sign in.
		password: z.string().min(1, t('auth.validation.passwordRequired')),
	});
}

export function createSignUpSchema(t: Translate) {
	return RegisterBody.required().extend({
		email: emailField(t),
		first_name: z.string().trim().min(1, t('auth.validation.firstNameRequired')),
		last_name: z.string().trim().min(1, t('auth.validation.lastNameRequired')),
		password: newPasswordField(t),
	});
}

export function createForgotPasswordSchema(t: Translate) {
	return ForgotPasswordBody.required().extend({
		email: emailField(t),
	});
}

/** The signup confirmation form only asks for the code; the email comes from the query string. */
export function createVerifyEmailSchema(t: Translate) {
	return VerifyRegistrationBody.pick({
		code: true,
	})
		.required()
		.extend({
			code: codeField(t),
		});
}

/**
 * Custom: the API body is `{ email, code, new_password }`, but the form adds a
 * confirmation field and has no email input (it comes from the query string
 * and is merged in at submit time).
 */
export function createResetPasswordSchema(t: Translate) {
	return ResetPasswordBody.pick({
		code: true,
		new_password: true,
	})
		.required()
		.extend({
			code: codeField(t),
			confirm_password: z.string().min(1, t('auth.validation.passwordRequired')),
			new_password: newPasswordField(t),
		})
		.refine(data => data.new_password === data.confirm_password, {
			message: t('auth.validation.passwordsMismatch'),
			path: ['confirm_password'],
		});
}
