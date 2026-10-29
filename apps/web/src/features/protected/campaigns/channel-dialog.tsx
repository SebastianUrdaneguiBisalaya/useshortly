import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo } from 'react';
import { toast } from 'sonner';
import { getGetCampaignQueryKey, getListCampaignChannelsQueryKey, getListCampaignsQueryKey, useCreateCampaignChannel } from '~/api/endpoints/campaigns/campaigns';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { CHANNEL_NAME_MAX_LENGTH, createChannelSchema } from './campaigns-schemas';

/** Asks for the name of a new channel of a campaign. The name becomes the `utm_source` of the links put in it. */
export function ChannelDialog({ orgID, campaignID, open, onOpenChange }: { orgID: number; campaignID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createChannel = useCreateCampaignChannel();
	const schema = useMemo(() => createChannelSchema(t), [t]);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.campaigns.channelForm.title')}</Modal.Title>
					<Modal.Description>{t('protected.campaigns.channelForm.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{ name: '' }}
					mode='onSubmit'
					onSubmit={data =>
						createChannel.mutate(
							{ campaignID, data, orgID },
							{
								onSuccess: async () => {
									await Promise.all([
										queryClient.invalidateQueries({ queryKey: getListCampaignChannelsQueryKey(orgID, campaignID) }),
										queryClient.invalidateQueries({ queryKey: getGetCampaignQueryKey(orgID, campaignID) }),
										queryClient.invalidateQueries({ queryKey: getListCampaignsQueryKey(orgID) }),
									]);
									toast.success(t('protected.toast.channelCreated'));
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
								<Field name='name'>
									{field => (
										<Input errorMessage={field.error} maxLength={CHANNEL_NAME_MAX_LENGTH}>
											<Input.Label required>{t('protected.campaigns.channelForm.name.label')}</Input.Label>
											<Input.Field autoComplete='off' autoFocus placeholder={t('protected.campaigns.channelForm.name.placeholder')} {...field.inputProps} />
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
								<Form.Submit lang={{ loadingText: t('protected.campaigns.channelForm.submitting') }} loading={createChannel.isPending}>
									{t('protected.campaigns.channelForm.submit')}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}
