const MIN_CONTRAST = 3;

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function luminance(hex: string) {
	const [r, g, b] = [1, 3, 5].map(start => {
		const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
		return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Same rule as the API: the modules darker than the background, with a WCAG contrast ratio of at least 3, so scanners can tell them apart. */
export function isScannable(foreground: string, background: string) {
	const fg = luminance(foreground);
	const bg = luminance(background);
	return fg < bg && (bg + 0.05) / (fg + 0.05) >= MIN_CONTRAST;
}
