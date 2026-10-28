import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { getListMyOrganizationsQueryKey, useCreateOrganization } from '~/api/endpoints/orgs/orgs';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { createOrganizationSchema } from './organization-schemas';
import { useOrganizationParam } from './use-current-organization';

/** Asks for the name and description of a new organization, creates it and switches to it. */
export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const [, setOrganizationId] = useOrganizationParam();
	const createOrganization = useCreateOrganization();
	const schema = useMemo(() => createOrganizationSchema(t), [t]);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.organization.create.title')}</Modal.Title>
					<Modal.Description>{t('protected.organization.create.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{
						description: '',
						name: '',
					}}
					mode='onSubmit'
					onSubmit={data =>
						createOrganization.mutate(
							{
								data,
							},
							{
								onSuccess: async response => {
									await queryClient.invalidateQueries({
										queryKey: getListMyOrganizationsQueryKey(),
									});
									if (response.data?.id !== undefined) await setOrganizationId(response.data.id);
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
								<Layout.Stack>
									<Field name='name'>
										{field => (
											<Input errorMessage={field.error}>
												<Input.Label>{t('protected.organization.create.name.label')}</Input.Label>
												<Input.Field autoComplete='off' autoFocus placeholder={t('protected.organization.create.name.placeholder')} {...field.inputProps} />
											</Input>
										)}
									</Field>
									<Field name='description'>
										{field => (
											<Input errorMessage={field.error}>
												<Input.Label>{t('protected.organization.create.descriptionField.label')}</Input.Label>
												<Input.Field autoComplete='off' placeholder={t('protected.organization.create.descriptionField.placeholder')} {...field.inputProps} />
											</Input>
										)}
									</Field>
								</Layout.Stack>
							</Modal.Body>
							<Modal.Footer>
								<Modal.Close>
									<Button type='button' variant='secondary'>
										<Button.Text>{t('protected.organization.create.cancel')}</Button.Text>
									</Button>
								</Modal.Close>
								<Form.Submit
									loading={createOrganization.isPending}
									lang={{
										loadingText: t('protected.organization.create.submitting'),
									}}
								>
									{t('protected.organization.create.submit')}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}
