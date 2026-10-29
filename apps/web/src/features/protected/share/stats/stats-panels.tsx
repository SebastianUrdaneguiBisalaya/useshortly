import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Globe, MousePointerClick, TrendingUp, X } from 'lucide-react';
import { parseAsString } from 'nuqs';
import { type ReactNode, useMemo } from 'react';
import type { ClickCount, LinkStats } from '~/api/model';
import { Button } from '~/components/ui/actions-controls/button/button';
import { Card } from '~/components/ui/data-display/card/card';
import { CHART_COLORS, Chart } from '~/components/ui/data-display/charts/charts';
import { type ChoroplethGeoJSON, ChoroplethMap } from '~/components/ui/data-display/choropleth-map/choropleth-map';
import { DatePicker } from '~/components/ui/forms-inputs/date-picker/date-picker';
import { Select } from '~/components/ui/forms-inputs/select/select';
import { Icon } from '~/components/ui/foundations/icon/icon';
import { useLanguage } from '~/hooks/use-language';
import { useTranslate } from '~/hooks/use-translate';
import type { Locale } from '~/i18n';
import { hoursInDisplayZone } from '~/lib/date-time';
import {
	addDays,
	clampRange,
	countryName,
	DEFAULT_RANGE_DAYS,
	daysInRange,
	dayToPickerDate,
	formatLongDay,
	formatShortDay,
	intlLocale,
	isDay,
	pickerDateToDay,
	referrerHost,
	todayUtc,
	weekdayName,
} from './stats-utils';

const ALL = '__all__';
/** How many rows the bar rankings show; the map still paints every country. */
const RANKING_SIZE = 8;
const DEVICES = ['mobile', 'tablet', 'desktop', 'bot', 'unknown'] as const;

/** The URL parameters every statistics view shares: the period and the filters. */
export const statsParsers = {
	country: parseAsString,
	device: parseAsString,
	from: parseAsString,
	referrer: parseAsString,
	to: parseAsString,
};
export const statsQueryOptions = { history: 'replace' } as const;

export interface StatsQueryValues {
	country: string | null;
	device: string | null;
	from: string | null;
	referrer: string | null;
	to: string | null;
}
type SetStatsQuery = (values: Partial<StatsQueryValues>) => unknown;

/** What the charts read: the part of the answer a link and a campaign have in common. */
export type StatsData = Pick<LinkStats, 'total' | 'previous_total' | 'daily' | 'by_hour' | 'by_weekday' | 'referrers' | 'countries' | 'devices'>;

/** The period of a view (the last 30 days when the URL has none), how many days it spans and whether any filter is applied. */
export function resolveStatsQuery(query: StatsQueryValues) {
	const to = isDay(query.to) ? query.to : todayUtc();
	const from = isDay(query.from) ? query.from : addDays(to, -(DEFAULT_RANGE_DAYS - 1));
	const range = clampRange(from, to);
	return {
		days: daysInRange(range.from, range.to),
		hasFilters: query.country !== null || query.device !== null || query.referrer !== null,
		range,
	};
}

/** The query parameters of the statistics requests: the period and the filters that are applied. */
export function statsParams(range: { from: string; to: string }, query: StatsQueryValues) {
	return {
		...range,
		...(query.country && { country: query.country }),
		...(query.device && { device: query.device }),
		...(query.referrer && { referrer: query.referrer }),
	};
}

