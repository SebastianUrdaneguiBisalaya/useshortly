import { HotkeysProvider } from '@usehotkeys/react';
import type { ReactNode } from 'react';

/**
 * One keyboard-shortcut engine for the whole app. Any page or component declares its own shortcuts with
 * `useHotkeys(combo, handler, { label, group })`; those with a `label` are listed by `useBindings`
 * (the command palette shows them), and they are removed when that component unmounts.
 */
export function HotkeysClientProvider({ children }: { children: ReactNode }) {
	return <HotkeysProvider>{children}</HotkeysProvider>;
}
