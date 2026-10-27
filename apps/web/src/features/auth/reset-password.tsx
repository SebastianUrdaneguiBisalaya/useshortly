import { useLingui } from "@lingui/react";
import { useMemo } from "react";
import { Link as RouterLink, useSearchParams } from "react-router";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { InputOtp } from "~/components/ui/forms-inputs/input-otp/input-otp";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createResetPasswordSchema, OTP_LENGTH } from "~/features/auth/schemas";

export default function ResetPasswordPage() {
  const { _ } = useLingui();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email");
  const schema = useMemo(() => createResetPasswordSchema(_), [
    _,
  ]);

  return (
    <>
      <Layout.Stack
        className="w-full items-center text-center"
        gap="sm"
      >
        <Typography.H2 className="border-none">
          {_("auth.resetPassword.title")}
        </Typography.H2>
        <Typography.Span className="text-foreground-secondary">
          {email
            ? _("auth.resetPassword.description", {
                email,
              })
            : _("auth.resetPassword.descriptionNoEmail")}
        </Typography.Span>
      </Layout.Stack>
      <Form
        className="w-full"
        defaultValues={{
          code: "",
          confirm_password: "",
          new_password: "",
        }}
        mode="onSubmit"
        onSubmit={() => {}}
        schema={schema}
      >
        {({ Field, form }) => (
          <Layout.Stack>
            <Field name="code">
              {(field) => (
                <InputOtp
                  errorMessage={field.error}
                  label={_("auth.resetPassword.code.label")}
                  length={OTP_LENGTH}
                  {...field.changeProps}
                />
              )}
            </Field>
            <Field name="new_password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>
                    {_("auth.resetPassword.newPassword.label")}
                  </Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={_("auth.resetPassword.newPassword.placeholder")}
                    type="password"
                    {...field.inputProps}
                  />
                  <Input.PasswordToggle
                    hideLabel={_("auth.common.password.hide")}
                    showLabel={_("auth.common.password.show")}
                  />
                </Input>
              )}
            </Field>
            <Field name="confirm_password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>
                    {_("auth.resetPassword.confirmPassword.label")}
                  </Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={_(
                      "auth.resetPassword.confirmPassword.placeholder",
                    )}
                    type="password"
                    {...field.inputProps}
                  />
                  <Input.PasswordToggle
                    hideLabel={_("auth.common.password.hide")}
                    showLabel={_("auth.common.password.show")}
                  />
                </Input>
              )}
            </Field>
            <Form.Submit
              className="self-center w-full py-3"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? _("auth.resetPassword.submitting")
                : _("auth.resetPassword.submit")}
            </Form.Submit>
            {form.formState.errors.root?.message && (
              <Typography.Span
                className="text-xs text-destructive"
                role="alert"
              >
                {form.formState.errors.root.message}
              </Typography.Span>
            )}
          </Layout.Stack>
        )}
      </Form>
      <Link
        as={RouterLink}
        className="self-center"
        to="/auth/sign-in"
      >
        {_("auth.common.backToSignIn")}
      </Link>
    </>
  );
}