/** Period picker and the country, device and referrer filters, with the button that clears the filters. */
export function StatsToolbar({
	query,
	setQuery,
	range,
	hasFilters,
	optionsSource,
}: {
	query: StatsQueryValues;
	setQuery: SetStatsQuery;
	range: { from: string; to: string };
	hasFilters: boolean;
	/** The unfiltered numbers: the menus must keep offering every value while one is applied. */
	optionsSource: StatsData | undefined;
}) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const setFilter = (key: 'country' | 'device' | 'referrer', value: string) => void setQuery({ [key]: value === ALL ? null : value });

	return (
		<div className='flex flex-wrap items-end gap-3'>
			<div className='w-full sm:w-72'>
				<DatePicker.Root
					locale={intlLocale(locale)}
					lang={datePickerLang[locale]}
					maxDate={dayToPickerDate(todayUtc())}
					mode='range'
					onChange={value => {
						if (!value.from || !value.to) return;
						const next = clampRange(pickerDateToDay(value.from), pickerDateToDay(value.to));
						void setQuery(next);
					}}
					value={{ from: dayToPickerDate(range.from), to: dayToPickerDate(range.to) }}
				>
					<DatePicker.Label>{t('protected.dashboard.range.label')}</DatePicker.Label>
					<DatePicker.Trigger placeholder={t('protected.dashboard.range.placeholder')} />
					<DatePicker.Content />
				</DatePicker.Root>
			</div>
			<FilterSelect label={t('protected.dashboard.filters.country')} onChange={value => setFilter('country', value)} value={query.country}>
				{withCurrent(optionsSource?.countries, query.country).map(country => (
					<Select.Item key={country} label={valueLabel('country', country, locale, t)} value={country}>
						{valueLabel('country', country, locale, t)}
					</Select.Item>
				))}
			</FilterSelect>
			<FilterSelect label={t('protected.dashboard.filters.device')} onChange={value => setFilter('device', value)} value={query.device}>
				{DEVICES.map(device => (
					<Select.Item key={device} label={valueLabel('device', device, locale, t)} value={device}>
						{valueLabel('device', device, locale, t)}
					</Select.Item>
				))}
			</FilterSelect>
			<FilterSelect label={t('protected.dashboard.filters.referrer')} onChange={value => setFilter('referrer', value)} value={query.referrer}>
				{withCurrent(optionsSource?.referrers, query.referrer).map(referrer => (
					<Select.Item key={referrer} label={valueLabel('referrer', referrer, locale, t)} value={referrer}>
						{valueLabel('referrer', referrer, locale, t)}
					</Select.Item>
				))}
			</FilterSelect>
			{hasFilters && (
				<Button onClick={() => void setQuery({ country: null, device: null, referrer: null })} variant='ghost'>
					<Button.Icon icon={X} />
					<Button.Text>{t('protected.dashboard.filters.clear')}</Button.Text>
				</Button>
			)}
		</div>
	);
}

/** The metrics and charts of one statistics answer. `children` are extra panels placed right after the metrics. */
export function StatsGrid({
	data,
	days,
	isLoading,
	isPlaceholderData,
	selectedCountry,
	onSelectCountry,
	children,
}: {
	data: StatsData | undefined;
	days: number;
	isLoading: boolean;
	isPlaceholderData: boolean;
	selectedCountry: string | null;
	onSelectCountry: (country: string | null) => void;
	children?: ReactNode;
}) {
	const t = useTranslate();
	const { locale } = useLanguage();

	return (
		<div className={`grid grid-cols-12 gap-4 transition-opacity ${isPlaceholderData ? 'opacity-60' : ''}`}>
			<Metrics days={days} isLoading={isLoading} stats={data} />
			{children}
			<Panel className='col-span-12 lg:col-span-8' title={t('protected.dashboard.charts.daily.title')}>
				<Chart.Area
					areas={[{ dataKey: 'clicks', name: t('protected.dashboard.charts.daily.series') }]}
					data={(data?.daily ?? []).map(day => ({ clicks: day.clicks, label: formatShortDay(day.date ?? '', locale) }))}
					legend={false}
					valueFormatter={value => value.toLocaleString(intlLocale(locale))}
					xAxisKey='label'
				/>
			</Panel>
			<Panel className='col-span-12 lg:col-span-4' title={t('protected.dashboard.charts.devices.title')}>
				<Chart.Donut
					centerLabel={t('protected.dashboard.charts.devices.center')}
					centerValue={(data?.total ?? 0).toLocaleString(intlLocale(locale))}
					data={(data?.devices ?? []).map(device => ({ name: valueLabel('device', device.name ?? '', locale, t), value: device.clicks ?? 0 }))}
				/>
			</Panel>
			<WorldMap className='col-span-12 lg:col-span-8' countries={data?.countries ?? []} locale={locale} onSelect={onSelectCountry} selected={selectedCountry} />
			<Panel className='col-span-12 lg:col-span-4' title={t('protected.dashboard.charts.countries.title')}>
				<Ranking
					color={CHART_COLORS.blue}
					items={(data?.countries ?? []).slice(0, RANKING_SIZE).map(country => ({ clicks: country.clicks ?? 0, name: valueLabel('country', country.name ?? '', locale, t) }))}
					locale={locale}
					seriesName={t('protected.dashboard.charts.daily.series')}
				/>
			</Panel>
			<Panel className='col-span-12 lg:col-span-6' title={t('protected.dashboard.charts.referrers.title')}>
				<Ranking
					color={CHART_COLORS.blue}
					items={(data?.referrers ?? []).slice(0, RANKING_SIZE).map(referrer => ({ clicks: referrer.clicks ?? 0, name: valueLabel('referrer', referrer.name ?? '', locale, t) }))}
					locale={locale}
					seriesName={t('protected.dashboard.charts.daily.series')}
				/>
			</Panel>
			<Panel className='col-span-12 lg:col-span-6' title={t('protected.dashboard.charts.hours.title')}>
				<Chart.Bar
					bars={[{ color: CHART_COLORS.blue, dataKey: 'clicks', name: t('protected.dashboard.charts.daily.series'), radius: [4, 4, 0, 0] }]}
					data={hoursInDisplayZone(data?.by_hour ?? []).map((clicks, hour) => ({ clicks, label: String(hour).padStart(2, '0') }))}
					xAxisKey='label'
				/>
			</Panel>
			<Panel className='col-span-12' title={t('protected.dashboard.charts.weekdays.title')}>
				<Chart.Bar
					bars={[{ color: CHART_COLORS.blue, dataKey: 'clicks', name: t('protected.dashboard.charts.daily.series'), radius: [4, 4, 0, 0] }]}
					data={(data?.by_weekday ?? []).map((clicks, index) => ({ clicks, label: weekdayName(index, locale) }))}
					size='sm'
					xAxisKey='label'
				/>
			</Panel>
		</div>
	);
}

