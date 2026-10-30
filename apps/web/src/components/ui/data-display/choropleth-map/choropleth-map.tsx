'use client';

import {
	type ExtendedFeature,
	type ExtendedFeatureCollection,
	type GeoGeometryObjects,
	type GeoProjection,
	geoAlbers,
	geoAlbersUsa,
	geoBounds,
	geoConicEqualArea,
	geoEqualEarth,
	geoEquirectangular,
	geoMercator,
	geoNaturalEarth1,
	geoOrthographic,
	geoPath,
} from 'd3-geo';
import { Maximize, Minus, Plus } from 'lucide-react';
import * as React from 'react';
import { type ReactZoomPanPinchContentRef, TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { rewindGeometry } from '../../utils/geo/rewind';
import { cn } from '../../utils/tailwind/cn';

/** Width of the SVG coordinate space. The map scales to its container; only the ratio matters. */
const VIEWBOX_WIDTH = 960;
const PADDING = 8;
/** Share of the accent color at the lowest value; the highest is 100%. Keeps the palest region distinguishable from "no data". */
const MIN_STRENGTH = 14;
const STROKE_WIDTH = 'calc(0.75px / var(--map-scale))';

/** A GeoJSON document: a `FeatureCollection`, a single `Feature` or a bare geometry — what `geopandas.GeoDataFrame.to_json()` and most GIS tools produce. */
export type ChoroplethGeoJSON = ExtendedFeatureCollection | ExtendedFeature | GeoGeometryObjects;

type RawFeature = ExtendedFeature<GeoGeometryObjects | null, Record<string, unknown> | null>;

export type ChoroplethProjectionName = 'auto' | 'equalEarth' | 'naturalEarth' | 'mercator' | 'equirectangular' | 'albers' | 'albersUsa' | 'conicEqualArea' | 'orthographic';

const PROJECTIONS: Record<Exclude<ChoroplethProjectionName, 'auto'>, () => GeoProjection> = {
	albers: geoAlbers,
	albersUsa: geoAlbersUsa,
	conicEqualArea: geoConicEqualArea,
	equalEarth: geoEqualEarth,
	equirectangular: geoEquirectangular,
	mercator: geoMercator,
	naturalEarth: geoNaturalEarth1,
	orthographic: geoOrthographic,
};

/** A region as handed to callbacks and custom tooltips. */
export interface ChoroplethRegion {
	/** Identifier of the region (see `idKey` on the root). */
	id: string;
	/** Display name (see `nameKey` on the root). */
	name: string;
	/** Value plotted for the region, or `undefined` when it has no data. */
	value: number | undefined;
	/** Fill color the region is painted with. */
	color: string;
	/** The `properties` of the source GeoJSON feature. */
	properties: Record<string, unknown>;
	/** The source GeoJSON feature. */
	feature: ExtendedFeature;
}

interface MapFeature extends ChoroplethRegion {
	/** SVG path data in viewBox coordinates. */
	d: string;
	/** Centroid in viewBox coordinates, used for arrow-key navigation. */
	centroid: [number, number];
}

interface LegendBin {
	color: string;
	label: string;
}

type LegendModel =
	| {
			kind: 'continuous';
			min: number;
			max: number;
			from: string;
			to: string;
	  }
	| {
			kind: 'steps';
			bins: LegendBin[];
	  };

function readPath(source: unknown, path: string): unknown {
	let current = source;
	for (const key of path.split('.')) {
		if (current === null || typeof current !== 'object') return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function toNumber(raw: unknown): number | undefined {
	const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : Number.NaN;
	return Number.isFinite(number) ? number : undefined;
}

function toFeatures(data: ChoroplethGeoJSON): RawFeature[] {
	// The d3 typings don't narrow this union on `type`, so read it structurally.
	const document = data as unknown as {
		type: string;
		features?: RawFeature[];
	};
	if (document.type === 'FeatureCollection') return document.features ?? [];
	if (document.type === 'Feature') return [data as unknown as RawFeature];
	return [
		{
			geometry: data as GeoGeometryObjects,
			properties: null,
			type: 'Feature',
		},
	];
}

/** The accent color at `t` (0–1): pastel toward the canvas at 0, the full color at 1, so it reads in light and dark. */
function tone(color: string, t: number) {
	const strength = Math.round(MIN_STRENGTH + (100 - MIN_STRENGTH) * t);
	return `color-mix(in oklab, ${color} ${strength}%, var(--background))`;
}

/** A conic equal-area projection centered on the data for regions, Equal Earth once the data spans a large part of the globe. */
function autoProjection(collection: ExtendedFeatureCollection): GeoProjection {
	const [[west, south], [east, north]] = geoBounds(collection);
	const lonSpan = east >= west ? east - west : east - west + 360;
	const latSpan = north - south;
	if (!Number.isFinite(lonSpan) || !Number.isFinite(latSpan) || lonSpan > 140 || latSpan > 100) return geoEqualEarth();
	let centerLon = west + lonSpan / 2;
	if (centerLon > 180) centerLon -= 360;
	return geoConicEqualArea()
		.rotate([-centerLon, 0])
		.center([0, (south + north) / 2])
		.parallels([south + latSpan / 6, north - latSpan / 6]);
}

function createProjection(input: ChoroplethProjectionName | GeoProjection | (() => GeoProjection), collection: ExtendedFeatureCollection): GeoProjection {
	if (typeof input === 'string') return input === 'auto' ? autoProjection(collection) : PROJECTIONS[input]();
	// A d3 projection is itself a function, so tell an instance from a factory by its API.
	if ('fitExtent' in input) return input;
	return (input as () => GeoProjection)();
}

export interface ChoroplethMapProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onSelect'> {
	/** The geography, as GeoJSON — a `FeatureCollection` (or a single `Feature`/geometry) of `Polygon`/`MultiPolygon` features, holes included. Winding order is normalized, so files from Python/GIS tools work as they are. */
	data: ChoroplethGeoJSON;
	/** Dotted path inside each feature's `properties` holding the number to plot (e.g. `"gdp"` or `"stats.population"`). Ignored for regions present in `values`. */
	valueKey?: string;
	/** Values keyed by region id, for data that lives apart from the geometry (a joined table, an API response). Wins over `valueKey`. Keep the object stable between renders (e.g. `useMemo`). */
	values?: Record<string, number>;
	/**
	 * Dotted path inside `properties` identifying each region (an ISO code, a district id…) — the keys of `values`. Defaults to the feature's `id`, then `properties.id`, then its position.
	 */
	idKey?: string;
	/**
	 * Dotted path inside `properties` with the region's display name.
	 * @default "name"
	 */
	nameKey?: string;
	/** What the value measures (e.g. `"Population"`); prefixes the value in the tooltip and titles the legend. */
	valueLabel?: string;
	/** Formats values for the tooltip and legend. Defaults to `value.toLocaleString()`. */
	formatValue?: (value: number) => string;
	/**
	 * How geography becomes flat shapes. A name, a d3 projection instance (e.g. from `d3-geo-projection`), or a function returning one. `"auto"` picks a conic equal-area projection centered on the data for a region and Equal Earth for the world. Prefer equal-area projections for choropleths: Mercator inflates high latitudes, and a larger area reads as a bigger value. Use `"mercator"` only to align with web map tiles.
	 * @default "auto"
	 */
	projection?: ChoroplethProjectionName | GeoProjection | (() => GeoProjection);
	/**
	 * Scale and center the projection to fit the data. Turn it off to keep the `scale`/`translate` of a projection you configured yourself. A projection instance is modified in place; pass a function to avoid that.
	 * @default true
	 */
	fit?: boolean;
	/**
	 * Width ÷ height of the map. By default it follows the shape of the data, kept between 0.7 and 2.4 so a long, thin country doesn't become a skyscraper.
	 * @default "auto" (from the data)
	 */
	aspectRatio?: number;
	/**
	 * Color of the highest value; lower values fade toward the canvas. Use a `--chart-*` token so it adapts to both themes.
	 * @default "var(--chart-1)"
	 */
	color?: string;
	/** `[min, max]` the color scale spans. Defaults to the lowest and highest value in the data. Fix it to compare several maps on one scale. */
	domain?: [number, number];
	/** Ascending cut points that switch from a smooth gradient to discrete steps: `[10, 50]` makes three classes (`< 10`, `10–50`, `≥ 50`). */
	thresholds?: number[];
	/**
	 * Fill for regions without a value.
	 * @default "var(--muted)"
	 */
	noDataColor?: string;
	/** Id of the selected region (controlled). Use with `onSelectedChange`; `null` clears the selection. */
	selected?: string | null;
	/** Id of the region selected initially (uncontrolled). */
	defaultSelected?: string | null;
	/** Called with the region when it is selected (click, Enter or Space) and with `null` when the selection is cleared (click again, Esc, or a click on the background). */
	onSelectedChange?: (region: ChoroplethRegion | null) => void;
}

interface ChoroplethMapContextValue {
	features: MapFeature[];
	projection: GeoProjection;
	width: number;
	height: number;
	legend: LegendModel;
	hasNoData: boolean;
	noDataColor: string;
	valueLabel?: string;
	formatValue: (value: number) => string;
	selectedId: string | null;
	select: (id: string | null) => void;
}

const ChoroplethMapContext = React.createContext<ChoroplethMapContextValue | null>(null);

function useChoroplethMapContext() {
	const context = React.useContext(ChoroplethMapContext);
	if (!context) {
		throw new Error('ChoroplethMap subcomponents must be used within <ChoroplethMap>.');
	}
	return context;
}

/** Geometry of the map for aligning your own layers with it: `projection` maps `[longitude, latitude]` to `[x, y]` in a `width` × `height` coordinate space (the SVG's viewBox). */
export function useChoroplethMap() {
	const { projection, width, height } = useChoroplethMapContext();
	return {
		height,
		projection,
		width,
	};
}

/**
 * Compound choropleth map — regions from a GeoJSON file painted by value,
 * with no map service behind it. It draws the polygons itself with `d3-geo`
 * (so any projection, antimeridian and polar cases included) and is
 * interactive: hover or select a region and it grows and opens a popover; the
 * map zooms and pans. Compose `ChoroplethMap.Canvas` and `ChoroplethMap.Legend`.
 * @example
 * ```tsx
 * <ChoroplethMap data={geojson} valueKey="population" valueLabel="Population">
 *   <ChoroplethMap.Canvas />
 *   <ChoroplethMap.Legend />
 * </ChoroplethMap>
 * ```
 */
function ChoroplethMapRoot({
	data,
	valueKey,
	values,
	idKey,
	nameKey = 'name',
	valueLabel,
	formatValue,
	projection = 'auto',
	fit = true,
	aspectRatio,
	color = 'var(--chart-1)',
	domain,
	thresholds,
	noDataColor = 'var(--muted)',
	selected,
	defaultSelected = null,
	onSelectedChange,
	className,
	children,
	...props
}: ChoroplethMapProps) {
	const format = React.useMemo(() => formatValue ?? ((value: number) => value.toLocaleString()), [formatValue]);

	const model = React.useMemo(() => {
		const raw = toFeatures(data);
		const collection: ExtendedFeatureCollection = {
			features: raw.map(feature => ({
				...feature,
				geometry: feature.geometry ? rewindGeometry(feature.geometry) : null,
			})) as ExtendedFeature[],
			type: 'FeatureCollection',
		};

		// 1. Values, ids and the color scale.
		const seen = new Set<string>();
		const rows = collection.features.map((feature, index) => {
			const properties = (feature.properties as Record<string, unknown> | null) ?? {};
			const rawId = idKey ? readPath(properties, idKey) : (feature.id ?? properties.id);
			let id = rawId === undefined || rawId === null ? `${index}` : `${rawId}`;
			if (seen.has(id)) id = `${id}-${index}`;
			seen.add(id);
			const rawName = readPath(properties, nameKey);
			const value = values && id in values ? toNumber(values[id]) : valueKey ? toNumber(readPath(properties, valueKey)) : undefined;
			return {
				feature,
				id,
				name: rawName === undefined || rawName === null ? id : `${rawName}`,
				properties,
				value,
			};
		});

		let min = Number.POSITIVE_INFINITY;
		let max = Number.NEGATIVE_INFINITY;
		for (const { value } of rows) {
			if (value === undefined) continue;
			if (value < min) min = value;
			if (value > max) max = value;
		}
		if (min > max) {
			min = 0;
			max = 0;
		}
		const [low, high] = domain ?? [min, max];

		const cuts = thresholds ? [...thresholds].sort((a, b) => a - b) : null;
		const colorFor = (value: number | undefined) => {
			if (value === undefined) return noDataColor;
			if (cuts) {
				let bin = 0;
				while (bin < cuts.length && value >= cuts[bin]) bin++;
				return tone(color, (bin + 1) / (cuts.length + 1));
			}
			return tone(color, high === low ? 1 : Math.min(1, Math.max(0, (value - low) / (high - low))));
		};

		const legend: LegendModel = cuts
			? {
					bins: Array.from(
						{
							length: cuts.length + 1,
						},
						(_, bin) => ({
							color: tone(color, (bin + 1) / (cuts.length + 1)),
							label: bin === 0 ? `< ${format(cuts[0])}` : bin === cuts.length ? `≥ ${format(cuts[bin - 1])}` : `${format(cuts[bin - 1])} – ${format(cuts[bin])}`,
						})
					),
					kind: 'steps',
				}
			: {
					from: tone(color, 0),
					kind: 'continuous',
					max: high,
					min: low,
					to: tone(color, 1),
				};

		// 2. Projection, fitted to the data.
		const projected = createProjection(projection, collection);
		let height = Math.round(VIEWBOX_WIDTH / (aspectRatio ?? 16 / 9));
		if (fit && collection.features.length > 0) {
			projected.fitWidth(VIEWBOX_WIDTH, collection);
			if (!aspectRatio) {
				const [[, top], [, bottom]] = geoPath(projected).bounds(collection);
				const natural = VIEWBOX_WIDTH / (bottom - top);
				if (Number.isFinite(natural)) height = Math.round(VIEWBOX_WIDTH / Math.min(2.4, Math.max(0.7, natural)));
			}
			projected.fitExtent(
				[
					[PADDING, PADDING],
					[VIEWBOX_WIDTH - PADDING, height - PADDING],
				],
				collection
			);
		}

		// 3. Path data.
		const path = geoPath(projected);
		const features: MapFeature[] = [];
		for (const row of rows) {
			const d = path(row.feature);
			const centroid = path.centroid(row.feature);
			if (!d || !Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) continue;
			features.push({
				centroid,
				color: colorFor(row.value),
				d,
				feature: row.feature,
				id: row.id,
				name: row.name,
				properties: row.properties,
				value: row.value,
			});
		}

		return {
			features,
			hasNoData: features.some(feature => feature.value === undefined),
			height,
			legend,
			projection: projected,
		};
	}, [aspectRatio, color, data, domain, fit, format, idKey, nameKey, noDataColor, projection, thresholds, valueKey, values]);

	const [internalSelected, setInternalSelected] = React.useState<string | null>(defaultSelected);
	const selectedId = selected === undefined ? internalSelected : selected;
	const select = React.useCallback(
		(id: string | null) => {
			if (selected === undefined) setInternalSelected(id);
			onSelectedChange?.(id === null ? null : (model.features.find(feature => feature.id === id) ?? null));
		},
		[model.features, onSelectedChange, selected]
	);

	const context = React.useMemo<ChoroplethMapContextValue>(
		() => ({
			features: model.features,
			formatValue: format,
			hasNoData: model.hasNoData,
			height: model.height,
			legend: model.legend,
			noDataColor,
			projection: model.projection,
			select,
			selectedId,
			valueLabel,
			width: VIEWBOX_WIDTH,
		}),
		[format, model, noDataColor, select, selectedId, valueLabel]
	);

	return (
		<ChoroplethMapContext.Provider value={context}>
			<div className={cn('flex w-full flex-col gap-3 font-primary', className)} {...props}>
				{children}
			</div>
		</ChoroplethMapContext.Provider>
	);
}

export interface ChoroplethMapBasemapProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
	/** Your base layer — tiles, a raster, an SVG — or a function receiving the map geometry so you can align it: `projection` maps `[lon, lat]` to `[x, y]` in a `width` × `height` space. For web map tiles use `projection="mercator"`, which matches Web Mercator. */
	children: React.ReactNode | ((map: { projection: GeoProjection; width: number; height: number }) => React.ReactNode);
}

/**
 * A layer painted behind the regions, for anything you want under them (a
 * Mapbox/OSM raster, a graticule, a hillshade). The map itself never depends
 * on it. It fills the map and zooms and pans with the polygons; it is
 * decorative to assistive tech and doesn't receive pointer events.
 */
function ChoroplethMapBasemap({ children, className, ...props }: ChoroplethMapBasemapProps) {
	const map = useChoroplethMap();
	return (
		<div aria-hidden='true' className={cn('pointer-events-none absolute inset-0', className)} {...props}>
			{typeof children === 'function' ? children(map) : children}
		</div>
	);
}

/** Texts rendered by `ChoroplethMap.Canvas`. Pass `lang` to override any of them. */
export interface ChoroplethMapCanvasLang {
	/** Accessible label for the zoom controls' group. */
	mapZoom: string;
	/** Accessible name/tooltip of the zoom-in button. */
	zoomIn: string;
	/** Accessible name/tooltip of the zoom-out button. */
	zoomOut: string;
	/** Accessible name/tooltip of the reset-zoom button. */
	resetZoom: string;
	/** Value text shown for a region with no `value`. */
	noData: string;
}

/** English defaults for `ChoroplethMapCanvasLang`. */
export const defaultChoroplethMapCanvasLang: ChoroplethMapCanvasLang = {
	mapZoom: 'Map zoom',
	noData: 'No data',
	resetZoom: 'Reset zoom',
	zoomIn: 'Zoom in',
	zoomOut: 'Zoom out',
};

export interface ChoroplethMapCanvasProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children' | 'lang'> {
	/** Layers painted behind the regions — `ChoroplethMap.Basemap`. */
	children?: React.ReactNode;
	/**
	 * Accessible name of the map.
	 * @default "Map"
	 */
	'aria-label'?: string;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultChoroplethMapCanvasLang
	 */
	lang?: Partial<ChoroplethMapCanvasLang>;
	/**
	 * Let the user zoom and pan: zoom buttons, double-click, pinch, and drag to pan.
	 * @default true
	 */
	zoomable?: boolean;
	/**
	 * Smallest zoom, where `1` fits the whole map.
	 * @default 1
	 */
	minZoom?: number;
	/**
	 * Largest zoom.
	 * @default 12
	 */
	maxZoom?: number;
	/**
	 * Zoom with the mouse wheel alone. Off by default so scrolling the page over the map doesn't zoom it; hold Ctrl or ⌘ to zoom with the wheel.
	 * @default false
	 */
	scrollZoom?: boolean;
	/**
	 * Show the zoom in / zoom out / reset buttons.
	 * @default true
	 */
	controls?: boolean;
	/**
	 * How much the hovered or selected region grows.
	 * @default 1.05
	 */
	activeScale?: number;
	/** Content of the popover for the hovered, focused or selected region. Defaults to the name and value; pass `false` for no popover. */
	renderTooltip?: false | ((region: ChoroplethRegion) => React.ReactNode);
}

