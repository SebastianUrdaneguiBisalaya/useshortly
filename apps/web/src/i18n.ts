import { i18n, type I18n } from "@lingui/core";
import { messages as en } from "~/locales/en";
import { messages as es } from "~/locales/es";

export const locales = [
  "en",
  "es",
] as const;

export type Locale = (typeof locales)[number];

/** `"system"` follows the browser's language; the others are explicit. */
export type LanguagePreference = "system" | Locale;

/** Translate function of a Lingui `I18n`: `_("auth.signIn.title")` or `_("id", { values })`. */
export type Translate = I18n["_"];

/** Locale used on the server and for the first render, before the stored preference is read on the client. */
export const defaultLocale: Locale = "es";

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
  i18n.activate(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
  }
}

// Catalogs are small and bundled, so activation is synchronous and SSR renders with real texts.
i18n.load({
  en,
  es,
});
i18n.activate(defaultLocale);

export { i18n };
