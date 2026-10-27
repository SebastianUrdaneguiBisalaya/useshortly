import { create } from "zustand";
import { persist } from "zustand/middleware";
import { activateLocale, type LanguagePreference, resolveLocale } from "~/i18n";

export const LANGUAGE_STORAGE_KEY = "ui-language";

interface LanguageState {
  preference: LanguagePreference;
  setPreference: (preference: LanguagePreference) => void;
}

/**
 * Persisted language preference (`"system"`, `"en"` or `"es"`). Changing it
 * activates the matching Lingui locale. `skipHydration` keeps the first
 * client render equal to the server's; `useLanguage` rehydrates after mount.
 */
export const useLanguageStore = create<LanguageState>()(
  persist(
    (set) => ({
      preference: "system",
      setPreference: (preference) => {
        activateLocale(resolveLocale(preference));
        set({
          preference,
        });
      },
    }),
    {
      name: LANGUAGE_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        activateLocale(resolveLocale(state?.preference ?? "system"));
      },
      partialize: (state) => ({
        preference: state.preference,
      }),
      skipHydration: true,
    },
  ),
);
