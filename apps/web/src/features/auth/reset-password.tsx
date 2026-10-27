import { useMemo } from "react";
import {
  Link as RouterLink,
  Navigate,
  useNavigate,
  useSearchParams,
} from "react-router";
import { toast } from "sonner";
import { useResetPassword } from "~/api/endpoints/auth/auth";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { InputOtp } from "~/components/ui/forms-inputs/input-otp/input-otp";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createResetPasswordSchema, OTP_LENGTH } from "./schemas";
import { useTranslate } from "~/hooks/use-translate";

export default function ResetPasswordPage() {
  const t = useTranslate();
  const [searchParams] = useSearchParams();
  const email = searchParams.get("email");
  const navigate = useNavigate();
  const resetPassword = useResetPassword();
  const schema = useMemo(() => createResetPasswordSchema(t), [
    t,
  ]);

  if (!email) return <Navigate replace to="/auth/forgot-password" />;

  return (
    <>
      <Layout.Stack
        className="w-full items-center text-center"
        gap="sm"
      >
        <Typography.H2 className="border-none">
          {t("auth.resetPassword.title")}
        </Typography.H2>
        <Typography.Span className="text-foreground-secondary">
          {t("auth.resetPassword.description", {
            email,
          })}
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
        onSubmit={(data) =>
          resetPassword.mutate(
            {
              data: {
                code: data.code,
                email,
                new_password: data.new_password,
              },
            },
            {
              onSuccess: () => {
                toast.success(t("auth.resetPassword.success"));
                void navigate("/auth/sign-in", {
                  replace: true,
                });
              },
            },
          )
        }
        schema={schema}
      >
        {({ Field }) => (
          <Layout.Stack>
            <Field name="code">
              {(field) => (
                <InputOtp
                  errorMessage={field.error}
                  label={t("auth.resetPassword.code.label")}
                  length={OTP_LENGTH}
                  {...field.changeProps}
                />
              )}
            </Field>
            <Field name="new_password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>
                    {t("auth.resetPassword.newPassword.label")}
                  </Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={t("auth.resetPassword.newPassword.placeholder")}
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
            <Field name="confirm_password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>
                    {t("auth.resetPassword.confirmPassword.label")}
                  </Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={t(
                      "auth.resetPassword.confirmPassword.placeholder",
                    )}
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
              loading={resetPassword.isPending}
              lang={{
                loadingText: t("auth.resetPassword.submitting"),
              }}
            >
              {t("auth.resetPassword.submit")}
            </Form.Submit>
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
