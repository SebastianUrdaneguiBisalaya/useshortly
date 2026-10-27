import { z } from "zod";
import {
  ForgotPasswordBody,
  LoginBody,
  RegisterBody,
  ResetPasswordBody,
} from "~/api/zod/index.zod";
import type { Translate } from "~/i18n";

// The generated bodies mirror the backend contract but have every field optional and no messages.
// Each schema starts from the generated one (`.required()` keeps its field names tied to the API) and
// overrides the fields with the validation rules and translated messages the form needs.

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 100;
export const OTP_LENGTH = 6;

function emailField(_: Translate) {
  return z.email(_("auth.validation.emailInvalid"));
}

function newPasswordField(_: Translate) {
  return z
    .string()
    .min(
      PASSWORD_MIN_LENGTH,
      _("auth.validation.passwordMin", {
        min: PASSWORD_MIN_LENGTH,
      }),
    )
    .max(
      PASSWORD_MAX_LENGTH,
      _("auth.validation.passwordMax", {
        max: PASSWORD_MAX_LENGTH,
      }),
    );
}

export function createSignInSchema(_: Translate) {
  return LoginBody.required().extend({
    email: emailField(_),
    // No length rule: accounts created under an older policy must still be able to sign in.
    password: z.string().min(1, _("auth.validation.passwordRequired")),
  });
}

export function createSignUpSchema(_: Translate) {
  return RegisterBody.required().extend({
    email: emailField(_),
    first_name: z.string().trim().min(1, _("auth.validation.firstNameRequired")),
    last_name: z.string().trim().min(1, _("auth.validation.lastNameRequired")),
    password: newPasswordField(_),
  });
}

export function createForgotPasswordSchema(_: Translate) {
  return ForgotPasswordBody.required().extend({
    email: emailField(_),
  });
}

/**
 * Custom: the API body is `{ email, code, new_password }`, but the form adds a
 * confirmation field and has no email input (it comes from the query string
 * and is merged in at submit time).
 */
export function createResetPasswordSchema(_: Translate) {
  return ResetPasswordBody.pick({
    code: true,
    new_password: true,
  })
    .required()
    .extend({
      code: z.string().length(
        OTP_LENGTH,
        _("auth.validation.codeInvalid", {
          length: OTP_LENGTH,
        }),
      ),
      confirm_password: z
        .string()
        .min(1, _("auth.validation.passwordRequired")),
      new_password: newPasswordField(_),
    })
    .refine((data) => data.new_password === data.confirm_password, {
      message: _("auth.validation.passwordsMismatch"),
      path: [
        "confirm_password",
      ],
    });
}
