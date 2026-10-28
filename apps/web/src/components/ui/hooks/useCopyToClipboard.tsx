'use client';

import * as React from 'react';

/**
 * Copies text to the clipboard and exposes a short-lived `copied` flag for confirmation feedback.
 * @param resetDelay Milliseconds before `copied` goes back to `false`.
 * @default 1500
 */
export function useCopyToClipboard(resetDelay = 1500) {
	const [copied, setCopied] = React.useState(false);
	const timeout = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	React.useEffect(() => () => clearTimeout(timeout.current), []);

	const copy = React.useCallback(
		async (text: string) => {
			await navigator.clipboard.writeText(text);
			setCopied(true);
			clearTimeout(timeout.current);
			timeout.current = setTimeout(() => setCopied(false), resetDelay);
		},
		[resetDelay]
	);

	return {
		copied,
		copy,
	};
}
