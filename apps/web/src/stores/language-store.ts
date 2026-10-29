import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { activateLocale, LANGUAGE_COOKIE, type LanguagePreference, resolveLocale } from '~/i18n';
import { cookieStorage } from '~/lib/cookie-storage';

interface LanguageState {
	preference: LanguagePreference;
	/** `true` once the persisted value has been read; until then `preference` is only the default. */
	hydrated: boolean;
	setPreference: (preference: LanguagePreference) => void;
}

/**
 * Persisted language preference (`"system"`, `"en"` or `"es"`). Changing it
 * activates the matching locale. The first render's language is decided by the
 * server from the same cookie; `useLanguage` rehydrates the store after mount.
 */
export const useLanguageStore = create<LanguageState>()(
	persist(
		set => ({
			hydrated: false,
			preference: 'system',
			setPreference: preference => {
				activateLocale(resolveLocale(preference));
				set({
					preference,
				});
			},
		}),
		{
			name: LANGUAGE_COOKIE,
			onRehydrateStorage: () => state => {
				activateLocale(resolveLocale(state?.preference ?? 'system'));
				useLanguageStore.setState({
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
