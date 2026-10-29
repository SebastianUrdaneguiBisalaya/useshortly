import { QRCodeSVG } from 'qrcode.react';
import type { QRStyle } from '~/api/model';

export const DEFAULT_QR_FOREGROUND = '#000000';
export const DEFAULT_QR_BACKGROUND = '#ffffff';

/** Share of the code's side the logo covers: enough to read, little enough for error correction to rebuild the hidden modules. */
export const QR_LOGO_RATIO = 0.22;

/** The colors a link's style resolves to; an unset color is the default one. */
export function resolveQrStyle(style?: QRStyle) {
	return {
		background: style?.background || DEFAULT_QR_BACKGROUND,
		foreground: style?.foreground || DEFAULT_QR_FOREGROUND,
		logoUrl: style?.logo_url || undefined,
	};
}

/** A link's short URL drawn as a QR code with the colors and logo of its style. A logo raises the error correction to `H`. */
export function QrImage({ value, style, size, className }: { value: string; style?: QRStyle; size: number; className?: string }) {
	const { background, foreground, logoUrl } = resolveQrStyle(style);
	const logoSize = Math.round(size * QR_LOGO_RATIO);

	return (
		<QRCodeSVG
			bgColor={background}
			className={className}
			fgColor={foreground}
			imageSettings={logoUrl ? { excavate: true, height: logoSize, src: logoUrl, width: logoSize } : undefined}
			level={logoUrl ? 'H' : 'M'}
			marginSize={4}
			size={size}
			value={value}
		/>
	);
}
