'use client';

import { countries as allCountries } from 'country-flag-icons';
import * as React from 'react';
import { cn } from '../../utils/tailwind/cn';
import { Select, type SelectLang, useSelect } from '../select/select';

/** ISO 3166-1 alpha-2 country code (e.g. `"PE"`). */
export type CountryCode = string;

/** Part of a country shown in the trigger and in every option. */
export type CountryPart = 'flag' | 'name' | 'code';

/** Languages country names and built-in texts are available in. */
export type CountrySelectLocale = 'en' | 'es';

/**
 * Embedded SVG flags keyed by country code. Import them with
 * `import * as flags from "country-flag-icons/react/3x2"` — they are left out
 * of the component so the bundle only carries them when you opt in.
 */
export type CountryFlags = Record<string, (props: { title: string }) => React.JSX.Element>;

const TEXTS: Record<
	CountrySelectLocale,
	{
		placeholder: string;
		searchPlaceholder: string;
		empty: string;
	}
> = {
	en: {
		empty: 'No countries found.',
		placeholder: 'Select country',
		searchPlaceholder: 'Search country',
	},
	es: {
		empty: 'No se encontraron países.',
		placeholder: 'Seleccionar país',
		searchPlaceholder: 'Buscar país',
	},
};

interface CountrySelectContextValue {
	display: readonly CountryPart[];
	flags?: CountryFlags;
	locale: CountrySelectLocale;
	options: readonly CountryOption[];
	value: CountryCode | null;
}

interface CountryOption {
	readonly code: CountryCode;
	readonly name: string;
}

const CountrySelectContext = React.createContext<CountrySelectContextValue | null>(null);

function useCountrySelect() {
	const context = React.useContext(CountrySelectContext);
	if (!context) throw new Error('CountrySelect components must be used inside CountrySelect.Root');
	return context;
}

/** Country names in `locale`, sorted alphabetically. Codes the platform cannot name are left out. Names come from the platform's `Intl.DisplayNames`, so no locale data ships with the component. */
function buildOptions(codes: readonly CountryCode[], locale: CountrySelectLocale): CountryOption[] {
	const names = new Intl.DisplayNames([locale], {
		type: 'region',
	});

	return codes
		.flatMap(code => {
			try {
				const name = names.of(code);
				return name
					? [
							{
								code,
								name,
							},
						]
					: [];
			} catch {
				// Flag sets include codes (e.g. "AC", "TA") the platform has no region name for.
				return [];
			}
		})
		.sort((a, b) => a.name.localeCompare(b.name, locale));
}

export interface CountrySelectRootProps {
	/** `CountrySelect.Label`, `CountrySelect.Trigger` and `CountrySelect.Content`. */
	children: React.ReactNode;
	/** Extra classes for the wrapper element. */
	className?: string;
	/** Restricts the list to these countries. Omit it to list every country that has a flag. */
	countries?: readonly CountryCode[];
	/** Initially selected country, for uncontrolled usage. */
	defaultValue?: CountryCode;
	/**
	 * Parts shown for a country, in order, in the trigger and in every option.
	 * @default ["flag", "name"]
	 */
	display?: readonly CountryPart[];
	/** Embedded SVG flags. Without them the `"flag"` part is skipped, so pair `display` with `"code"` or `"name"` if you leave them out. */
	flags?: CountryFlags;
	/** Overrides the texts `Select` renders itself (close-menu label). */
	lang?: Partial<SelectLang>;
	/**
	 * Language of the country names and of the built-in texts.
	 * @default "en"
	 */
	locale?: CountrySelectLocale;
	/** Called with the chosen country code. */
	onChange?: (country: CountryCode) => void;
	/** Selected country, for controlled usage. Pair it with `onChange`. Use `null` for no selection. */
	value?: CountryCode | null;
}

/**
 * Provider of the country list, flags and display mode. Wraps `Select.Root`, so
 * it keeps its keyboard navigation, search and overlay behavior.
 * @example
 * ```tsx
 * import * as flags from "country-flag-icons/react/3x2";
 *
 * <CountrySelect.Root defaultValue="PE" flags={flags} locale="es">
 *   <CountrySelect.Label>País</CountrySelect.Label>
 *   <CountrySelect.Trigger />
 *   <CountrySelect.Content />
 * </CountrySelect.Root>
 * ```
 */
function CountrySelectRoot({ children, value: controlledValue, defaultValue, onChange, countries, flags, display = ['flag', 'name'], locale = 'en', lang, className }: CountrySelectRootProps) {
	const [internalValue, setInternalValue] = React.useState<CountryCode | null>(defaultValue ?? null);
	const value = controlledValue !== undefined ? controlledValue : internalValue;

	const options = React.useMemo(() => buildOptions(countries ?? allCountries, locale), [countries, locale]);

	const labelMap = React.useMemo(() => Object.fromEntries(options.map(option => [option.code, option.name])), [options]);

	const handleChange = (next: string) => {
		setInternalValue(next);
		onChange?.(next);
	};

	const context = React.useMemo(
		() => ({
			display,
			flags,
			locale,
			options,
			value,
		}),
		[display, flags, locale, options, value]
	);

	return (
		<CountrySelectContext.Provider value={context}>
			<Select.Root className={cn('h-auto', className)} labelMap={labelMap} lang={lang} onChange={handleChange} value={value}>
				{children}
			</Select.Root>
		</CountrySelectContext.Provider>
	);
}

