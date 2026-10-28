import { useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { getGetLinkUnlockPageQueryKey, useDeleteLinkUnlockPage, useSetLinkUnlockPage } from '~/api/endpoints/unlock-page/unlock-page';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { CodePreview } from '~/components/ui/code-content/code-preview/code-preview';
import { Modal } from '~/components/ui/overlays-feedback/modal/modal';
import { useTranslate } from '~/hooks/use-translate';

/** Large dialog to write the HTML visitors see when they must type the link's password, with a live sandboxed preview next to the editor. */
export function UnlockPageDialog({ orgID, link, saved, open, onOpenChange }: { orgID: number; link: Link; saved: string | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
	const t = useTranslate();
	const titleId = useId();
	const queryClient = useQueryClient();
	const linkID = link.id as number;
	const save = useSetLinkUnlockPage();
	const remove = useDeleteLinkUnlockPage();
	const [html, setHtml] = useState(saved ?? '');
	const refresh = () => queryClient.invalidateQueries({ queryKey: getGetLinkUnlockPageQueryKey(orgID, linkID) });

	return (
		<Modal.Root onOpenChange={onOpenChange} open={open}>
			<Modal.Content aria-labelledby={titleId} className='flex h-[85vh] max-w-6xl flex-col'>
				<Modal.Header>
					<Modal.Title id={titleId}>{t('protected.links.drawer.unlock.title')}</Modal.Title>
					<Modal.Description>{t('protected.links.drawer.unlock.description')}</Modal.Description>
				</Modal.Header>
				<Modal.Body className='flex min-h-0 flex-1 flex-col'>
					<CodePreview.Root
						ariaLabel={t('protected.links.drawer.unlock.label')}
						className='min-h-0 flex-1 overflow-hidden rounded-md border border-border'
						language='html'
						lang={{
							device: t('protected.links.drawer.unlock.preview.device'),
							deviceFull: t('protected.links.drawer.unlock.preview.full'),
							deviceMobile: t('protected.links.drawer.unlock.preview.mobile'),
							deviceTablet: t('protected.links.drawer.unlock.preview.tablet'),
							error: t('protected.links.drawer.unlock.preview.error'),
							preview: t('protected.links.drawer.unlock.preview.title'),
							reset: t('protected.links.drawer.unlock.preview.reset'),
							run: t('protected.links.drawer.unlock.preview.run'),
						}}
						onValueChange={setHtml}
						value={html}
					>
						<CodePreview.Body>
							<CodePreview.Editor />
							<CodePreview.Handle />
							<CodePreview.Preview />
						</CodePreview.Body>
					</CodePreview.Root>
				</Modal.Body>
				<Modal.Footer>
					<Button
						className='mr-auto'
						disabled={!saved || remove.isPending}
						onClick={() =>
							remove.mutate(
								{ linkID, orgID },
								{
									onSuccess: async () => {
										await refresh();
										onOpenChange(false);
									},
								}
							)
						}
						type='button'
						variant='secondary'
					>
						<Button.Text>{t('protected.links.drawer.unlock.remove')}</Button.Text>
					</Button>
					<Modal.Close>
						<Button type='button' variant='secondary'>
							<Button.Text>{t('protected.confirm.cancel')}</Button.Text>
						</Button>
					</Modal.Close>
					<Button
						disabled={!html.trim() || save.isPending}
						onClick={() =>
							save.mutate(
								{ data: { html }, linkID, orgID },
								{
									onSuccess: async () => {
										await refresh();
										onOpenChange(false);
									},
								}
							)
						}
						type='button'
					>
						<Button.Text>{save.isPending ? t('protected.links.drawer.unlock.saving') : t('protected.links.drawer.unlock.save')}</Button.Text>
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}
