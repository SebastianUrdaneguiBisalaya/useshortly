import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { readPersistedPreference } from '~/lib/cookie-storage';
import en from '~/locales/en.json';
import es from '~/locales/es.json';

export const locales = ['en', 'es'] as const;

export type Locale = (typeof locales)[number];

/** `"system"` follows the browser's language; the others are explicit. */
export type LanguagePreference = 'system' | Locale;

/** Fallback when neither the stored preference nor the browser language matches a supported locale. */
export const defaultLocale: Locale = 'en';

/**
 * Every dotted path to a string in the catalog (`"auth.signIn.title"`), built
 * recursively from the JSON shape so a mistyped key fails in `tsc`.
 */
type Paths<T> = {
	[K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];

export type TranslationKey = Paths<typeof es>;

/** Typed translate function: `t("auth.resetPassword.description", { email })`. */
export type Translate = (key: TranslationKey, values?: Record<string, string | number>) => string;

export function isLocale(value: unknown): value is Locale {
	return locales.some(locale => locale === value);
}

/** Turns a preference into a concrete locale; `"system"` reads `navigator.language`. */
export function resolveLocale(preference: LanguagePreference): Locale {
	if (preference !== 'system') return preference;
	if (typeof navigator === 'undefined') return defaultLocale;
	for (const tag of navigator.languages ?? [navigator.language]) {
		const language = tag.toLowerCase().split('-')[0];
		if (isLocale(language)) return language;
	}
	return defaultLocale;
}

/** Cookie holding the persisted preference, so the server can render in the right language on the first paint. */
export const LANGUAGE_COOKIE = 'ui-language';

export function readLanguagePreference(cookieHeader: string | null): LanguagePreference {
	const value = readPersistedPreference(cookieHeader, LANGUAGE_COOKIE);
	return value === 'system' || isLocale(value) ? value : 'system';
}

/** Server side: the stored preference, else the first supported `Accept-Language` entry, else `defaultLocale`. */
export function localeFromRequest(request: Request): Locale {
	const preference = readLanguagePreference(request.headers.get('cookie'));
	if (preference !== 'system') return preference;
	const header = request.headers.get('accept-language') ?? '';
	for (const part of header.split(',')) {
		const language = part.trim().split(';')[0]?.toLowerCase().split('-')[0];
		if (isLocale(language)) return language;
	}
	return defaultLocale;
}

function createI18n(locale: Locale) {
	const instance = i18next.createInstance();
	// Catalogs are bundled, so init is synchronous and the first render already has real texts.
	void instance.use(initReactI18next).init({
		fallbackLng: 'en',
		initAsync: false,
		interpolation: {
			// React already escapes rendered values.
			escapeValue: false,
		},
		lng: locale,
		resources: {
			en: {
				translation: en,
			},
			es: {
				translation: es,
			},
		},
	});
	return instance;
}

let clientInstance: ReturnType<typeof createI18n> | undefined;

/**
 * The i18n instance for a render. On the server each request gets its own
 * (a shared one would leak one visitor's language into another's response);
 * in the browser there is one, created with the locale the server rendered
 * so hydration matches.
 */
export function getI18n(locale: Locale = defaultLocale) {
	if (typeof document === 'undefined') return createI18n(locale);
	clientInstance ??= createI18n(locale);
	return clientInstance;
}

export function activateLocale(locale: Locale) {
	void getI18n(locale).changeLanguage(locale);
	document.documentElement.lang = locale;
}
