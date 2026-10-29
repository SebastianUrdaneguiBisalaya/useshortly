import { useQueryClient } from '@tanstack/react-query';
import { useId, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getListApiKeysQueryKey, useCreateApiKey } from '~/api/endpoints/api-keys/api-keys';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Form } from '~/components/ui/forms-inputs/form/form';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';
import { createApiKeySchema } from './api-keys-schemas';

/** Asks for a name and scope, creates the key and then shows its secret once, ready to copy: the API never returns it again. */
export function CreateApiKeyDialog({ orgID, open, onOpenChange }: { orgID: number; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const createApiKey = useCreateApiKey();
	const schema = useMemo(() => createApiKeySchema(t), [t]);
	const [secret, setSecret] = useState<string>();

	const handleOpenChange = (next: boolean) => {
		if (!next) setSecret(undefined);
		onOpenChange(next);
	};

	return (
		<Modal.Root onOpenChange={handleOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId}>
				<Modal.Header>
					<Modal.Title id={titleId}>{secret ? t('protected.apiKeys.created.title') : t('protected.apiKeys.create.title')}</Modal.Title>
					<Modal.Description>{secret ? t('protected.apiKeys.created.description') : t('protected.apiKeys.create.description')}</Modal.Description>
				</Modal.Header>
				{secret ? (
					<>
						<Modal.Body>
							<Input>
								<Input.Label>{t('protected.apiKeys.created.label')}</Input.Label>
								<Input.Field readOnly type='password' value={secret} />
								<Input.CopyButton
									lang={{
										copied: t('protected.apiKeys.created.copied'),
										copy: t('protected.apiKeys.created.copy'),
									}}
								/>
							</Input>
						</Modal.Body>
						<Modal.Footer>
							<Button onClick={() => handleOpenChange(false)} type='button'>
								<Button.Text>{t('protected.apiKeys.created.done')}</Button.Text>
							</Button>
						</Modal.Footer>
					</>
				) : (
					<Form
						defaultValues={{
							name: '',
							scope: 'read',
						}}
						mode='onSubmit'
						onSubmit={data =>
							createApiKey.mutate(
								{
									data,
									orgID,
								},
								{
									onSuccess: async response => {
										await queryClient.invalidateQueries({
											queryKey: getListApiKeysQueryKey(orgID),
										});
										toast.success(t('protected.toast.apiKeyCreated'));
										setSecret(response.data?.secret);
										if (!response.data?.secret) onOpenChange(false);
									},
								}
							)
						}
						schema={schema}
					>
						{({ Field }) => (
							<>
								<Modal.Body>
									<div className='flex flex-col gap-4'>
										<Field name='name'>
											{field => (
												<Input errorMessage={field.error}>
													<Input.Label required>{t('protected.apiKeys.columns.name')}</Input.Label>
													<Input.Field autoComplete='off' autoFocus placeholder={t('protected.apiKeys.create.namePlaceholder')} {...field.inputProps} />
												</Input>
											)}
										</Field>
										<Field name='scope'>
											{field => (
												<Select.Root {...field.changeProps}>
													<Select.Label required>{t('protected.apiKeys.columns.scope')}</Select.Label>
													<Select.Trigger>
														<Select.Value />
													</Select.Trigger>
													<Select.Content>
														<Select.ItemList>
															<Select.Item value='read'>{t('protected.apiKeys.scopes.read')}</Select.Item>
															<Select.Item value='write'>{t('protected.apiKeys.scopes.write')}</Select.Item>
														</Select.ItemList>
													</Select.Content>
												</Select.Root>
											)}
										</Field>
									</div>
								</Modal.Body>
								<Modal.Footer>
									<Modal.Close>
										<Button type='button' variant='secondary'>
											<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
										</Button>
									</Modal.Close>
									<Form.Submit
										lang={{
											loadingText: t('protected.apiKeys.create.submitting'),
										}}
										loading={createApiKey.isPending}
									>
										{t('protected.apiKeys.create.submit')}
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
