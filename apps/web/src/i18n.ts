import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "~/locales/en.json";
import es from "~/locales/es.json";

export const locales = [
  "en",
  "es",
] as const;

export type Locale = (typeof locales)[number];

/** `"system"` follows the browser's language; the others are explicit. */
export type LanguagePreference = "system" | Locale;

/** Locale used on the server and for the first render, before the stored preference is read on the client. */
export const defaultLocale: Locale = "es";

/**
 * Every dotted path to a string in the catalog (`"auth.signIn.title"`), built
 * recursively from the JSON shape so a mistyped key fails in `tsc`.
 */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<typeof es>;

/** Typed translate function: `t("auth.resetPassword.description", { email })`. */
export type Translate = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value);
}

/** Turns a preference into a concrete locale; `"system"` reads `navigator.language`. */
export function resolveLocale(preference: LanguagePreference): Locale {
  if (preference !== "system") return preference;
  if (typeof navigator === "undefined") return defaultLocale;
  const [language] = navigator.language.toLowerCase().split("-");
  return isLocale(language) ? language : "en";
}

export function activateLocale(locale: Locale) {
  void i18next.changeLanguage(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

// Catalogs are small and bundled, so init is synchronous and SSR renders with real texts.
void i18next.use(initReactI18next).init({
  fallbackLng: "en",
  initAsync: false,
  interpolation: {
    // React already escapes rendered values.
    escapeValue: false,
  },
  lng: defaultLocale,
  resources: {
    en: {
      translation: en,
    },
    es: {
      translation: es,
    },
  },
});

export { i18next as i18n };
