import { QRCodeSVG } from 'qrcode.react';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { useTranslate } from '~/hooks/use-translate';

const PNG_SIZE = 1024;

/** Draws `value` as a black-on-white QR code (the one every scanner reads) and saves it as `<filename>.png`. */
async function downloadQr(value: string, filename: string) {
	const svg = renderToStaticMarkup(<QRCodeSVG bgColor='#ffffff' fgColor='#000000' level='M' marginSize={4} size={PNG_SIZE} value={value} />);
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
	try {
		const image = new Image();
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not draw the QR code'));
			image.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = PNG_SIZE;
		canvas.height = PNG_SIZE;
		canvas.getContext('2d')?.drawImage(image, 0, 0, PNG_SIZE, PNG_SIZE);
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
	return async (value: string, filename: string) => {
		try {
			await downloadQr(value, filename);
			toast.success(t('protected.toast.qrDownloaded'));
		} catch {
			toast.error(t('protected.toast.qrFailed'));
		}
	};
}
