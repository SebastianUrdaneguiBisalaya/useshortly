import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { toast } from 'sonner';
import { getListMyOrganizationsQueryKey, useCreateOrganization, useUpdateOrganization } from '~/api/endpoints/orgs/orgs';
import type { Organization } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { diffPayload } from '~/utils/diff-payload';
import { createOrganizationSchema } from './organization-schemas';
import { useOrganizationParam } from './use-current-organization';

/**
 * Asks for the name and description of an organization. Without `organization` it creates one and switches to it;
 * with it, it edits that one and only sends what changed (nothing at all when nothing did).
 */
export function OrganizationDialog({ open, onOpenChange, organization }: { open: boolean; onOpenChange: (open: boolean) => void; organization?: Organization }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const [, setOrganizationId] = useOrganizationParam();
	const createOrganization = useCreateOrganization();
	const updateOrganization = useUpdateOrganization();
	const organizationId = organization?.id;
	const editing = organizationId !== undefined;
	const mutation = editing ? updateOrganization : createOrganization;
	const original = {
		description: organization?.description ?? '',
		name: organization?.name ?? '',
	};
	const i18nPrefix = editing ? 'protected.organization.edit' : 'protected.organization.create';
	const schema = useMemo(() => createOrganizationSchema(t), [t]);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t(`${i18nPrefix}.title`)}</Modal.Title>
					<Modal.Description>{t(`${i18nPrefix}.description`)}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={original}
					mode='onSubmit'
					onSubmit={data => {
						if (editing) {
							const changes = diffPayload(original, data);
							if (Object.keys(changes).length === 0) {
								onOpenChange(false);
								return;
							}
							updateOrganization.mutate(
								{
									data: changes,
									orgID: organizationId,
								},
								{
									onSuccess: async () => {
										await queryClient.invalidateQueries({
											queryKey: getListMyOrganizationsQueryKey(),
										});
										toast.success(t('protected.toast.organizationUpdated'));
										onOpenChange(false);
									},
								}
							);
							return;
						}
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
									toast.success(t('protected.toast.organizationCreated'));
									onOpenChange(false);
								},
							}
						);
					}}
					schema={schema}
				>
					{({ Field }) => (
						<>
							<Modal.Body>
								<Layout.Stack>
									<Field name='name'>
										{field => (
											<Input errorMessage={field.error}>
												<Input.Label required>{t('protected.organization.create.name.label')}</Input.Label>
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
									loading={mutation.isPending}
									lang={{
										loadingText: t(`${i18nPrefix}.submitting`),
									}}
								>
									{t(`${i18nPrefix}.submit`)}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}