const datePickerLang: Record<
	Locale,
	{ apply: string; clear: string; from: string; to: string; calendar: string; nextMonth: string; previousMonth: string; weekdays: readonly [string, string, string, string, string, string, string] }
> = {
	en: {
		apply: 'Apply',
		calendar: 'Calendar',
		clear: 'Clear',
		from: 'From',
		nextMonth: 'Next month',
		previousMonth: 'Previous month',
		to: 'To',
		weekdays: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
	},
	es: {
		apply: 'Aplicar',
		calendar: 'Calendario',
		clear: 'Limpiar',
		from: 'Desde',
		nextMonth: 'Mes siguiente',
		previousMonth: 'Mes anterior',
		to: 'Hasta',
		weekdays: ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'],
	},
};

type Translate = ReturnType<typeof useTranslate>;

/** What a stored value (`PE`, `mobile`, `https://news.example/a`, `direct`, `unknown`) is called on screen. */
function valueLabel(kind: 'country' | 'device' | 'referrer', value: string, locale: Locale, t: Translate) {
	if (value === 'unknown') return t('protected.dashboard.values.unknown');
	if (kind === 'referrer') return value === 'direct' ? t('protected.dashboard.values.direct') : referrerHost(value);
	if (kind === 'device') return DEVICES.includes(value as (typeof DEVICES)[number]) ? t(`protected.dashboard.values.${value as (typeof DEVICES)[number]}`) : value;
	return countryName(value, locale);
}

/** The names the API listed, plus the one applied as a filter, which may no longer be in a narrowed list. */
function withCurrent(items: ClickCount[] | undefined, current: string | null) {
	const names = (items ?? []).map(item => item.name ?? '').filter(Boolean);
	return current && !names.includes(current) ? [current, ...names] : names;
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string | null; onChange: (value: string) => void; children: ReactNode }) {
	const t = useTranslate();
	return (
		<div className='w-full sm:w-48'>
			<Select.Root<string> onChange={onChange} value={value ?? ALL}>
				<Select.Label>{label}</Select.Label>
				<Select.Trigger>
					<Select.Value />
				</Select.Trigger>
				<Select.Content>
					<Select.ItemList>
						<Select.Item label={t('protected.dashboard.filters.all')} value={ALL}>
							{t('protected.dashboard.filters.all')}
						</Select.Item>
						{children}
					</Select.ItemList>
				</Select.Content>
			</Select.Root>
		</div>
	);
}

