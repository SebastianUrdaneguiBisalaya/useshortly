import { Download, Palette } from 'lucide-react';
import type { Link } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Card } from '~/components/ui/data-display/card/card';
import { useTranslate } from '~/hooks/use-translate';
import { useDownloadQr } from '../share/download-qr';
import { QrImage, resolveQrStyle } from '../share/qr-image';

/** One gallery tile: the link's QR drawn with its own style, where it points, and the two things you do with it. */
export function QrCard({ link, onCustomize }: { link: Link; onCustomize: (link: Link) => void }) {
	const t = useTranslate();
	const downloadQr = useDownloadQr();
	const { background } = resolveQrStyle(link.qr_style);

	return (
		<Card className='gap-4 p-4'>
			<div className='flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-border p-3' style={{ backgroundColor: background }}>
				{link.short_url && <QrImage className='size-full' size={256} style={link.qr_style} value={link.short_url} />}
			</div>
			<div className='min-w-0'>
				<p className='truncate font-primary text-sm font-semibold text-foreground'>{link.short_url?.replace(/^https?:\/\//, '')}</p>
				<p className='truncate font-primary text-xs text-muted-foreground' title={link.origin_url}>
					{link.origin_url}
				</p>
			</div>
			<div className='flex gap-2'>
				<Button className='flex-1' onClick={() => link.short_url && void downloadQr(link.short_url, link.code ?? 'qr', link.qr_style)} variant='secondary'>
					<Button.Icon icon={Download} />
					<Button.Text>{t('protected.qr.download')}</Button.Text>
				</Button>
				<Button aria-label={t('protected.qr.customize')} onClick={() => onCustomize(link)} size='icon' variant='secondary'>
					<Button.Icon icon={Palette} />
				</Button>
			</div>
		</Card>
	);
}
