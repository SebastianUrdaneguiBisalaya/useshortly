import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useListCampaignChannels } from '~/api/endpoints/campaigns/campaigns';
import { getListDomainsQueryKey, useCreateDomain, useListDomains } from '~/api/endpoints/domains/domains';
import { getListLinksQueryKey, useCreateLink } from '~/api/endpoints/links/links';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Combobox } from '~/components/ui/forms-inputs/combobox/combobox';
import { DatePicker } from '~/components/ui/forms-inputs/date-picker/date-picker';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { NumberInput } from '~/components/ui/forms-inputs/number-input/number-input';
import { Alert } from '~/components/ui/overlays-feedback/alert/alert';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { useAllCampaigns } from '../campaigns/use-all-campaigns';
import { MAX_DESTINATION_LENGTH, withUtm } from '../campaigns/utm';
import { createLinkSchema } from './links-schemas';

const DOMAIN_LIMIT = 100;
/** A campaign has at most 100 channels, so one request lists them all. */
const CHANNEL_LIMIT = 100;

/**
 * Wide dialog (the link has many optional settings) that creates a link; the domain can be picked or typed to add a new one
 * on the spot, and the link can be put in a campaign channel, which adds the channel's UTM parameters to its destination.
 */
export function CreateLinkDialog({ orgID, open, onOpenChange }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createLink = useCreateLink();
	const createDomain = useCreateDomain();
	const domains = useListDomains(orgID, { limit: DOMAIN_LIMIT });
	const schema = useMemo(() => createLinkSchema(t), [t]);
	const [campaignID, setCampaignID] = useState<number>();
	const campaigns = useAllCampaigns(orgID, { enabled: open });
	const channels = useListCampaignChannels(orgID, campaignID ?? 0, { limit: CHANNEL_LIMIT }, { query: { enabled: open && campaignID !== undefined } });
	const [newDomains, setNewDomains] = useState<{ id: number; host: string }[]>([]);

	const options = [...(domains.data?.data ?? []).flatMap(domain => (domain.id === undefined || !domain.host ? [] : [{ host: domain.host, id: domain.id }])), ...newDomains].filter(
		(domain, index, all) => all.findIndex(other => other.id === domain.id) === index
	);

	const handleOpenChange = (next: boolean) => {
		if (!next) setCampaignID(undefined);
		onOpenChange(next);
	};

	return (
		<Modal.Root onOpenChange={handleOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId} className='max-w-2xl'>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.links.create.title')}</Modal.Title>
					<Modal.Description>{t('protected.links.create.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{
						alias: '',
						campaign_id: undefined,
						channel_id: undefined,
						domain_id: undefined,
						expires_at: '',
						max_clicks: undefined,
						password: '',
						url: '',
					}}
					mode='onSubmit'
					onSubmit={data =>
						createLink.mutate(
							{
								data: {
									alias: data.alias || undefined,
									channel_id: data.channel_id,
									domain_id: data.domain_id,
									expires_at: data.expires_at || undefined,
									max_clicks: data.max_clicks,
									password: data.password || undefined,
									url: data.url,
								},
								orgID,
							},
							{
								onSuccess: async () => {
									await queryClient.invalidateQueries({ queryKey: getListLinksQueryKey(orgID) });
									toast.success(t('protected.toast.linkCreated'));
									handleOpenChange(false);
								},
							}
						)
					}
					schema={schema}
				>
					{({ Field, form }) => (
						<>
							<Modal.Body>
								<div className='grid gap-4 sm:grid-cols-2'>
									<div className='sm:col-span-2'>
										<Field name='url'>
											{field => (
												<Input errorMessage={field.error}>
													<Input.Label required>{t('protected.links.create.url.label')}</Input.Label>
													<Input.Field autoComplete='off' autoFocus inputMode='url' placeholder={t('protected.links.create.url.placeholder')} {...field.inputProps} />
												</Input>
											)}
										</Field>
									</div>
									<Field name='alias'>
										{field => (
											<Input errorMessage={field.error}>
												<Input.Label>{t('protected.links.create.alias.label')}</Input.Label>
												<Input.Help description={t('protected.links.create.alias.hint')} />
												<Input.Field autoComplete='off' placeholder={t('protected.links.create.alias.placeholder')} {...field.inputProps} />
											</Input>
										)}
									</Field>
									<Field name='domain_id'>
										{field => (
											<Combobox
												errorMessage={field.error}
												lang={{ clearSelection: t('protected.links.create.domain.clear') }}
												loading={domains.isLoading || createDomain.isPending}
												onCreate={host =>
													createDomain.mutate(
														{ data: { host: host.trim().toLowerCase() }, orgID },
														{
															onSuccess: async response => {
																const created = response.data;
																if (created?.id === undefined || !created.host) return;
																setNewDomains(current => [...current, { host: created.host as string, id: created.id as number }]);
																field.changeProps.onChange(created.id);
																toast.success(t('protected.toast.domainCreated'));
																await queryClient.invalidateQueries({ queryKey: getListDomainsQueryKey(orgID) });
															},
														}
													)
												}
												onValueChange={value => field.changeProps.onChange(value === null ? undefined : Number(value))}
												value={field.changeProps.value === undefined ? null : String(field.changeProps.value)}
											>
												<Combobox.Label>{t('protected.links.create.domain.label')}</Combobox.Label>
												<Combobox.Input placeholder={t('protected.links.create.domain.placeholder')} />
												<Combobox.Content>
													{options.map(domain => (
														<Combobox.Item key={domain.id} value={String(domain.id)}>
															{domain.host}
														</Combobox.Item>
													))}
												</Combobox.Content>
											</Combobox>
										)}
									</Field>
									<Field name='expires_at'>
										{field => (
											<DatePicker.Root
												granularity='minute'
												minDate={new Date()}
												minuteStep={5}
												onChange={value => field.changeProps.onChange(value ? value.toISOString() : '')}
												value={field.changeProps.value ? new Date(field.changeProps.value) : null}
											>
												<DatePicker.Label>{t('protected.links.create.expires.label')}</DatePicker.Label>
												<DatePicker.Trigger />
												<DatePicker.Content />
											</DatePicker.Root>
										)}
									</Field>
									<Field name='max_clicks'>
										{field => (
											<NumberInput.Root
												errorMessage={field.error}
												min={1}
												onValueChange={value => field.valueProps.onValueChange(value ?? undefined)}
												value={field.valueProps.value ?? null}
											>
												<NumberInput.Label>{t('protected.links.create.maxClicks.label')}</NumberInput.Label>
												<NumberInput.Decrement />
												<NumberInput.Field />
												<NumberInput.Increment />
											</NumberInput.Root>
										)}
									</Field>
									<Field name='campaign_id'>
										{field => (
											<Combobox
												lang={{ clearSelection: t('protected.links.create.campaign.clear') }}
												loading={campaigns.isLoading}
												onValueChange={value => {
													const id = value === null ? undefined : Number(value);
													field.changeProps.onChange(id);
													setCampaignID(id);
													// A channel belongs to one campaign, so changing the campaign drops it.
													form.setValue('channel_id', undefined);
												}}
												value={field.changeProps.value === undefined ? null : String(field.changeProps.value)}
											>
												<Combobox.Label>{t('protected.links.create.campaign.label')}</Combobox.Label>
												<Combobox.Input placeholder={t('protected.links.create.campaign.placeholder')} />
												<Combobox.Content>
													{campaigns.campaigns.map(campaign => (
														<Combobox.Item key={campaign.id} value={String(campaign.id)}>
															{campaign.name}
														</Combobox.Item>
													))}
												</Combobox.Content>
											</Combobox>
										)}
									</Field>
									<Field name='channel_id'>
										{field => (
											<Combobox
												disabled={campaignID === undefined}
												errorMessage={field.error}
												lang={{ clearSelection: t('protected.links.create.channel.clear') }}
												loading={channels.isLoading}
												onValueChange={value => field.changeProps.onChange(value === null ? undefined : Number(value))}
												value={field.changeProps.value === undefined ? null : String(field.changeProps.value)}
											>
												<Combobox.Label>{t('protected.links.create.channel.label')}</Combobox.Label>
												<Combobox.Input placeholder={t('protected.links.create.channel.placeholder')} />
												<Combobox.Content>
													{(channels.data?.data ?? []).map(channel => (
														<Combobox.Item key={channel.id} value={String(channel.id)}>
															{channel.name}
														</Combobox.Item>
													))}
												</Combobox.Content>
											</Combobox>
										)}
									</Field>
									<ChannelPreview
										campaign={campaigns.campaigns.find(campaign => campaign.id === campaignID)?.name}
										channel={channels.data?.data?.find(channel => channel.id === form.watch('channel_id'))?.name}
										url={form.watch('url')}
									/>
									<div className='sm:col-span-2'>
										<Field name='password'>
											{field => (
												<Input errorMessage={field.error}>
													<Input.Label>{t('protected.links.create.password.label')}</Input.Label>
													<Input.Field autoComplete='new-password' placeholder={t('protected.links.create.password.placeholder')} type='password' {...field.inputProps} />
													<Input.PasswordToggle />
												</Input>
											)}
										</Field>
									</div>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Modal.Close>
									<Button type='button' variant='secondary'>
										<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
									</Button>
								</Modal.Close>
								<Form.Submit lang={{ loadingText: t('protected.links.create.submitting') }} loading={createLink.isPending}>
									{t('protected.links.create.submit')}
								</Form.Submit>
							</Modal.Footer>
						</>
					)}
				</Form>
			</Modal.Content>
		</Modal.Root>
	);
}

/** Shows the destination the link will have once it is in the channel, so the added UTM parameters are no surprise. */
function ChannelPreview({ url, campaign, channel }: { url: string; campaign?: string; channel?: string }) {
	const t = useTranslate();
	const destination = url.trim();
	let valid = false;
	try {
		valid = ['http:', 'https:'].includes(new URL(destination).protocol);
	} catch {}
	if (!campaign || !channel || !valid) return null;

	const final = withUtm(destination, campaign, channel);
	return (
		<div className='flex flex-col gap-2 sm:col-span-2'>
			<p className='font-medium text-sm'>{t('protected.links.create.preview.label')}</p>
			<code className='break-all rounded-md bg-muted px-3 py-2 font-mono text-xs'>{final}</code>
			{final.length > MAX_DESTINATION_LENGTH && (
				<Alert variant='warning'>
					<Alert.Description>{t('protected.links.create.preview.tooLong', { max: MAX_DESTINATION_LENGTH })}</Alert.Description>
				</Alert>
			)}
		</div>
	);
}
