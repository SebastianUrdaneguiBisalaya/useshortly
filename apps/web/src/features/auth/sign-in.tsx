import { Google } from '@ridemountainpig/svgl-react';
import { useMemo } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import { useLogin } from '~/api/endpoints/auth/auth';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Link } from '~/components/ui/foundations/link/link';
import { Separator } from '~/components/ui/foundations/separator/separator';
import { Typography } from '~/components/ui/foundations/typography/typography';
import { useSessionStore } from '~/stores/session-store';
import { createSignInSchema } from './schemas';
import { useGoogleSignIn } from './use-google-sign-in';
import { useTranslate } from '~/hooks/use-translate';
import { authMeta } from './meta';

export const meta = authMeta('signIn');

export default function SignInPage() {
	const t = useTranslate();
	const navigate = useNavigate();
	const login = useLogin();
	const setSession = useSessionStore(state => state.setSession);
	const google = useGoogleSignIn();
	const schema = useMemo(() => createSignInSchema(t), [t]);

	return (
		<>
			<Typography.H2 className='border-none'>{t('auth.signIn.title')}</Typography.H2>
			<Form
				className='w-full'
				defaultValues={{
					email: '',
					password: '',
				}}
				mode='onSubmit'
				onSubmit={data =>
					login.mutate(
						{
							data,
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
						<Field name='email'>
							{field => (
								<Input errorMessage={field.error}>
									<Input.Label>{t('auth.common.email.label')}</Input.Label>
									<Input.Field autoComplete='off' autoFocus placeholder={t('auth.common.email.placeholder')} {...field.inputProps} />
								</Input>
							)}
						</Field>
						<Field name='password'>
							{field => (
								<Input errorMessage={field.error}>
									<Input.Label>{t('auth.common.password.label')}</Input.Label>
									<Input.Field autoComplete='off' placeholder={t('auth.common.password.placeholder')} type='password' {...field.inputProps} />
									<Input.PasswordToggle hideLabel={t('auth.common.password.hide')} showLabel={t('auth.common.password.show')} />
								</Input>
							)}
						</Field>
						<Form.Submit
							className='self-center w-full py-3'
							loading={login.isPending}
							lang={{
								loadingText: t('auth.signIn.submitting'),
							}}
						>
							{t('auth.signIn.submit')}
						</Form.Submit>
					</Layout.Stack>
				)}
			</Form>
			{google.enabled && (
				<>
					<Separator>{t('auth.common.or')}</Separator>
					<Button className='w-full py-3' disabled={google.isPending} onClick={google.signIn} type='button' variant='secondary'>
						<Button.Icon icon={<Google height={12} width={12} />} />
						<Button.Text>{t('auth.signIn.google')}</Button.Text>
					</Button>
				</>
			)}
			<Link as={RouterLink} className='self-center' to='/auth/forgot-password'>
				<Typography.Span className='text-foreground-secondary'>{t('auth.signIn.forgotPassword')}</Typography.Span>
			</Link>
			<Layout.HStack className='justify-between'>
				<Typography.Span>{t('auth.signIn.noAccount')}</Typography.Span>
				<Link as={RouterLink} className='text-xs' to='/auth/sign-up'>
					{t('auth.signIn.signUpLink')}
				</Link>
			</Layout.HStack>
		</>
	);
}
