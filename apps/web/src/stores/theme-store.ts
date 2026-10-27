import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { ThemePreference } from '~/components/ui/actions-controls/switch-theme/switch-theme';
import { cookieStorage } from '~/lib/cookie-storage';
import { THEME_COOKIE } from '~/lib/theme';

/** Sets (or removes, for `"system"`) `data-theme` on `<html>`, which the CSS tokens key off. */
function applyTheme(preference: ThemePreference) {
	if (preference === 'system') {
		document.documentElement.removeAttribute('data-theme');
	} else {
		document.documentElement.setAttribute('data-theme', preference);
	}
}

interface ThemeState {
	preference: ThemePreference;
	/** `true` once the persisted value has been read; until then `preference` is only the default. */
	hydrated: boolean;
	setPreference: (preference: ThemePreference) => void;
}

/**
 * Persisted theme preference, stored in a cookie so the server renders
 * `data-theme` on `<html>` from the first byte (see `root.tsx`).
 * `useTheme` rehydrates the store after mount.
 */
export const useThemeStore = create<ThemeState>()(
	persist(
		set => ({
			hydrated: false,
			preference: 'system',
			setPreference: preference => {
				applyTheme(preference);
				set({
					preference,
				});
			},
		}),
		{
			name: THEME_COOKIE,
			onRehydrateStorage: () => state => {
				applyTheme(state?.preference ?? 'system');
				useThemeStore.setState({
					hydrated: true,
				});
			},
			partialize: state => ({
				preference: state.preference,
			}),
			skipHydration: true,
			storage: createJSONStorage(() => cookieStorage),
		}
	)
);
