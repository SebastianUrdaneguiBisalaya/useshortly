import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { toast } from 'sonner';
import { getGetCampaignQueryKey, getListCampaignsQueryKey, useCreateCampaign, useUpdateCampaign } from '~/api/endpoints/campaigns/campaigns';
import type { Campaign } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Layout } from '~/components/ui/layout/layout/layout';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { diffPayload } from '~/utils/diff-payload';
import { CAMPAIGN_DESCRIPTION_MAX_LENGTH, CAMPAIGN_NAME_MAX_LENGTH, createCampaignSchema } from './campaigns-schemas';

/**
 * Asks for the name and description of a campaign. Without `campaign` it creates one; with it, it edits that one and
 * only sends what changed (nothing at all when nothing did).
 */
export function CampaignDialog({ orgID, open, onOpenChange, campaign }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void; campaign?: Campaign }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createCampaign = useCreateCampaign();
	const updateCampaign = useUpdateCampaign();
	const campaignID = campaign?.id;
	const editing = campaignID !== undefined;
	const mutation = editing ? updateCampaign : createCampaign;
	const original = {
		description: campaign?.description ?? '',
		name: campaign?.name ?? '',
	};
	const i18nPrefix = editing ? 'protected.campaigns.edit' : 'protected.campaigns.create';
	const schema = useMemo(() => createCampaignSchema(t), [t]);

	const refresh = async (id?: number) => {
		await queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) });
		if (id !== undefined) await queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(orgID, id) });
	};

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
							updateCampaign.mutate(
								{ campaignID, data: changes, orgID },
								{
									onSuccess: async () => {
										await refresh(campaignID);
										toast.success(t('protected.toast.campaignUpdated'));
										onOpenChange(false);
									},
								}
							);
							return;
						}
						createCampaign.mutate(
							{ data, orgID },
							{
								onSuccess: async () => {
									await refresh();
									toast.success(t('protected.toast.campaignCreated'));
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
											<Input errorMessage={field.error} maxLength={CAMPAIGN_NAME_MAX_LENGTH}>
												<Input.Label required>{t('protected.campaigns.form.name.label')}</Input.Label>
												<Input.Field autoComplete='off' autoFocus placeholder={t('protected.campaigns.form.name.placeholder')} {...field.inputProps} />
											</Input>
										)}
									</Field>
									<Field name='description'>
										{field => (
											<Input errorMessage={field.error} maxLength={CAMPAIGN_DESCRIPTION_MAX_LENGTH}>
												<Input.Label>{t('protected.campaigns.form.description.label')}</Input.Label>
												<Input.Textarea placeholder={t('protected.campaigns.form.description.placeholder')} rows={3} {...field.inputProps} />
											</Input>
										)}
									</Field>
								</Layout.Stack>
							</Modal.Body>
							<Modal.Footer>
								<Modal.Close>
									<Button type='button' variant='secondary'>
										<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
									</Button>
								</Modal.Close>
								<Form.Submit lang={{ loadingText: t(`${i18nPrefix}.submitting`) }} loading={mutation.isPending}>
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