type Anchor =
	| {
			kind: 'pointer';
	  }
	| {
			kind: 'element';
			element: SVGPathElement | null;
	  };

interface MapPopoverProps {
	stage: React.RefObject<HTMLDivElement | null>;
	anchor: Anchor;
	pointer: React.RefObject<{
		x: number;
		y: number;
	}>;
	subscribe: (listener: () => void) => () => void;
	children: React.ReactNode;
}

/** Popover that follows the pointer, or sits on top of a region for keyboard focus and selection, always kept inside the map. */
function MapPopover({ stage, anchor, pointer, subscribe, children }: MapPopoverProps) {
	const ref = React.useRef<HTMLDivElement>(null);

	const place = React.useCallback(() => {
		const element = ref.current;
		const bounds = stage.current?.getBoundingClientRect();
		if (!element || !bounds) return;
		let x: number;
		let y: number;
		if (anchor.kind === 'pointer') {
			x = pointer.current.x - bounds.left;
			y = pointer.current.y - bounds.top;
		} else if (anchor.element) {
			const rect = anchor.element.getBoundingClientRect();
			x = Math.min(bounds.width, Math.max(0, rect.left + rect.width / 2 - bounds.left));
			y = Math.max(rect.top, bounds.top) - bounds.top;
		} else return;
		const left = Math.min(bounds.width - element.offsetWidth - 4, Math.max(4, x - element.offsetWidth / 2));
		let top = y - element.offsetHeight - 12;
		if (top < 4) top = anchor.kind === 'pointer' ? y + 18 : 4;
		element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
	}, [anchor, pointer, stage]);

	// Before paint, so the popover never flashes at the corner.
	React.useLayoutEffect(() => {
		place();
		return subscribe(place);
	}, [place, subscribe]);

	return (
		<div
			className={cn(
				'absolute top-0 left-0 z-10 w-max max-w-64 rounded-md border border-border bg-background p-3 font-primary text-foreground text-xs shadow-md',
				anchor.kind === 'pointer' && 'pointer-events-none'
			)}
			ref={ref}
			role='tooltip'
		>
			{children}
		</div>
	);
}

