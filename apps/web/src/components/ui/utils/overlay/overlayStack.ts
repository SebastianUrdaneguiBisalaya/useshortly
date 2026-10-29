/**
 * Bookkeeping for stacked overlays (Modal, Drawer, Popover, Dropdown…). Lives outside React on purpose: a single
 * `keydown` listener decides who gets Escape, so the answer can't change between two listeners of the same event
 * (React may flush a close and unregister the top overlay in between).
 */

type EscapeHandlerRef = {
	current: () => void;
};

const escapeStack: EscapeHandlerRef[] = [];
const layerStack: number[] = [];

function handleEscape(event: KeyboardEvent) {
	if (event.key !== 'Escape') return;
	escapeStack.at(-1)?.current();
}

/**
 * Registers `handler` as the newest Escape target. Only the most recently registered handler runs on Escape,
 * so the topmost overlay closes first. Returns the unregister function.
 */
export function registerEscapeHandler(handler: EscapeHandlerRef): () => void {
	if (escapeStack.length === 0) {
		window.addEventListener('keydown', handleEscape);
	}
	escapeStack.push(handler);

	return () => {
		const index = escapeStack.indexOf(handler);
		if (index !== -1) escapeStack.splice(index, 1);
		if (escapeStack.length === 0) {
			window.removeEventListener('keydown', handleEscape);
		}
	};
}

/**
 * Claims the next free layer, always above every layer currently held (0 for the first overlay, 1 for the one
 * opened over it…). Returns the layer and the function that releases it.
 */
export function claimOverlayLayer(): {
	layer: number;
	release: () => void;
} {
	const layer = (layerStack.at(-1) ?? -1) + 1;
	layerStack.push(layer);

	return {
		layer,
		release: () => {
			const index = layerStack.indexOf(layer);
			if (index !== -1) layerStack.splice(index, 1);
		},
	};
}

let outsideDismissPending = false;

/**
 * Records that a `mousedown` just dismissed an overlay by landing outside it. The `click` that follows lands on
 * the same spot, so a backdrop under that spot (Modal, Drawer…) would close too; backdrops check
 * `isOutsideDismissPending` to leave that click alone. The flag clears once the click has bubbled to `document`,
 * which is after React ran the backdrop's `onClick`.
 */
export function markOutsideDismiss(): void {
	outsideDismissPending = true;
	document.addEventListener(
		'click',
		() => {
			outsideDismissPending = false;
		},
		{ once: true }
	);
}

/** True while the click that follows an outside-dismiss `mousedown` is still being dispatched. */
export function isOutsideDismissPending(): boolean {
	return outsideDismissPending;
}
