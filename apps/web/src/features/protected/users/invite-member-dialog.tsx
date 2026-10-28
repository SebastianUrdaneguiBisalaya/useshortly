import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { toast } from 'sonner';
import { getListInvitationsQueryKey, useInviteMember } from '~/api/endpoints/orgs/orgs';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { inviteMemberSchema } from './users-schemas';

/** Asks for an email and invites that person to the organization. */
export function InviteMemberDialog({ orgID, open, onOpenChange }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const inviteMember = useInviteMember();
	const schema = useMemo(() => inviteMemberSchema(t), [t]);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.users.invite.title')}</Modal.Title>
					<Modal.Description>{t('protected.users.invite.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{
						email: '',
					}}
					mode='onSubmit'
					onSubmit={data =>
						inviteMember.mutate(
							{
								data,
								orgID,
							},
							{
								onSuccess: async () => {
									await queryClient.invalidateQueries({
										queryKey: getListInvitationsQueryKey(orgID),
									});
									toast.success(t('protected.toast.memberInvited'));
									onOpenChange(false);
								},
							}
						)
					}
					schema={schema}
				>
					{({ Field }) => (
						<>
							<Modal.Body>
								<Field name='email'>
									{field => (
										<Input errorMessage={field.error}>
											<Input.Label>{t('protected.users.invite.email')}</Input.Label>
											<Input.Field autoComplete='off' autoFocus placeholder='name@company.com' type='email' {...field.inputProps} />
										</Input>
									)}
								</Field>
							</Modal.Body>
							<Modal.Footer>
								<Modal.Close>
									<Button type='button' variant='secondary'>
										<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
									</Button>
								</Modal.Close>
								<Form.Submit
									lang={{
										loadingText: t('protected.users.invite.submitting'),
									}}
									loading={inviteMember.isPending}
								>
									{t('protected.users.invite.submit')}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}
