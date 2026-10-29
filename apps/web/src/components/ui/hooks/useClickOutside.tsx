import { useEffect } from 'react';
import { markOutsideDismiss } from '../utils/overlay/overlayStack';

/**
 * Calls `callback` on a `mousedown` outside `ref` (and `excludeRef`). Pass `enabled` as the overlay's open state:
 * a closed overlay must neither listen nor flag the click as an outside-dismiss, or backdrops would stop closing.
 */
export function useClickOutside<T extends HTMLElement>(ref: React.RefObject<T | null>, callback: () => void, excludeRef?: React.RefObject<HTMLElement | null>, enabled = true) {
	useEffect(() => {
		if (!enabled) return;

		function handleClick(event: MouseEvent) {
			const target = event.target as Node;
			if (ref.current?.contains(target)) return;
			if (excludeRef?.current?.contains(target)) return;
			markOutsideDismiss();
			callback();
		}

		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	}, [callback, ref, excludeRef, enabled]);
}
