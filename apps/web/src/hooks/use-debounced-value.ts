import { useEffect, useState } from 'react';

/** Follows `value` after it has stayed the same for `delay` ms, so typing does not send a request per keystroke. */
export function useDebouncedValue<T>(value: T, delay = 300): T {
	const [debounced, setDebounced] = useState(value);

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delay);
		return () => clearTimeout(timer);
	}, [value, delay]);

	return debounced;
}
