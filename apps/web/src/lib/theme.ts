import type { ThemePreference } from '~/components/ui/actions-controls/switch-theme/switch-theme';
import { readPersistedPreference } from '~/lib/cookie-storage';

/** Cookie holding the persisted theme preference, read by the server to render `data-theme` on the first paint. */
export const THEME_COOKIE = 'ui-theme';

export function isThemePreference(value: unknown): value is ThemePreference {
	return value === 'system' || value === 'light' || value === 'dark';
}

/** Server side: the stored theme preference, `"system"` when there is none. */
export function themeFromRequest(request: Request): ThemePreference {
	const value = readPersistedPreference(request.headers.get('cookie'), THEME_COOKIE);
	return isThemePreference(value) ? value : 'system';
}