export interface CountrySelectLabelProps {
	/** Label text. */
	children: React.ReactNode;
	/** Extra classes for the label. */
	className?: string;
	/** Appends a required-field indicator (`*`) after the label text. */
	required?: boolean;
}

/** Visible label associated with `CountrySelect.Trigger`. */
function CountrySelectLabel(props: CountrySelectLabelProps) {
	return <Select.Label {...props} />;
}

interface CountryMarkProps {
	readonly flags?: CountryFlags;
	readonly option: CountryOption;
	readonly parts: readonly CountryPart[];
}

/** Renders the requested parts of a country on one line: flag, name and ISO code. */
function CountryMark({ option, parts, flags }: CountryMarkProps) {
	const Flag = parts.includes('flag') ? flags?.[option.code] : undefined;

	return (
		<span className='flex min-w-0 items-center gap-2'>
			{Flag && (
				<span className='flex h-3.5 w-5 shrink-0 overflow-hidden rounded-xs border border-border [&>svg]:size-full'>
					<Flag title={option.name} />
				</span>
			)}
			{parts.includes('name') && <span className='truncate'>{option.name}</span>}
			{parts.includes('code') && <span className={cn('shrink-0', parts.includes('name') && 'text-muted-foreground')}>{option.code}</span>}
		</span>
	);
}

export interface CountrySelectTriggerProps {
	/** Accessible name when there is no `CountrySelect.Label` (needed for a flag-only trigger). */
	'aria-label'?: string;
	/** Extra classes for the trigger button. */
	className?: string;
	/** Prevents opening the menu. @default false */
	disabled?: boolean;
	/** Parts shown for the selected country. Defaults to the root's `display`; set it to `["flag"]` for a compact trigger. */
	display?: readonly CountryPart[];
	/** Text shown while no country is selected. @default "Select country" */
	placeholder?: string;
}

/** Button that shows the selected country and opens the list. */
function CountrySelectTrigger({ placeholder, display, className, ...props }: CountrySelectTriggerProps) {
	const context = useCountrySelect();
	const selected = context.options.find(option => option.code === context.value);

	return (
		<Select.Trigger className={className} {...props}>
			{selected ? (
				<CountryMark flags={context.flags} option={selected} parts={display ?? context.display} />
			) : (
				<span className='truncate text-muted-foreground'>{placeholder ?? TEXTS[context.locale].placeholder}</span>
			)}
		</Select.Trigger>
	);
}

export interface CountrySelectContentProps {
	/** Text shown when the search matches no country. @default "No countries found." */
	emptyMessage?: string;
	/** Placeholder of the search field. @default "Search country" */
	searchPlaceholder?: string;
	/** Width of the menu in px. Omit it to match the trigger; set it when the trigger is compact. */
	width?: number;
}

/** Searchable list of countries. Search matches the name and the ISO code. */
function CountrySelectContent({ searchPlaceholder, emptyMessage, width }: CountrySelectContentProps) {
	const { options, flags, display, locale } = useCountrySelect();
	const texts = TEXTS[locale];

	return (
		<Select.Content width={width}>
			<Select.Search placeholder={searchPlaceholder ?? texts.searchPlaceholder} />
			<Select.ItemList>
				{options.map(option => (
					<Select.Item key={option.code} label={`${option.name} ${option.code}`} value={option.code}>
						<CountryMark flags={flags} option={option} parts={display} />
					</Select.Item>
				))}
				<CountrySelectEmpty message={emptyMessage ?? texts.empty} />
			</Select.ItemList>
		</Select.Content>
	);
}

/** Shown when the search query filters out every option. */
function CountrySelectEmpty({ message }: { readonly message: string }) {
	const { query } = useSelect();
	const { options } = useCountrySelect();
	const needle = query.toLowerCase();
	const hasMatch = !needle || options.some(option => `${option.name} ${option.code}`.toLowerCase().includes(needle));

	return hasMatch ? null : <p className='px-3 py-2 text-sm font-primary text-muted-foreground'>{message}</p>;
}

/**
 * Compound country picker built on `Select`: a flag, name and/or ISO code per
 * country, in English or Spanish.
 * @example
 * ```tsx
 * import * as flags from "country-flag-icons/react/3x2";
 *
 * <CountrySelect.Root flags={flags} onChange={setCountry}>
 *   <CountrySelect.Label>Country</CountrySelect.Label>
 *   <CountrySelect.Trigger />
 *   <CountrySelect.Content />
 * </CountrySelect.Root>
 * ```
 */
export const CountrySelect = {
	Content: CountrySelectContent,
	Label: CountrySelectLabel,
	Root: CountrySelectRoot,
	Trigger: CountrySelectTrigger,
};