const ARROWS: Record<string, [number, number]> = {
	ArrowDown: [0, 1],
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
};

const controlClassName =
	'inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-foreground outline-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&_svg]:size-4';

/**
 * The map: one SVG path per region, painted by value. Hovering a region grows
 * it and follows the pointer with a popover; clicking (or Enter/Space)
 * selects it and keeps the popover on it. It is a single tab stop — arrow keys
 * move between neighboring regions, Esc clears the selection. Drag to pan,
 * double-click or use the buttons to zoom; Ctrl/⌘ + wheel and pinch zoom too.
 */
function ChoroplethMapCanvas({
	children,
	className,
	'aria-label': ariaLabel = 'Map',
	zoomable = true,
	minZoom = 1,
	maxZoom = 12,
	scrollZoom = false,
	controls = true,
	activeScale = 1.05,
	renderTooltip,
	lang,
	...props
}: ChoroplethMapCanvasProps) {
	const resolvedLang = { ...defaultChoroplethMapCanvasLang, ...lang };
	const { features, width, height, selectedId, select, formatValue, valueLabel } = useChoroplethMapContext();

	const stageRef = React.useRef<HTMLDivElement>(null);
	const svgRef = React.useRef<SVGSVGElement>(null);
	const transformRef = React.useRef<ReactZoomPanPinchContentRef>(null);
	const pathRefs = React.useRef(new Map<string, SVGPathElement>());
	const pointer = React.useRef({
		x: 0,
		y: 0,
	});
	const pressedAt = React.useRef<{
		x: number;
		y: number;
	} | null>(null);
	const panning = React.useRef(false);
	const listeners = React.useRef(new Set<() => void>());

	const [hoverId, setHoverId] = React.useState<string | null>(null);
	const [focusId, setFocusId] = React.useState<string | null>(null);
	const [tabId, setTabId] = React.useState<string | null>(null);

	const byId = React.useMemo(() => new Map(features.map(feature => [feature.id, feature])), [features]);
	// Roving tab stop: one region is tabbable, arrows reach the others.
	const rovingId = tabId !== null && byId.has(tabId) ? tabId : features[0]?.id;

	const subscribe = React.useCallback((listener: () => void) => {
		listeners.current.add(listener);
		return () => {
			listeners.current.delete(listener);
		};
	}, []);
	const notify = () => {
		for (const listener of listeners.current) listener();
	};

	/** True when the pointer moved since it was pressed, i.e. the click ended a pan. */
	const wasDrag = (event: React.MouseEvent) => {
		const start = pressedAt.current;
		return start !== null && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
	};

	const toggle = (id: string) => select(selectedId === id ? null : id);

	const focusRegion = (id: string) => {
		setTabId(id);
		pathRefs.current.get(id)?.focus({
			preventScroll: true,
		});
	};

	const handleKeyDown = (event: React.KeyboardEvent<SVGPathElement>, from: MapFeature) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			toggle(from.id);
		} else if (event.key === 'Escape') {
			select(null);
		} else if (event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			focusRegion(features[event.key === 'Home' ? 0 : features.length - 1].id);
		} else if (event.key in ARROWS) {
			event.preventDefault();
			const [dirX, dirY] = ARROWS[event.key];
			let best: MapFeature | null = null;
			let bestScore = Number.POSITIVE_INFINITY;
			for (const feature of features) {
				if (feature === from) continue;
				const dx = feature.centroid[0] - from.centroid[0];
				const dy = feature.centroid[1] - from.centroid[1];
				const along = dx * dirX + dy * dirY;
				if (along <= 0) continue;
				const score = along + 2 * Math.abs(dx * dirY - dy * dirX);
				if (score < bestScore) {
					best = feature;
					bestScore = score;
				}
			}
			if (best) focusRegion(best.id);
		}
	};

	const shownId = hoverId ?? focusId ?? selectedId;
	const shown = shownId === null ? undefined : byId.get(shownId);
	const anchor: Anchor = React.useMemo(
		() =>
			hoverId !== null
				? {
						kind: 'pointer',
					}
				: {
						element: shownId === null ? null : (pathRefs.current.get(shownId) ?? null),
						kind: 'element',
					},
		[hoverId, shownId]
	);

	const raised = [selectedId, hoverId ?? focusId].filter((id, index, ids): id is string => id !== null && byId.has(id) && ids.indexOf(id) === index);

	const valueText = (feature: MapFeature) => (feature.value === undefined ? resolvedLang.noData : formatValue(feature.value));

	const tooltip = renderTooltip === undefined ? true : renderTooltip;

	return (
		<div
			className={cn('relative w-full overflow-hidden rounded-md border border-border bg-background', className)}
			onPointerDownCapture={event => {
				pressedAt.current = {
					x: event.clientX,
					y: event.clientY,
				};
			}}
			ref={stageRef}
			style={{
				aspectRatio: `${width} / ${height}`,
			}}
			{...props}
		>
			<TransformWrapper
				disabled={!zoomable}
				doubleClick={{
					mode: 'zoomIn',
				}}
				limitToBounds
				maxScale={maxZoom}
				minScale={minZoom}
				onPanningStart={() => {
					panning.current = true;
					setHoverId(null);
				}}
				onPanningStop={() => {
					panning.current = false;
				}}
				onTransform={(_, state) => {
					// Strokes stay hairline however far the map is zoomed.
					svgRef.current?.style.setProperty('--map-scale', `${state.scale}`);
					requestAnimationFrame(notify);
				}}
				ref={transformRef}
				wheel={{
					activationKeys: scrollZoom ? undefined : ['Control', 'Meta'],
				}}
			>
				<TransformComponent
					contentStyle={{
						height: '100%',
						position: 'relative',
						width: '100%',
					}}
					wrapperStyle={{
						height: '100%',
						inset: 0,
						position: 'absolute',
						width: '100%',
					}}
				>
					{children}
					{/* biome-ignore lint/a11y/useSemanticElements: an <svg> cannot be a <fieldset>; the group names the regions inside it. */}
					{/* biome-ignore lint/a11y/useKeyWithClickEvents: clicking the empty background only clears the selection; keyboard users press Esc on a region. */}
					<svg
						aria-label={ariaLabel}
						className='absolute inset-0 size-full'
						onClick={event => {
							if (event.target === event.currentTarget && !wasDrag(event)) select(null);
						}}
						ref={svgRef}
						role='group'
						style={
							{
								'--map-scale': 1,
							} as React.CSSProperties
						}
						viewBox={`0 0 ${width} ${height}`}
					>
						<g>
							{features.map(feature => (
								// biome-ignore lint/a11y/useSemanticElements: an SVG path cannot be a native <button>.
								<path
									aria-label={`${feature.name}: ${valueText(feature)}`}
									aria-pressed={selectedId === feature.id}
									className='cursor-pointer outline-none'
									d={feature.d}
									fill={feature.color}
									key={feature.id}
									onBlur={() => setFocusId(null)}
									onClick={event => {
										if (!wasDrag(event)) toggle(feature.id);
									}}
									onFocus={event => {
										setTabId(feature.id);
										// Only keyboard focus opens the popover; a mouse click already selects.
										if (event.currentTarget.matches(':focus-visible')) setFocusId(feature.id);
									}}
									onKeyDown={event => handleKeyDown(event, feature)}
									onPointerEnter={event => {
										if (event.pointerType === 'touch' || panning.current) return;
										pointer.current = {
											x: event.clientX,
											y: event.clientY,
										};
										setHoverId(feature.id);
									}}
									onPointerLeave={() => setHoverId(null)}
									onPointerMove={event => {
										pointer.current = {
											x: event.clientX,
											y: event.clientY,
										};
										notify();
									}}
									ref={element => {
										if (element) pathRefs.current.set(feature.id, element);
										else pathRefs.current.delete(feature.id);
									}}
									role='button'
									stroke='var(--background)'
									strokeLinejoin='round'
									style={{
										strokeWidth: STROKE_WIDTH,
									}}
									tabIndex={rovingId === feature.id ? 0 : -1}
								/>
							))}
						</g>
						{/* SVG has no z-index: the raised copies are drawn last so a grown region overlaps its neighbors. */}
						{/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: these copies are decorative and never focusable; the real region keeps focus. */}
						<g aria-hidden='true' className='pointer-events-none'>
							{raised.map(id => {
								const feature = byId.get(id);
								if (!feature) return null;
								return (
									<path
										className='origin-center scale-(--map-active-scale) transition-[scale] duration-150 ease-out transform-fill starting:scale-100 motion-reduce:transition-none'
										d={feature.d}
										fill={feature.color}
										key={id}
										stroke='var(--foreground)'
										strokeLinejoin='round'
										style={
											{
												'--map-active-scale': activeScale,
												strokeWidth: id === selectedId ? 'calc(1.75px / var(--map-scale))' : 'calc(1px / var(--map-scale))',
											} as React.CSSProperties
										}
									/>
								);
							})}
						</g>
					</svg>
				</TransformComponent>
			</TransformWrapper>

			{zoomable && controls && (
				// biome-ignore lint/a11y/useSemanticElements: a <fieldset> is for form controls; this only groups the buttons.
				<div aria-label={resolvedLang.mapZoom} className='absolute top-3 right-3 flex flex-col gap-1' role='group'>
					<button aria-label={resolvedLang.zoomIn} className={controlClassName} onClick={() => transformRef.current?.zoomIn()} type='button'>
						<Plus aria-hidden='true' />
					</button>
					<button aria-label={resolvedLang.zoomOut} className={controlClassName} onClick={() => transformRef.current?.zoomOut()} type='button'>
						<Minus aria-hidden='true' />
					</button>
					<button aria-label={resolvedLang.resetZoom} className={controlClassName} onClick={() => transformRef.current?.resetTransform()} type='button'>
						<Maximize aria-hidden='true' />
					</button>
				</div>
			)}

			{tooltip && shown && (
				<MapPopover anchor={anchor} pointer={pointer} stage={stageRef} subscribe={subscribe}>
					{typeof tooltip === 'function' ? (
						tooltip(shown)
					) : (
						<div className='flex flex-col gap-1'>
							<p className='font-medium'>{shown.name}</p>
							<p className='flex items-center gap-2 text-muted-foreground'>
								<span
									aria-hidden='true'
									className='size-2 shrink-0 rounded-full border border-border'
									style={{
										background: shown.color,
									}}
								/>
								{valueLabel ? `${valueLabel}: ` : ''}
								{shown.value === undefined ? 'No data' : formatValue(shown.value)}
							</p>
						</div>
					)}
				</MapPopover>
			)}
		</div>
	);
}

