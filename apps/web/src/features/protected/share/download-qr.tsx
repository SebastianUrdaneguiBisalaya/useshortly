import { QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import type { QRStyle } from '~/api/model';
import { useTranslate } from '~/hooks/use-translate';
import { QR_LOGO_RATIO, resolveQrStyle } from './qr-image';

const PNG_SIZE = 1024;

function loadImage(src: string, crossOrigin?: 'anonymous') {
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image();
		if (crossOrigin) image.crossOrigin = crossOrigin;
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error('Could not load the image'));
		image.src = src;
	});
}

/** Draws `value` with the colors of `style` (black on white by default) and saves it as `<filename>.png`. The logo goes in the middle when it can be read; a host that does not allow it (CORS) leaves the code without one. */
async function downloadQr(value: string, filename: string, style?: QRStyle) {
	const { background, foreground, logoUrl } = resolveQrStyle(style);
	const svg = renderToStaticMarkup(<QRCodeSVG bgColor={background} fgColor={foreground} level={logoUrl ? 'H' : 'M'} marginSize={4} size={PNG_SIZE} value={value} />);
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		const image = await loadImage(url);
		const canvas = document.createElement('canvas');
		canvas.width = PNG_SIZE;
		canvas.height = PNG_SIZE;
		const context = canvas.getContext('2d');
		context?.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);
		if (logoUrl && context) {
			const logo = await loadImage(logoUrl, 'anonymous').catch(() => undefined);
			if (logo) {
				const side = Math.round(PNG_SIZE * QR_LOGO_RATIO);
				const offset = Math.round((PNG_SIZE - side) / 2);
				context.fillStyle = background;
				context.fillRect(offset, offset, side, side);
				context.drawImage(logo, offset, offset, side, side);
			}
		}
		const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
		if (!png) throw new Error('Could not export the QR code');
		const link = document.createElement('a');
		link.href = URL.createObjectURL(png);
		link.download = `${filename}.png`;
		link.click();
		URL.revokeObjectURL(link.href);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** `downloadQr` that reports the outcome with a toast: success when the file is saved, an error when drawing or exporting fails. */
export function useDownloadQr() {
	const t = useTranslate();
	return async (value: string, filename: string, style?: QRStyle) => {
		try {
			await downloadQr(value, filename, style);
			toast.success(t('protected.toast.qrDownloaded'));
		} catch {
			toast.error(t('protected.toast.qrFailed'));
		}
	};
}
