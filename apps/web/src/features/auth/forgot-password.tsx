import { useLingui } from "@lingui/react";
import { useMemo } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createForgotPasswordSchema } from "~/features/auth/schemas";

export default function ForgotPasswordPage() {
  const { _ } = useLingui();
  const navigate = useNavigate();
  const schema = useMemo(() => createForgotPasswordSchema(_), [
    _,
  ]);

  return (
    <>
      <Layout.Stack
        className="w-full items-center text-center"
        gap="sm"
      >
        <Typography.H2 className="border-none">
          {_("auth.forgotPassword.title")}
        </Typography.H2>
        <Typography.Span className="text-foreground-secondary">
          {_("auth.forgotPassword.description")}
        </Typography.Span>
      </Layout.Stack>
      <Form
        className="w-full"
        defaultValues={{
          email: "",
        }}
        mode="onSubmit"
        onSubmit={async (data) => {
          await navigate(
            `/auth/reset-password?email=${encodeURIComponent(data.email)}`,
          );
        }}
        schema={schema}
      >
        {({ Field, form }) => (
          <Layout.Stack>
            <Field name="email">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>{_("auth.common.email.label")}</Input.Label>
                  <Input.Field
                    autoComplete="off"
                    autoFocus
                    placeholder={_("auth.common.email.placeholder")}
                    {...field.inputProps}
                  />
                </Input>
              )}
            </Field>
            <Form.Submit
              className="self-center w-full py-3"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? _("auth.forgotPassword.submitting")
                : _("auth.forgotPassword.submit")}
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
