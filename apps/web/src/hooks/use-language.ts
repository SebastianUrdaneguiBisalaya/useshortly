import { useEffect } from "react";
import { type LanguagePreference, type Locale, resolveLocale } from "~/i18n";
import { useLanguageStore } from "~/stores/language-store";

export interface UseLanguage {
  /** What the user picked: `"system"`, `"en"` or `"es"`. */
  preference: LanguagePreference;
  /** The locale actually in use (`"system"` already resolved). */
  locale: Locale;
  setPreference: (preference: LanguagePreference) => void;
}

/** Language preference with `"system"` support, backed by `useLanguageStore`. Drives `SwitchLanguage`. */
export function useLanguage(): UseLanguage {
  const preference = useLanguageStore((state) => state.preference);
  const setPreference = useLanguageStore((state) => state.setPreference);

  useEffect(() => {
    void useLanguageStore.persist.rehydrate();
  }, []);

  return {
    locale: resolveLocale(preference),
    preference,
    setPreference,
  };
}
