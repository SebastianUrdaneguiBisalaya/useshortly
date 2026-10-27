/**
 * Text that comes from users or from the pages they shorten is data, never instructions. In the
 * prose a tool returns it goes on one line and is cut short, so a link cannot smuggle in a
 * paragraph addressed to the model. The structured result keeps the full value.
 */
export function oneLine(value: string, max = 200): string {
	const flat = value.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
