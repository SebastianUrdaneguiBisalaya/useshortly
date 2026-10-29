import { useEffect } from 'react';
import { useRouteLoaderData } from 'react-router';
import type { ThemePreference } from '~/components/ui/actions-controls/switch-theme/switch-theme';
import type { loader } from '~/app/root';
import { useThemeStore } from '~/stores/theme-store';

export interface UseTheme {
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
}

/**
 * Theme preference with `"system"` support, backed by `useThemeStore`.
 * Until the store has read the cookie it returns the value the server
 * rendered with, so the switch never flashes the wrong option.
 * Pass it to `SwitchTheme` in controlled mode:
 * `<SwitchTheme value={preference} onValueChange={setPreference} />`.
 */
export function useTheme(): UseTheme {
	const serverPreference = useRouteLoaderData<typeof loader>('root')?.theme;
	const hydrated = useThemeStore(state => state.hydrated);
	const storedPreference = useThemeStore(state => state.preference);
	const setPreference = useThemeStore(state => state.setPreference);

	useEffect(() => {
		void useThemeStore.persist.rehydrate();
	}, []);

	return {
		preference: hydrated ? storedPreference : (serverPreference ?? 'system'),
		setPreference,
	};
}
