import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { z } from 'zod';
import { useDeleteAccount, useRequestAccountDeletion } from '~/api/endpoints/me/me';
import { DeleteAccountBody } from '~/api/zod/index.zod';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { InputOtp } from '~/components/ui/forms-inputs/input-otp/input-otp';
import { ConfirmDialog } from '~/components/ui/overlays-feedback/confirm-dialog/confirm-dialog';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { OTP_LENGTH } from '~/features/auth/schemas';
import { useTranslate } from '~/hooks/use-translate';
import { useSessionStore } from '~/stores/session-store';

/** Deleting an account takes two steps: confirm (which emails a code), then type that code. */
export function DeleteAccountButton() {
	const t = useTranslate();
	const requestDeletion = useRequestAccountDeletion();
	const [codeOpen, setCodeOpen] = useState(false);

	return (
		<>
			<ConfirmDialog.Root
				lang={{
					cancel: t('protected.confirm.cancel'),
					confirm: t('protected.account.confirm.continue'),
				}}
				onConfirm={async () => {
					await requestDeletion.mutateAsync();
					setCodeOpen(true);
				}}
				variant='destructive'
			>
				<ConfirmDialog.Trigger>
					<Button variant='destructive'>
						<Button.Text>{t('protected.account.danger.action')}</Button.Text>
					</Button>
				</ConfirmDialog.Trigger>
				<ConfirmDialog.Content>
					<ConfirmDialog.Title>{t('protected.account.confirm.title')}</ConfirmDialog.Title>
					<ConfirmDialog.Description>{t('protected.account.danger.description')}</ConfirmDialog.Description>
					<ConfirmDialog.Footer>
						<ConfirmDialog.Cancel />
						<ConfirmDialog.Confirm />
					</ConfirmDialog.Footer>
				</ConfirmDialog.Content>
			</ConfirmDialog.Root>
			<DeleteAccountCodeDialog onOpenChange={setCodeOpen} open={codeOpen} />
		</>
	);
}

function DeleteAccountCodeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const clearSession = useSessionStore(state => state.clearSession);
	const deleteAccount = useDeleteAccount();
	const schema = useMemo(
		() =>
			DeleteAccountBody.required().extend({
				code: z.string().length(
					OTP_LENGTH,
					t('auth.validation.codeInvalid', {
						length: OTP_LENGTH,
					})
				),
			}),
		[t]
	);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.account.code.title')}</Modal.Title>
					<Modal.Description>{t('protected.account.code.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{
						code: '',
					}}
					mode='onSubmit'
					onSubmit={data =>
						deleteAccount.mutate(
							{
								data,
							},
							{
								onSuccess: () => {
									clearSession();
									queryClient.clear();
									void navigate('/auth/sign-in', {
										replace: true,
									});
								},
							}
						)
					}
					schema={schema}
				>
					{({ Field }) => (
						<>
							<Modal.Body>
								<Field name='code'>{field => <InputOtp errorMessage={field.error} label={t('auth.resetPassword.code.label')} length={OTP_LENGTH} {...field.changeProps} />}</Field>
							</Modal.Body>
							<Modal.Footer>
								<Modal.Close>
									<Button type='button' variant='secondary'>
										<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
									</Button>
								</Modal.Close>
								<Form.Submit
									lang={{
										loadingText: t('protected.account.code.submitting'),
									}}
									loading={deleteAccount.isPending}
									variant='destructive'
								>
									{t('protected.account.code.submit')}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}
