import { Google } from "@ridemountainpig/svgl-react";
import { useMemo, useState } from "react";
import { Link as RouterLink } from "react-router";
import { Button } from "~/components/ui/actions-controls/button/button";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Separator } from "~/components/ui/foundations/separator/separator";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createSignInSchema } from "~/features/auth/schemas";
import { useTranslate } from "~/hooks/use-translate";

export default function SignInPage() {
  const t = useTranslate();
  const [googleError, setGoogleError] = useState<string | null>(null);
  const schema = useMemo(() => createSignInSchema(t), [
    t,
  ]);

  return (
    <>
      <Typography.H2 className="border-none">
        {t("auth.signIn.title")}
      </Typography.H2>
      <Form
        className="w-full"
        defaultValues={{
          email: "",
          password: "",
        }}
        mode="onSubmit"
        onSubmit={() => {}}
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
            <Field name="password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>{t("auth.common.password.label")}</Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={t("auth.common.password.placeholder")}
                    type="password"
                    {...field.inputProps}
                  />
                  <Input.PasswordToggle
                    hideLabel={t("auth.common.password.hide")}
                    showLabel={t("auth.common.password.show")}
                  />
                </Input>
              )}
            </Field>
            <Form.Submit
              className="self-center w-full py-3"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting
                ? t("auth.signIn.submitting")
                : t("auth.signIn.submit")}
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
      <Separator>{t("auth.common.or")}</Separator>
      <Button
        className="w-full py-3"
        onClick={() => {
          setGoogleError(null);
        }}
        type="button"
        variant="secondary"
      >
        <Button.Icon
          icon={
            <Google
              height={12}
              width={12}
            />
          }
        />
        <Button.Text>{t("auth.signIn.google")}</Button.Text>
      </Button>
      {googleError && (
        <Typography.Span
          className="text-xs text-destructive"
          role="alert"
        >
          {googleError}
        </Typography.Span>
      )}
      <Link
        as={RouterLink}
        className="self-center"
        to="/auth/forgot-password"
      >
        <Typography.Span className="text-foreground-secondary">
          {t("auth.signIn.forgotPassword")}
        </Typography.Span>
      </Link>
      <Layout.HStack className="justify-between">
        <Typography.Span>{t("auth.signIn.noAccount")}</Typography.Span>
        <Link
          as={RouterLink}
          className="text-xs"
          to="/auth/sign-up"
        >
          {t("auth.signIn.signUpLink")}
        </Link>
      </Layout.HStack>
    </>
  );
}
