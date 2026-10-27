import { useEffect } from "react";
import { useRouteLoaderData } from "react-router";
import type { loader } from "~/app/root";
import { type LanguagePreference, type Locale, resolveLocale } from "~/i18n";
import { useLanguageStore } from "~/stores/language-store";

export interface UseLanguage {
  /** What the user picked: `"system"`, `"en"` or `"es"`. */
  preference: LanguagePreference;
  /** The locale actually in use (`"system"` already resolved). */
  locale: Locale;
  setPreference: (preference: LanguagePreference) => void;
}

/**
 * Language preference with `"system"` support, backed by `useLanguageStore`.
 * Until the store has read the cookie it returns the value the server
 * rendered with, so the switch never flashes the wrong option. Drives `SwitchLanguage`.
 */
export function useLanguage(): UseLanguage {
  const serverPreference =
    useRouteLoaderData<typeof loader>("root")?.languagePreference;
  const hydrated = useLanguageStore((state) => state.hydrated);
  const storedPreference = useLanguageStore((state) => state.preference);
  const setPreference = useLanguageStore((state) => state.setPreference);

  useEffect(() => {
    void useLanguageStore.persist.rehydrate();
  }, []);

  const preference = hydrated ? storedPreference : (serverPreference ?? "system");

  return {
    locale: resolveLocale(preference),
    preference,
    setPreference,
  };
}
