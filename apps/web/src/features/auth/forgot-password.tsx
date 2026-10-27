import { useMemo } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createForgotPasswordSchema } from "~/features/auth/schemas";
import { useTranslate } from "~/hooks/use-translate";

export default function ForgotPasswordPage() {
  const t = useTranslate();
  const navigate = useNavigate();
  const schema = useMemo(() => createForgotPasswordSchema(t), [
    t,
  ]);

  return (
    <>
      <Layout.Stack
        className="w-full items-center text-center"
        gap="sm"
      >
        <Typography.H2 className="border-none">
          {t("auth.forgotPassword.title")}
        </Typography.H2>
        <Typography.Span className="text-foreground-secondary">
          {t("auth.forgotPassword.description")}
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
                  <Input.Label>{t("auth.common.email.label")}</Input.Label>
                  <Input.Field
                    autoComplete="off"
                    autoFocus
                    placeholder={t("auth.common.email.placeholder")}
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
                ? t("auth.forgotPassword.submitting")
                : t("auth.forgotPassword.submit")}
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
        {t("auth.common.backToSignIn")}
      </Link>
    </>
  );
}
