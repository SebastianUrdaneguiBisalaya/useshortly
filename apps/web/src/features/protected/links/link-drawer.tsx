import { Code, Download, Trash2, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { useGetLinkUnlockPage } from '~/api/endpoints/unlock-page/unlock-page';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Separator } from '~/components/ui/foundations/separator/separator';
import { ScanCode } from '~/components/ui/media-files/scan-code/scan-code';
import { Drawer } from '~/components/ui/overlays-feedback/drawer/drawer';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { useDownloadQr } from '../share/download-qr';
import { UnlockPageDialog } from './unlock-page-dialog';

/** Side panel with everything about one link: short URL, settings, QR code and (for protected links) the unlock page. */
export function LinkDrawer({ orgID, link, onClose, onDelete }: { orgID: number; link: Link | undefined; onClose: () => void; onDelete: (link: Link) => void }) {
	const t = useTranslate();
	const downloadQr = useDownloadQr();
	const { locale } = useLanguage();
	const titleId = useId();

	return (
		<Drawer.Root onOpenChange={open => !open && onClose()} open={link !== undefined}>
			<Drawer.Content className='sm:max-w-lg'>
				{link && (
					<>
						<Drawer.Header>
							<div className='min-w-0'>
								<Drawer.Title id={titleId}>{t('protected.links.drawer.title')}</Drawer.Title>
								<Drawer.Description className='truncate'>/{link.code}</Drawer.Description>
							</div>
							<Drawer.Close>
								<Button aria-label={t('protected.links.drawer.close')} size='icon' variant='ghost'>
									<Button.Icon icon={X} />
								</Button>
							</Drawer.Close>
						</Drawer.Header>
						<Drawer.Body className='flex flex-col gap-6'>
							<Input>
								<Input.Label>{t('protected.links.drawer.shortUrl')}</Input.Label>
								<Input.Field readOnly value={link.short_url ?? ''} />
								<Input.CopyButton lang={{ copied: t('protected.links.drawer.copied'), copy: t('protected.links.drawer.copy') }} />
							</Input>
							<dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 font-primary text-sm'>
								<Row label={t('protected.links.drawer.origin')}>
									<span className='break-all'>{link.origin_url}</span>
								</Row>
								<Row label={t('protected.links.drawer.maxClicks')}>{link.max_clicks ?? t('protected.links.noLimit')}</Row>
								<Row label={t('protected.links.drawer.expires')}>{formatDateTime(link.expires_at, locale, t('protected.links.never'))}</Row>
								<Row label={t('protected.links.drawer.created')}>{formatDateTime(link.created_at, locale)}</Row>
								{link.protected && (
									<Row label={t('protected.links.columns.access')}>
										<Badge variant='warning'>
											<Badge.Text>{t('protected.links.badges.protected')}</Badge.Text>
										</Badge>
									</Row>
								)}
							</dl>
							<Separator />
							<section aria-label={t('protected.links.drawer.qr.title')} className='flex flex-col gap-3'>
								<h3 className='font-primary text-sm font-semibold'>{t('protected.links.drawer.qr.title')}</h3>
								{link.short_url && (
									<ScanCode
										lang={{ download: t('protected.links.drawer.qr.download'), qr: t('protected.links.drawer.qr.title') }}
										onDownload={({ value }) => void downloadQr(value, link.code ?? 'qr')}
										scheme='fixed'
										value={link.short_url}
									>
										<ScanCode.Canvas size={176} />
										<ScanCode.DownloadButton />
									</ScanCode>
								)}
							</section>
							<Separator />
							<UnlockPageEditor key={link.id} link={link} orgID={orgID} />
						</Drawer.Body>
						<Drawer.Footer className='flex items-center justify-between gap-2'>
							<Button onClick={() => link.short_url && void downloadQr(link.short_url, link.code ?? 'qr')} variant='secondary'>
								<Button.Icon icon={Download} />
								<Button.Text>{t('protected.links.actions.downloadQr')}</Button.Text>
							</Button>
							<Button onClick={() => onDelete(link)} variant='destructive'>
								<Button.Icon icon={Trash2} />
								<Button.Text>{t('protected.links.actions.delete')}</Button.Text>
							</Button>
						</Drawer.Footer>
					</>
				)}
			</Drawer.Content>
		</Drawer.Root>
	);
}

function Row({ label, children }: { label: string; children: ReactNode }) {
	return (
		<>
			<dt className='text-muted-foreground'>{label}</dt>
			<dd className='min-w-0'>{children}</dd>
		</>
	);
}

/** Custom HTML page shown to visitors who must type the password. Only protected links ever show it; editing happens in a large dialog. */
function UnlockPageEditor({ orgID, link }: { orgID: number; link: Link }) {
	const t = useTranslate();
	const page = useGetLinkUnlockPage(orgID, link.id as number, { query: { enabled: Boolean(link.protected), retry: false } });
	const [editing, setEditing] = useState(false);
	const saved = page.data?.data?.html || undefined;

	return (
		<section className='flex flex-col gap-3'>
			<div>
				<h3 className='font-primary text-sm font-semibold'>{t('protected.links.drawer.unlock.title')}</h3>
				<p className='font-primary text-sm text-muted-foreground'>{link.protected ? t('protected.links.drawer.unlock.description') : t('protected.links.drawer.unlock.notProtected')}</p>
			</div>
			{link.protected && (
				<>
					<div className='flex items-center gap-3'>
						<Badge variant={saved ? 'success' : 'default'}>
							<Badge.Text>{saved ? t('protected.links.drawer.unlock.custom') : t('protected.links.drawer.unlock.default')}</Badge.Text>
						</Badge>
						<Button disabled={page.isLoading} onClick={() => setEditing(true)} variant='secondary'>
							<Button.Icon icon={Code} />
							<Button.Text>{t('protected.links.drawer.unlock.edit')}</Button.Text>
						</Button>
					</div>
					{/* Remounted on every open so the draft always starts from the saved page. */}
					{editing && <UnlockPageDialog link={link} onOpenChange={setEditing} open orgID={orgID} saved={saved} />}
				</>
			)}
		</section>
	);
}
