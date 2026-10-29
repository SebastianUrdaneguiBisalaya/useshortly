import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListDomainsQueryKey, useCreateDomain } from '~/api/endpoints/domains/domains';
import type { Domain } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { createDomainSchema } from './domains-schemas';

/** Asks for the host and, once added, shows the DNS record to create so the domain can be verified. */
export function CreateDomainDialog({ orgID, open, onOpenChange }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createDomain = useCreateDomain();
	const schema = useMemo(() => createDomainSchema(t), [t]);
	const [created, setCreated] = useState<Domain>();

	const handleOpenChange = (next: boolean) => {
		if (!next) setCreated(undefined);
		onOpenChange(next);
	};
	const copyLang = { copied: t('protected.domains.record.copied'), copy: t('protected.domains.record.copy') };

	return (
		<Modal.Root onOpenChange={handleOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{created ? created.host : t('protected.domains.create.title')}</Modal.Title>
					<Modal.Description>{created ? t('protected.domains.record.hint') : t('protected.domains.create.description')}</Modal.Description>
				</Modal.Header>
				{created ? (
					<>
						<Modal.Body>
							<div className='flex flex-col gap-4'>
								<Input>
									<Input.Label>{t('protected.domains.record.type')}</Input.Label>
									<Input.Field readOnly value={created.verification?.type ?? ''} />
									<Input.CopyButton lang={copyLang} />
								</Input>
								<Input>
									<Input.Label>{t('protected.domains.record.name')}</Input.Label>
									<Input.Field readOnly value={created.verification?.name ?? ''} />
									<Input.CopyButton lang={copyLang} />
								</Input>
								<Input>
									<Input.Label>{t('protected.domains.record.value')}</Input.Label>
									<Input.Field readOnly value={created.verification?.value ?? ''} />
									<Input.CopyButton lang={copyLang} />
								</Input>
							</div>
						</Modal.Body>
						<Modal.Footer>
							<Button onClick={() => handleOpenChange(false)} type='button'>
								<Button.Text>{t('protected.apiKeys.created.done')}</Button.Text>
							</Button>
						</Modal.Footer>
					</>
				) : (
					<Form
						defaultValues={{ host: '' }}
						mode='onSubmit'
						onSubmit={data =>
							createDomain.mutate(
								{ data: { host: data.host.toLowerCase() }, orgID },
								{
									onSuccess: async response => {
										await queryClient.invalidateQueries({ queryKey: getListDomainsQueryKey(orgID) });
										toast.success(t('protected.toast.domainCreated'));
										if (response.data?.verification) setCreated(response.data);
										else handleOpenChange(false);
									},
								}
							)
						}
						schema={schema}
					>
						{({ Field }) => (
							<>
								<Modal.Body>
									<Field name='host'>
										{field => (
											<Input errorMessage={field.error}>
												<Input.Label required>{t('protected.domains.create.host.label')}</Input.Label>
												<Input.Field autoComplete='off' autoFocus placeholder={t('protected.domains.create.host.placeholder')} {...field.inputProps} />
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
									<Form.Submit lang={{ loadingText: t('protected.domains.create.submitting') }} loading={createDomain.isPending}>
										{t('protected.domains.create.submit')}
									</Form.Submit>
								</Modal.Footer>
							</>
						)}
					</Form>
				)}
			</Modal.Content>
		</Modal.Root>
	);
}
