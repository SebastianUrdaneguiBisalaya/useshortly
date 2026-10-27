import { useLingui } from "@lingui/react";
import { Google } from "@ridemountainpig/svgl-react";
import { useMemo } from "react";
import { Link as RouterLink } from "react-router";
import { Button } from "~/components/ui/actions-controls/button/button";
import { Form } from "~/components/ui/forms-inputs/form/form";
import { Input } from "~/components/ui/forms-inputs/input/input";
import { Layout } from "~/components/ui/layout/layout/layout";
import { Link } from "~/components/ui/foundations/link/link";
import { Separator } from "~/components/ui/foundations/separator/separator";
import { Typography } from "~/components/ui/foundations/typography/typography";
import { createSignUpSchema } from "~/features/auth/schemas";

export default function SignUpPage() {
  const { _ } = useLingui();
  const schema = useMemo(() => createSignUpSchema(_), [
    _,
  ]);

  return (
    <>
      <Typography.H2 className="border-none">
        {_("auth.signUp.title")}
      </Typography.H2>
      <Form
        className="w-full"
        defaultValues={{
          email: "",
          first_name: "",
          last_name: "",
          password: "",
        }}
        mode="onSubmit"
        onSubmit={() => {}}
        schema={schema}
      >
        {({ Field, form }) => (
          <Layout.Stack>
            <Layout.HStack
              align="start"
              className="w-full"
            >
              <Field name="first_name">
                {(field) => (
                  <Input errorMessage={field.error}>
                    <Input.Label>
                      {_("auth.signUp.firstName.label")}
                    </Input.Label>
                    <Input.Field
                      autoComplete="off"
                      autoFocus
                      placeholder={_("auth.signUp.firstName.placeholder")}
                      {...field.inputProps}
                    />
                  </Input>
                )}
              </Field>
              <Field name="last_name">
                {(field) => (
                  <Input errorMessage={field.error}>
                    <Input.Label>{_("auth.signUp.lastName.label")}</Input.Label>
                    <Input.Field
                      autoComplete="off"
                      placeholder={_("auth.signUp.lastName.placeholder")}
                      {...field.inputProps}
                    />
                  </Input>
                )}
              </Field>
            </Layout.HStack>
            <Field name="email">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>{_("auth.common.email.label")}</Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={_("auth.common.email.placeholder")}
                    {...field.inputProps}
                  />
                </Input>
              )}
            </Field>
            <Field name="password">
              {(field) => (
                <Input errorMessage={field.error}>
                  <Input.Label>{_("auth.common.password.label")}</Input.Label>
                  <Input.Field
                    autoComplete="off"
                    placeholder={_("auth.common.password.placeholder")}
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
                ? _("auth.signUp.submitting")
                : _("auth.signUp.submit")}
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
      <Separator>{_("auth.common.or")}</Separator>
      <Button
        className="w-full py-3"
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
        <Button.Text>{_("auth.signUp.google")}</Button.Text>
      </Button>
      <Layout.HStack className="justify-between">
        <Typography.Span>{_("auth.signUp.haveAccount")}</Typography.Span>
        <Link
          as={RouterLink}
          className="text-xs"
          to="/auth/sign-in"
        >
          {_("auth.signUp.signInLink")}
        </Link>
      </Layout.HStack>
    </>
  );
}
