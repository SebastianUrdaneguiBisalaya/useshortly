import { Code, Download, Megaphone, Trash2, X } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { useGetLinkUnlockPage } from '~/api/endpoints/unlock-page/unlock-page';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Badge } from '~/components/ui/data-display/badge/badge';
import { Input } from '~/components/ui/forms-inputs/input/input';
import { Separator } from '~/components/ui/foundations/separator/separator';
import { Drawer } from '~/components/ui/overlays-feedback/drawer/drawer';
import { useLanguage } from '~/hooks/use-language';
import { useRetained } from '~/hooks/use-retained';
import { useTranslate } from '~/hooks/use-translate';
import { formatDateTime } from '~/lib/date-time';
import { useDownloadQr } from '../share/download-qr';
import { QrImage } from '../share/qr-image';
import { UnlockPageDialog } from './unlock-page-dialog';

/** Side panel with everything about one link: short URL, settings, QR code and (for protected links) the unlock page. */
export function LinkDrawer({
	orgID,
	link: current,
	onClose,
	onDelete,
	onChangeChannel,
}: {
	orgID: number;
	link: Link | undefined;
	onClose: () => void;
	onDelete: (link: Link) => void;
	onChangeChannel: (link: Link) => void;
}) {
	// Kept after closing so the panel does not empty before the exit animation ends.
	const link = useRetained(current);
	const t = useTranslate();
	const downloadQr = useDownloadQr();
	const { locale } = useLanguage();
	const titleId = useId();

	return (
		<Drawer.Root onOpenChange={open => !open && onClose()} open={current !== undefined}>
			<Drawer.Content className='sm:max-w-md'>
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
								<Row label={t('protected.links.columns.access')}>
									<Badge variant={link.protected ? 'warning' : 'outline'}>
										<Badge.Text>{link.protected ? t('protected.links.badges.private') : t('protected.links.badges.public')}</Badge.Text>
									</Badge>
								</Row>
							</dl>
							<Separator />
							<CampaignSection link={link} onChange={() => onChangeChannel(link)} />
							<Separator />
							<section aria-label={t('protected.links.drawer.qr.title')} className='flex flex-col gap-3'>
								<h3 className='font-primary text-sm font-semibold'>{t('protected.links.drawer.qr.title')}</h3>
								{link.short_url && (
									<div className='w-fit overflow-hidden rounded-lg border border-border'>
										<QrImage size={176} style={link.qr_style} value={link.short_url} />
									</div>
								)}
							</section>
							<Separator />
							<UnlockPageEditor key={link.id} link={link} orgID={orgID} />
						</Drawer.Body>
						<Drawer.Footer className='flex items-center justify-between gap-2'>
							<Button onClick={() => link.short_url && void downloadQr(link.short_url, link.code ?? 'qr', link.qr_style)} variant='secondary'>
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
	const page = useGetLinkUnlockPage(orgID, link.id as number, { query: { enabled: Boolean(link.protected), meta: { optional: true }, retry: false } });
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

/** The campaign and channel a link was shared in, with the button to change them. */
function CampaignSection({ link, onChange }: { link: Link; onChange: () => void }) {
	const t = useTranslate();
	const inCampaign = link.campaign_id != null && link.channel_id != null;

	return (
		<section className='flex flex-col gap-3'>
			<div>
				<h3 className='font-primary text-sm font-semibold'>{t('protected.links.drawer.campaign.title')}</h3>
				<p className='font-primary text-sm text-muted-foreground'>
					{inCampaign ? t('protected.links.drawer.campaign.in', { campaign: link.campaign_name ?? '', channel: link.channel_name ?? '' }) : t('protected.links.drawer.campaign.none')}
				</p>
			</div>
			<div>
				<Button onClick={onChange} variant='secondary'>
					<Button.Icon icon={Megaphone} />
					<Button.Text>{t('protected.links.drawer.campaign.change')}</Button.Text>
				</Button>
			</div>
		</section>
	);
}
