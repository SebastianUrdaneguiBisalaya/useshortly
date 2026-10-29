import { useMemo } from 'react';
import { Link as RouterLink, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useVerifyRegistration } from '~/api/endpoints/auth/auth';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { InputOtp } from '~/components/ui/forms-inputs/input-otp/input-otp';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Link } from '~/components/ui/foundations/link/link';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { useTranslate } from '~/hooks/use-translate';
import { authMeta } from './meta';
import { useSessionStore } from '~/stores/session-store';
import { createVerifyEmailSchema, OTP_LENGTH } from './schemas';

export const meta = authMeta('verifyEmail');

export default function VerifyEmailPage() {
	const t = useTranslate();
	const [searchParams] = useSearchParams();
	const email = searchParams.get('email');
	const navigate = useNavigate();
	const verifyRegistration = useVerifyRegistration();
	const setSession = useSessionStore(state => state.setSession);
	const schema = useMemo(() => createVerifyEmailSchema(t), [t]);

	if (!email) return <Navigate replace to='/auth/sign-up' />;

	return (
		<>
			<Layout.Stack className='w-full items-center text-center' gap='sm'>
				<Typography.H2 className='border-none'>{t('auth.verifyEmail.title')}</Typography.H2>
				<Typography.Span className='text-foreground-secondary'>
					{t('auth.verifyEmail.description', {
						email,
					})}
				</Typography.Span>
			</Layout.Stack>
			<Form
				className='w-full'
				defaultValues={{
					code: '',
				}}
				mode='onSubmit'
				onSubmit={data =>
					verifyRegistration.mutate(
						{
							data: {
								code: data.code,
								email,
							},
						},
						{
							onSuccess: response => {
								if (response.data) setSession(response.data);
								void navigate('/', {
									replace: true,
								});
							},
						}
					)
				}
				schema={schema}
			>
				{({ Field }) => (
					<Layout.Stack>
						<Field name='code'>{field => <InputOtp errorMessage={field.error} label={t('auth.resetPassword.code.label')} length={OTP_LENGTH} {...field.changeProps} />}</Field>
						<Form.Submit
							className='self-center w-full py-3'
							loading={verifyRegistration.isPending}
							lang={{
								loadingText: t('auth.verifyEmail.submitting'),
							}}
						>
							{t('auth.verifyEmail.submit')}
						</Form.Submit>
					</Layout.Stack>
				)}
			</Form>
			<Link as={RouterLink} className='self-center' to='/auth/sign-in'>
				{t('auth.common.backToSignIn')}
			</Link>
		</>
	);
}
