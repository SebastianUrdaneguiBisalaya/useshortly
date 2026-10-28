import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListDomainsQueryKey, useCreateDomain, useListDomains } from '~/api/endpoints/domains/domains';
import { getListLinksQueryKey, useCreateLink } from '~/api/endpoints/links/links';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Combobox } from '~/components/ui/forms-inputs/combobox/combobox';
import { DatePicker } from '~/components/ui/forms-inputs/date-picker/date-picker';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { NumberInput } from '~/components/ui/forms-inputs/number-input/number-input';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { createLinkSchema } from './links-schemas';

const DOMAIN_LIMIT = 100;

/** Wide dialog (the link has many optional settings) that creates a link; the domain can be picked or typed to add a new one on the spot. */
export function CreateLinkDialog({ orgID, open, onOpenChange }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createLink = useCreateLink();
	const createDomain = useCreateDomain();
	const domains = useListDomains(orgID, { limit: DOMAIN_LIMIT });
	const schema = useMemo(() => createLinkSchema(t), [t]);
	const [newDomains, setNewDomains] = useState<{ id: number; host: string }[]>([]);

	const options = [...(domains.data?.data ?? []).flatMap(domain => (domain.id === undefined || !domain.host ? [] : [{ host: domain.host, id: domain.id }])), ...newDomains].filter(
		(domain, index, all) => all.findIndex(other => other.id === domain.id) === index
	);

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId} className='max-w-2xl'>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.links.create.title')}</Modal.Title>
					<Modal.Description>{t('protected.links.create.description')}</Modal.Description>
				</Modal.Header>
				<Form
					defaultValues={{
						alias: '',
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
								<div className='grid gap-4 sm:grid-cols-2'>
									<div className='sm:col-span-2'>
										<Field name='url'>
											{field => (
												<Input errorMessage={field.error}>
													<Input.Label>{t('protected.links.create.url.label')}</Input.Label>
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