export interface ChoroplethMapLegendProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Heading above the scale. Defaults to the root's `valueLabel`. */
	title?: string;
	/**
	 * Label of the "no data" swatch, shown only when some region has no value.
	 * @default "No data"
	 */
	noDataLabel?: string;
}

/** The color scale: a gradient with its lowest and highest value, or one swatch per class when `thresholds` are set, plus a "No data" swatch when needed. */
function ChoroplethMapLegend({ title, noDataLabel = 'No data', className, ...props }: ChoroplethMapLegendProps) {
	const { legend, hasNoData, noDataColor, valueLabel, formatValue } = useChoroplethMapContext();
	const heading = title ?? valueLabel;

	return (
		// biome-ignore lint/a11y/useSemanticElements: a <fieldset> is for form controls; this only names the legend.
		<div aria-label={heading ? `${heading} legend` : 'Legend'} className={cn('flex flex-wrap items-end gap-x-6 gap-y-3 text-muted-foreground text-xs', className)} role='group' {...props}>
			<div className='flex flex-col gap-1.5'>
				{heading && <p className='font-medium text-foreground'>{heading}</p>}
				{legend.kind === 'continuous' ? (
					<div className='flex w-56 flex-col gap-1'>
						<div
							aria-hidden='true'
							className='h-2 rounded-full border border-border'
							style={{
								background: `linear-gradient(to right, ${legend.from}, ${legend.to})`,
							}}
						/>
						<div className='flex justify-between'>
							<span>{formatValue(legend.min)}</span>
							<span>{formatValue(legend.max)}</span>
						</div>
					</div>
				) : (
					<ul className='flex flex-wrap gap-x-4 gap-y-1'>
						{legend.bins.map(bin => (
							<li className='flex items-center gap-1.5' key={bin.label}>
								<span
									aria-hidden='true'
									className='size-3 rounded-sm border border-border'
									style={{
										background: bin.color,
									}}
								/>
								{bin.label}
							</li>
						))}
					</ul>
				)}
			</div>
			{hasNoData && (
				<div className='flex items-center gap-1.5'>
					<span
						aria-hidden='true'
						className='size-3 rounded-sm border border-border'
						style={{
							background: noDataColor,
						}}
					/>
					{noDataLabel}
				</div>
			)}
		</div>
	);
}

export const ChoroplethMap = Object.assign(ChoroplethMapRoot, {
	Basemap: ChoroplethMapBasemap,
	Canvas: ChoroplethMapCanvas,
	Legend: ChoroplethMapLegend,
});
