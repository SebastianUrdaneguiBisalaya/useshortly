import { useState } from 'react';

/**
 * Returns `value` while it is defined and the last defined value after that. Dialogs and drawers that are open while `value`
 * exists use it so their content stays on screen during the exit animation instead of emptying the moment `value` is cleared.
 */
export function useRetained<T>(value: T | undefined): T | undefined {
	const [retained, setRetained] = useState(value);
	if (value !== undefined && value !== retained) setRetained(value);
	return value ?? retained;
}
