import { Download, Palette } from 'lucide-react';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { useTranslate } from '~/hooks/use-translate';
import { useDownloadQr } from '../share/download-qr';
import { QrImage, resolveQrStyle } from '../share/qr-image';

/**
 * One gallery tile. The code is the tile: its surface takes the QR's own background, so a styled
 * code reads as a printed sticker and the gallery gets its variety from the users' colors, not from
 * chrome. The text and the two actions sit below it, outside any box.
 */
export function QrCard({ link, onCustomize }: { link: Link; onCustomize: (link: Link) => void }) {
	const t = useTranslate();
	const downloadQr = useDownloadQr();
	const { background } = resolveQrStyle(link.qr_style);
	const shortUrl = link.short_url?.replace(/^https?:\/\//, '');

	return (
		<figure className='flex flex-col gap-3'>
			<div className='flex aspect-square items-center justify-center rounded-2xl p-4 ring-1 ring-border' style={{ backgroundColor: background }}>
				{link.short_url && <QrImage className='size-full' size={256} style={link.qr_style} value={link.short_url} />}
			</div>
			<figcaption className='flex items-start justify-between gap-2'>
				<div className='min-w-0'>
					<p className='truncate font-primary text-sm font-semibold text-foreground'>{shortUrl}</p>
					<p className='truncate font-primary text-xs text-muted-foreground' title={link.origin_url}>
						{link.origin_url}
					</p>
				</div>
				<div className='-mr-1.5 flex shrink-0 gap-0.5'>
					<Button aria-label={t('protected.qr.customize')} onClick={() => onCustomize(link)} size='icon' title={t('protected.qr.customize')} variant='ghost'>
						<Button.Icon icon={Palette} />
					</Button>
					<Button
						aria-label={t('protected.qr.download')}
						onClick={() => link.short_url && void downloadQr(link.short_url, link.code ?? 'qr', link.qr_style)}
						size='icon'
						title={t('protected.qr.download')}
						variant='ghost'
					>
						<Button.Icon icon={Download} />
					</Button>
				</div>
			</figcaption>
		</figure>
	);
}