/** A chart under its title. The title says what is plotted; a second line repeating it on every panel was noise, so there is none. */
export function Panel({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
	return (
		<Card as='section' className={className}>
			<Card.Header>
				<Card.Title>{title}</Card.Title>
			</Card.Header>
			<Card.Content>{children}</Card.Content>
		</Card>
	);
}

export function Ranking({ items, color, seriesName, locale }: { items: { name: string; clicks: number }[]; color: string; seriesName: string; locale: Locale }) {
	return (
		<Chart.Bar
			bars={[{ color, dataKey: 'clicks', name: seriesName, radius: [0, 4, 4, 0] }]}
			data={items}
			layout='vertical'
			valueFormatter={value => value.toLocaleString(intlLocale(locale))}
			xAxisKey='name'
		/>
	);
}

function Metrics({ stats, days, isLoading }: { stats: StatsData | undefined; days: number; isLoading: boolean }) {
	const t = useTranslate();
	const { locale } = useLanguage();
	const number = useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 1 }), [locale]);
	const percent = useMemo(() => new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 0, signDisplay: 'exceptZero', style: 'percent' }), [locale]);

	const total = stats?.total ?? 0;
	const previous = stats?.previous_total ?? 0;
	const daily = stats?.daily ?? [];
	const peak = daily.reduce<{ date?: string; clicks?: number } | null>((best, day) => ((day.clicks ?? 0) > (best?.clicks ?? 0) ? day : best), null);
	const topCountry = stats?.countries?.find(country => country.name !== 'unknown');
	const change = previous > 0 ? (total - previous) / previous : null;

	return (
		<>
			<Chart.Stat
				className='col-span-12 sm:col-span-6 lg:col-span-3'
				description={t('protected.dashboard.stats.total.description')}
				hint={change === null ? t('protected.dashboard.stats.total.noPrevious', { days }) : t('protected.dashboard.stats.total.vsPrevious', { change: percent.format(change), days })}
				icon={<Icon icon={MousePointerClick} size='sm' />}
				isLoading={isLoading}
				label={t('protected.dashboard.stats.total.label')}
				tone={change === null || change === 0 ? 'default' : change > 0 ? 'positive' : 'negative'}
				value={number.format(total)}
			/>
			<Chart.Stat
				className='col-span-12 sm:col-span-6 lg:col-span-3'
				description={t('protected.dashboard.stats.average.description')}
				hint={t('protected.dashboard.stats.average.hint')}
				icon={<Icon icon={TrendingUp} size='sm' />}
				isLoading={isLoading}
				label={t('protected.dashboard.stats.average.label')}
				value={number.format(total / days)}
			/>
			<Chart.Stat
				className='col-span-12 sm:col-span-6 lg:col-span-3'
				description={t('protected.dashboard.stats.peak.description')}
				hint={peak?.date ? formatLongDay(peak.date, locale) : t('protected.dashboard.stats.peak.none')}
				icon={<Icon icon={CalendarDays} size='sm' />}
				isLoading={isLoading}
				label={t('protected.dashboard.stats.peak.label')}
				value={number.format(peak?.clicks ?? 0)}
			/>
			<Chart.Stat
				className='col-span-12 sm:col-span-6 lg:col-span-3'
				description={t('protected.dashboard.stats.topCountry.description')}
				hint={topCountry ? `${t('protected.dashboard.charts.daily.series')}: ${number.format(topCountry.clicks ?? 0)}` : t('protected.dashboard.stats.topCountry.none')}
				icon={<Icon icon={Globe} size='sm' />}
				isLoading={isLoading}
				label={t('protected.dashboard.stats.topCountry.label')}
				value={topCountry?.name ? countryName(topCountry.name, locale) : '—'}
			/>
		</>
	);
}

/** The world's countries, served from `public/geo` (Natural Earth, public domain) and keyed by ISO 3166-1 alpha-2, the codes the API stores. */
function useWorldGeoJSON() {
	return useQuery({
		queryFn: async () => {
			const response = await fetch('/geo/world.geojson');
			if (!response.ok) throw new Error(`world map: ${response.status}`);
			return (await response.json()) as ChoroplethGeoJSON;
		},
		queryKey: ['geo', 'world'],
		staleTime: Number.POSITIVE_INFINITY,
	});
}

function WorldMap({
	countries,
	selected,
	onSelect,
	locale,
	className,
}: {
	countries: ClickCount[];
	selected: string | null;
	onSelect: (country: string | null) => void;
	locale: Locale;
	className?: string;
}) {
	const t = useTranslate();
	const world = useWorldGeoJSON();
	const values = useMemo(() => {
		const byCode: Record<string, number> = {};
		for (const country of countries) if (country.name && country.name !== 'unknown') byCode[country.name] = country.clicks ?? 0;
		return byCode;
	}, [countries]);
	const withoutCountry = countries.find(country => country.name === 'unknown')?.clicks ?? 0;
	const format = (value: number) => value.toLocaleString(intlLocale(locale));

	return (
		<Panel className={className} title={t('protected.dashboard.charts.map.title')}>
			{world.data ? (
				<ChoroplethMap
					color={CHART_COLORS.blue}
					data={world.data}
					formatValue={format}
					idKey='id'
					onSelectedChange={region => onSelect(region?.id ?? null)}
					projection='equalEarth'
					selected={selected && selected !== 'unknown' ? selected : null}
					valueLabel={t('protected.dashboard.charts.map.legend')}
					values={values}
				>
					<ChoroplethMap.Canvas
						lang={locale === 'es' ? { mapZoom: 'Zoom del mapa', noData: 'Sin datos', resetZoom: 'Restablecer zoom', zoomIn: 'Acercar', zoomOut: 'Alejar' } : undefined}
						renderTooltip={region => (
							<div className='flex flex-col gap-1'>
								<p className='font-medium'>{countryName(region.id, locale)}</p>
								<p className='text-muted-foreground'>
									{t('protected.dashboard.charts.map.legend')}: {region.value === undefined ? '0' : format(region.value)}
								</p>
							</div>
						)}
					/>
					<ChoroplethMap.Legend noDataLabel={locale === 'es' ? 'Sin clics' : 'No clicks'} />
				</ChoroplethMap>
			) : (
				<div className='aspect-video w-full animate-pulse rounded-md bg-muted' />
			)}
			{withoutCountry > 0 && <p className='mt-3 text-muted-foreground text-xs'>{t('protected.dashboard.charts.map.noCountry', { count: withoutCountry })}</p>}
		</Panel>
	);
}
