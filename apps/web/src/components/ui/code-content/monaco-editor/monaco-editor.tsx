'use client';

import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react';
import Editor, { loader, useMonaco } from '@monaco-editor/react';
import { Check, ChevronDown, Copy } from 'lucide-react';
import type { editor } from 'monaco-editor';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { Skeleton } from '../../foundations/skeleton/skeleton';
import { cn } from '../../utils/tailwind/cn';

/** Featured languages offered by `MonacoEditor.LanguageSelect` out of the box. Any Monaco language id works as `language` even if it isn't listed here — Monaco ships ~60 grammars, this is just the curated shortlist for the picker. */
export const monacoEditorLanguages: {
	value: string;
	label: string;
}[] = [
	{
		label: 'JavaScript',
		value: 'javascript',
	},
	{
		label: 'TypeScript',
		value: 'typescript',
	},
	{
		label: 'Python',
		value: 'python',
	},
	{
		label: 'SQL',
		value: 'sql',
	},
];

const LIGHT_THEME_NAME = 'scandinavian-light';
const DARK_THEME_NAME = 'scandinavian-dark';

/** Reads a CSS custom property off `<html>` and normalizes it to an opaque hex color (canvas `fillStyle` round-trips any valid CSS color, including `rgb(0 0 0 / 10%)`, into `#rrggbb`/`rgba(...)`) — Monaco's theme API takes literal colors, not `var(...)` references, so tokens are resolved here instead of hardcoded. */
function resolveCssVarToHex(name: string): string {
	const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	if (!raw) return '#000000';

	if (!resolveCssVarToHex.canvas) resolveCssVarToHex.canvas = document.createElement('canvas');
	const ctx = resolveCssVarToHex.canvas.getContext('2d');
	if (!ctx) return '#000000';

	ctx.fillStyle = '#000000';
	ctx.fillStyle = raw;
	const normalized = ctx.fillStyle;
	if (normalized.startsWith('#')) return normalized;

	const match = normalized.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
	if (!match) return '#000000';
	const [, r, g, b, a] = match;
	const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
	const hex = `#${toHex(Number(r))}${toHex(Number(g))}${toHex(Number(b))}`;
	return a === undefined ? hex : `${hex}${toHex(Number(a) * 255)}`;
}
resolveCssVarToHex.canvas = undefined as HTMLCanvasElement | undefined;

/** Drops the leading `#` and any alpha byte — Monaco's token `foreground`/`background` rules take a bare 6-digit hex, unlike its UI `colors` map (which takes `#rrggbb[aa]`). */
function toTokenHex(cssVar: string): string {
	return resolveCssVarToHex(cssVar).replace('#', '').slice(0, 6);
}

/** Restrained syntax palette — reuses `--json-key`/`--json-value` (2 accent hues) rather than a full rainbow theme, mirroring `BlockCode`'s highlighter. Monaco prefix-matches `token`, so `"string"` also covers `"string.sql"`, `"string.python"`, etc. */
const TOKEN_RULES: {
	token: string;
	colorVar: string;
	fontStyle?: 'italic' | 'bold';
}[] = [
	{
		colorVar: '--foreground-tertiary',
		fontStyle: 'italic',
		token: 'comment',
	},
	{
		colorVar: '--json-value',
		token: 'string',
	},
	{
		colorVar: '--json-value',
		token: 'regexp',
	},
	{
		colorVar: '--json-key',
		token: 'number',
	},
	{
		colorVar: '--json-key',
		token: 'keyword',
	},
	{
		colorVar: '--json-key',
		token: 'predefined',
	},
	{
		colorVar: '--json-key',
		token: 'constant',
	},
	{
		colorVar: '--json-key',
		token: 'annotation',
	},
	{
		colorVar: '--foreground',
		fontStyle: 'bold',
		token: 'type',
	},
	{
		colorVar: '--foreground',
		token: 'identifier',
	},
	{
		colorVar: '--foreground',
		token: 'tag',
	},
	{
		colorVar: '--foreground',
		token: 'attribute.name',
	},
	{
		colorVar: '--json-value',
		token: 'attribute.value',
	},
	{
		colorVar: '--foreground-secondary',
		token: 'operator',
	},
	{
		colorVar: '--foreground-secondary',
		token: 'delimiter',
	},
];

/** Editor chrome (gutter, cursor, selection, scrollbars, suggest widget) mapped from the same semantic tokens the rest of the design system uses. */
function buildEditorColors(): Record<string, string> {
	const color = resolveCssVarToHex;
	return {
		'editor.background': color('--background'),
		'editor.foreground': color('--foreground'),
		'editor.inactiveSelectionBackground': color('--hover'),
		'editor.lineHighlightBackground': color('--hover'),
		'editor.selectionBackground': color('--pressed'),
		'editorCursor.foreground': color('--foreground'),
		'editorGutter.background': color('--background'),
		'editorIndentGuide.activeBackground': color('--border-strong'),
		'editorIndentGuide.background': color('--border'),
		'editorLineNumber.activeForeground': color('--foreground'),
		'editorLineNumber.foreground': color('--foreground-tertiary'),
		'editorSuggestWidget.background': color('--background'),
		'editorSuggestWidget.border': color('--border'),
		'editorSuggestWidget.selectedBackground': color('--hover'),
		'editorWhitespace.foreground': color('--border-strong'),
		'editorWidget.background': color('--background'),
		'editorWidget.border': color('--border'),
		'scrollbarSlider.activeBackground': color('--border-strong'),
		'scrollbarSlider.background': color('--border'),
		'scrollbarSlider.hoverBackground': color('--border-strong'),
	};
}

/** Builds a Monaco theme (light or dark) by resolving the current design tokens — called on mount and again whenever the app's theme changes, since `data-theme`/`prefers-color-scheme` aren't known until then. */
function buildMonacoTheme(base: 'vs' | 'vs-dark'): editor.IStandaloneThemeData {
	return {
		base,
		colors: buildEditorColors(),
		inherit: true,
		rules: TOKEN_RULES.map(({ token, colorVar, fontStyle }) => ({
			fontStyle,
			foreground: toTokenHex(colorVar),
			token,
		})),
	};
}

/** Whether `<html>` is currently resolved to dark, following the same precedence `index.css` uses: an explicit `data-theme` wins, otherwise the OS preference. */
function isDarkResolved(): boolean {
	const explicit = document.documentElement.getAttribute('data-theme');
	if (explicit === 'dark') return true;
	if (explicit === 'light') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** (Re)defines both themes against the current tokens. Doesn't switch the active theme itself — `Content` drives that through the `<Editor theme>` prop, so `@monaco-editor/react` owns the single `setTheme` call instead of it racing with one made here. */
function defineMonacoThemes(monaco: Monaco) {
	monaco.editor.defineTheme(LIGHT_THEME_NAME, buildMonacoTheme('vs'));
	monaco.editor.defineTheme(DARK_THEME_NAME, buildMonacoTheme('vs-dark'));
}

let bundledMonaco: Promise<void> | undefined;

/**
 * Serves Monaco from this app's own bundle instead of `@monaco-editor/react`'s
 * default CDN (jsDelivr), so the editor works offline and never contacts a
 * third party — what a self-hosted product needs. Loaded with dynamic imports
 * so server rendering never evaluates Monaco and the editor stays out of the
 * main chunk; it must finish before anything calls `loader.init()` (that
 * includes `useMonaco`), which is why `MonacoEditor.Content` waits for it.
 */
function setupBundledMonaco(): Promise<void> {
	bundledMonaco ??= (async () => {
		const [monaco, editorWorker, jsonWorker, cssWorker, htmlWorker, tsWorker] = await Promise.all([
			import('monaco-editor'),
			import('monaco-editor/editor/editor.worker?worker'),
			import('monaco-editor/language/json/json.worker?worker'),
			import('monaco-editor/language/css/css.worker?worker'),
			import('monaco-editor/language/html/html.worker?worker'),
			import('monaco-editor/language/typescript/ts.worker?worker'),
		]);

		self.MonacoEnvironment = {
			getWorker(_workerId, label) {
				switch (label) {
					case 'json':
						return new jsonWorker.default();
					case 'css':
					case 'scss':
					case 'less':
						return new cssWorker.default();
					case 'html':
					case 'handlebars':
					case 'razor':
						return new htmlWorker.default();
					case 'typescript':
					case 'javascript':
						return new tsWorker.default();
					default:
						return new editorWorker.default();
				}
			},
		};
		loader.config({
			monaco,
		});
	})();
	return bundledMonaco;
}

const isolatedModulesConfigured = new WeakSet<Monaco>();

/**
 * Without an `import`/`export`, a TS/JS file is a "global script" — and
 * Monaco's TS/JS language service shares ONE global scope across every such
 * script currently open on the page. Two unrelated `MonacoEditor` instances
 * that happen to both declare e.g. `function greet` (or the same instance
 * re-validated after a language round-trip) then collide as "Duplicate
 * function implementation", even though neither editor's code actually
 * touches the other's. `moduleDetection: "force"` makes the checker treat
 * every file as its own module regardless of whether it has imports, which
 * isolates each editor's scope and eliminates the cross-instance collision.
 * Runs once per Monaco instance (it's a page-global setting, not per-model).
 */
function configureIsolatedScripts(monaco: Monaco) {
	if (isolatedModulesConfigured.has(monaco)) return;
	isolatedModulesConfigured.add(monaco);

	for (const defaults of [monaco.languages.typescript.typescriptDefaults, monaco.languages.typescript.javascriptDefaults]) {
		defaults.setCompilerOptions({
			...defaults.getCompilerOptions(),
			moduleDetection: 'force',
		});
	}
}

function resolvedThemeName(): string {
	return isDarkResolved() ? DARK_THEME_NAME : LIGHT_THEME_NAME;
}

/** Re-defines the Monaco themes and reports the active one, re-run whenever `data-theme` changes or the OS preference flips — the same two triggers `index.css`'s cascade reacts to. */
function useMonacoThemeSync(monaco: Monaco | null | undefined): string {
	const [themeName, setThemeName] = React.useState(resolvedThemeName);

	React.useEffect(() => {
		if (!monaco) return;

		const sync = () => {
			defineMonacoThemes(monaco);
			setThemeName(resolvedThemeName());
		};
		sync();

		const observer = new MutationObserver(sync);
		observer.observe(document.documentElement, {
			attributeFilter: ['data-theme'],
			attributes: true,
		});

		const media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', sync);

		return () => {
			observer.disconnect();
			media.removeEventListener('change', sync);
		};
	}, [monaco]);

	return themeName;
}

interface MonacoEditorContextValue {
	ariaLabel: string;
	editorRef: React.RefObject<editor.IStandaloneCodeEditor | null>;
	height: number | string;
	language: string;
	/** Unique model URI for this instance, so its model has a stable identity distinct from any other `MonacoEditor` on the page. */
	modelPath: string;
	readOnly: boolean;
	setLanguage: (language: string) => void;
	setValue: (value: string) => void;
	setWordWrap: (wordWrap: boolean) => void;
	value: string;
	wordWrap: boolean;
}

const MonacoEditorContext = React.createContext<MonacoEditorContextValue | null>(null);

function useMonacoEditorContext() {
	const context = React.useContext(MonacoEditorContext);
	if (!context) {
		throw new Error('MonacoEditor subcomponents must be used within <MonacoEditor.Root>.');
	}
	return context;
}

export interface MonacoEditorRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'defaultValue'> {
	/** Accessible name for the editor's text area (screen readers, since the canvas-rendered content has no DOM text). @default "Code editor" */
	ariaLabel?: string;
	/**
	 * Initial language, for uncontrolled usage.
	 * @default "typescript"
	 */
	defaultLanguage?: string;
	/** Initial source code, for uncontrolled usage. @default "" */
	defaultValue?: string;
	/**
	 * Wraps long lines instead of scrolling horizontally, for uncontrolled usage — toggled via `MonacoEditor.WordWrapToggle`.
	 * @default false
	 */
	defaultWordWrap?: boolean;
	/**
	 * Editor viewport height (px, or any CSS length).
	 * @default 320
	 */
	height?: number | string;
	/** Monaco language id (`"javascript"`, `"typescript"`, `"python"`, `"sql"`, or any of Monaco's ~60 built-in grammars), for controlled usage. */
	language?: string;
	/** Called with the new language when changed through `MonacoEditor.LanguageSelect`. */
	onLanguageChange?: (language: string) => void;
	/** Called with the new source code on every edit. */
	onValueChange?: (value: string) => void;
	/**
	 * Disables edits; the editor still scrolls, selects and copies.
	 * @default false
	 */
	readOnly?: boolean;
	/** Source code, for controlled usage. */
	value?: string;
}

/**
 * Compound Monaco code editor — full IntelliSense-grade editing (syntax
 * highlighting, bracket matching, multi-cursor, find/replace) for
 * JavaScript, TypeScript, Python and SQL out of the box, extensible to any
 * of Monaco's other built-in languages by passing its id. Renders as a
 * client-only component: Monaco itself is loaded lazily from the app's own bundle
 * (no CDN) on first mount, so it costs nothing until
 * `MonacoEditor.Content` actually renders.
 * @example
 * ```tsx
 * <MonacoEditor.Root defaultLanguage="typescript" defaultValue={code}>
 *   <MonacoEditor.Header>
 *     <MonacoEditor.LanguageSelect />
 *     <MonacoEditor.WordWrapToggle />
 *     <MonacoEditor.CopyButton />
 *   </MonacoEditor.Header>
 *   <MonacoEditor.Content />
 *   <MonacoEditor.StatusBar />
 * </MonacoEditor.Root>
 * ```
 */
function MonacoEditorRoot({
	value: controlledValue,
	defaultValue = '',
	onValueChange,
	language: controlledLanguage,
	defaultLanguage = 'typescript',
	onLanguageChange,
	readOnly = false,
	height = 320,
	defaultWordWrap = false,
	ariaLabel = 'Code editor',
	className,
	children,
	...props
}: MonacoEditorRootProps) {
	const [internalValue, setInternalValue] = React.useState(defaultValue);
	const value = controlledValue ?? internalValue;
	const setValue = React.useCallback(
		(next: string) => {
			if (controlledValue === undefined) setInternalValue(next);
			onValueChange?.(next);
		},
		[controlledValue, onValueChange]
	);

	const [internalLanguage, setInternalLanguage] = React.useState(defaultLanguage);
	const language = controlledLanguage ?? internalLanguage;
	const setLanguage = React.useCallback(
		(next: string) => {
			if (controlledLanguage === undefined) setInternalLanguage(next);
			onLanguageChange?.(next);
		},
		[controlledLanguage, onLanguageChange]
	);

	const [wordWrap, setWordWrap] = React.useState(defaultWordWrap);
	const editorRef = React.useRef<editor.IStandaloneCodeEditor | null>(null);
	const instanceId = React.useId();
	// Deliberately doesn't encode `language` — the model's language is switched
	// in place via `setModelLanguage` (see `MonacoEditorContent`), and a path
	// that changed with it would make `@monaco-editor/react` swap in a new
	// model on every language change without disposing the old one (a leak).
	const modelPath = `file:///${instanceId}.snippet`;

	const contextValue = React.useMemo<MonacoEditorContextValue>(
		() => ({
			ariaLabel,
			editorRef,
			height,
			language,
			modelPath,
			readOnly,
			setLanguage,
			setValue,
			setWordWrap,
			value,
			wordWrap,
		}),
		[ariaLabel, height, language, modelPath, readOnly, setLanguage, setValue, value, wordWrap]
	);

	return (
		<MonacoEditorContext.Provider value={contextValue}>
			<div className={cn('flex w-full flex-col overflow-hidden rounded-md border border-border bg-background font-primary text-foreground', className)} {...props}>
				{children}
			</div>
		</MonacoEditorContext.Provider>
	);
}

export interface MonacoEditorHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Toolbar above the editor — typically `LanguageSelect`, `WordWrapToggle` and `CopyButton`. */
function MonacoEditorHeader({ className, ...props }: MonacoEditorHeaderProps) {
	return <div className={cn('flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1.5', className)} {...props} />;
}

export interface MonacoEditorLanguageSelectProps {
	className?: string;
	/** Languages offered in the dropdown. @default monacoEditorLanguages */
	languages?: {
		value: string;
		label: string;
	}[];
}

/** Dropdown that switches `MonacoEditor.Root`'s language, defaulting to the JavaScript/TypeScript/Python/SQL shortlist. */
function MonacoEditorLanguageSelect({ languages = monacoEditorLanguages, className }: MonacoEditorLanguageSelectProps) {
	const { language, setLanguage } = useMonacoEditorContext();
	const [open, setOpen] = React.useState(false);
	const rootRef = React.useRef<HTMLDivElement>(null);
	const triggerId = React.useId();
	const listId = React.useId();

	React.useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') setOpen(false);
		};
		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [open]);

	const current = languages.find(option => option.value === language);

	return (
		<div className={cn('relative', className)} ref={rootRef}>
			<button
				aria-controls={listId}
				aria-expanded={open}
				aria-haspopup='listbox'
				className={cn(
					'flex items-center gap-1.5 rounded-sm px-2 py-1 font-secondary text-xs font-medium text-foreground transition-colors duration-150 ease-in-out',
					'hover:bg-background focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
					'cursor-pointer'
				)}
				id={triggerId}
				onClick={() => setOpen(prev => !prev)}
				type='button'
			>
				{current?.label ?? language}
				<Icon className={cn('text-muted-foreground transition-transform duration-150 ease-in-out', open && 'rotate-180')} icon={ChevronDown} size='xs' />
			</button>
			{open && (
				<div
					aria-labelledby={triggerId}
					className='absolute top-full left-0 z-10 mt-1 min-w-32 overflow-hidden rounded-md border border-border bg-background py-1 shadow-md'
					id={listId}
					role='listbox'
				>
					{languages.map(option => (
						<button
							aria-selected={option.value === language}
							className={cn(
								'flex w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left font-primary text-sm text-foreground transition-colors duration-150 ease-in-out',
								'hover:bg-muted focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!'
							)}
							key={option.value}
							onClick={() => {
								setLanguage(option.value);
								setOpen(false);
							}}
							role='option'
							type='button'
						>
							{option.label}
							{option.value === language && <Icon icon={Check} size='xs' />}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export interface MonacoEditorWordWrapToggleProps {
	className?: string;
	/**
	 * Label of the toggle.
	 * @default "Wrap"
	 */
	label?: string;
}

/** Toggles line-wrapping for long lines. */
function MonacoEditorWordWrapToggle({ label = 'Wrap', className }: MonacoEditorWordWrapToggleProps) {
	const { wordWrap, setWordWrap } = useMonacoEditorContext();
	return (
		<button
			aria-pressed={wordWrap}
			className={cn(
				'cursor-pointer rounded-sm px-2 py-1 font-primary text-xs font-medium transition-colors duration-150 ease-in-out',
				'focus-visible:outline-2! focus-visible:outline-offset-1! focus-visible:outline-ring!',
				wordWrap ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background hover:text-foreground',
				className
			)}
			onClick={() => setWordWrap(!wordWrap)}
			type='button'
		>
			{label}
		</button>
	);
}

/** Texts rendered by `MonacoEditor.CopyButton`. Pass `lang` to override any of them. */
export interface MonacoEditorCopyButtonLang {
	/** Accessible label right after copying. */
	copied: string;
	/** Accessible label before copying. */
	copy: string;
}

/** English defaults for `MonacoEditorCopyButtonLang`. */
export const defaultMonacoEditorCopyButtonLang: MonacoEditorCopyButtonLang = {
	copied: 'Copied',
	copy: 'Copy code',
};

export interface MonacoEditorCopyButtonProps {
	className?: string;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultMonacoEditorCopyButtonLang
	 */
	lang?: Partial<MonacoEditorCopyButtonLang>;
}

/** Copies `MonacoEditor.Root`'s current value to the clipboard, showing a brief confirmation. */
function MonacoEditorCopyButton({ lang, className }: MonacoEditorCopyButtonProps) {
	const resolvedLang = { ...defaultMonacoEditorCopyButtonLang, ...lang };
	const { value } = useMonacoEditorContext();
	const [copied, setCopied] = React.useState(false);

	const handleClick = async () => {
		await navigator.clipboard.writeText(value);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};

	return (
		<button
			aria-label={copied ? resolvedLang.copied : resolvedLang.copy}
			className={cn(
				'flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-background hover:text-foreground',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				className
			)}
			onClick={handleClick}
			type='button'
		>
			<span className='flex animate-fade-scale-in' key={copied ? 'copied' : 'copy'}>
				<Icon icon={copied ? Check : Copy} size='xs' />
			</span>
		</button>
	);
}

export interface MonacoEditorContentProps {
	className?: string;
	/**
	 * Label of the skeleton shown while Monaco loads.
	 * @default "Loading editor…"
	 */
	loadingLabel?: string;
	/**
	 * Shows the minimap on the right edge; off by default since it costs extra
	 * layout/paint work and rarely earns its space at typical embed sizes.
	 * @default false
	 */
	minimap?: boolean;
	/** Monaco editor options merged on top of this component's defaults, for anything not exposed as its own prop. */
	options?: editor.IStandaloneEditorConstructionOptions;
}

/** The editor surface itself. Mounts Monaco lazily (from this app's own bundle, never a CDN) and keeps it in sync with `MonacoEditor.Root`'s value/language/theme. */
function MonacoEditorContent({ className, minimap = false, options, loadingLabel = 'Loading editor…' }: MonacoEditorContentProps) {
	const { height } = useMonacoEditorContext();
	const [bundled, setBundled] = React.useState(false);

	React.useEffect(() => {
		let cancelled = false;
		void setupBundledMonaco().then(() => {
			if (!cancelled) setBundled(true);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	if (!bundled) {
		return (
			<div
				className={cn('relative', className)}
				style={{
					height,
				}}
			>
				<EditorSkeleton label={loadingLabel} />
			</div>
		);
	}

	return <MonacoEditorSurface className={className} loadingLabel={loadingLabel} minimap={minimap} options={options} />;
}

function EditorSkeleton({ label }: { label: string }) {
	return (
		<Skeleton className='flex h-full w-full flex-col gap-2 p-3' label={label}>
			<Skeleton.Item className='h-4 w-1/3' />
			<Skeleton.Item className='h-4 w-2/3' />
			<Skeleton.Item className='h-4 w-1/2' />
		</Skeleton>
	);
}

/** Only rendered once the bundled Monaco is configured: `useMonaco` and `<Editor>` start `loader.init()`, which would otherwise fall back to the CDN. */
function MonacoEditorSurface({
	className,
	minimap,
	options,
	loadingLabel,
}: Required<Pick<MonacoEditorContentProps, 'minimap' | 'loadingLabel'>> & Pick<MonacoEditorContentProps, 'className' | 'options'>) {
	const { value, setValue, language, readOnly, height, wordWrap, ariaLabel, editorRef, modelPath } = useMonacoEditorContext();
	const monaco = useMonaco();
	const themeName = useMonacoThemeSync(monaco);

	const handleBeforeMount: BeforeMount = monacoInstance => {
		defineMonacoThemes(monacoInstance);
		configureIsolatedScripts(monacoInstance);
	};

	const handleMount: OnMount = editorInstance => {
		editorRef.current = editorInstance;
	};

	return (
		<div
			className={cn('relative', className)}
			style={{
				height,
			}}
		>
			<Editor
				beforeMount={handleBeforeMount}
				language={language}
				loading={<EditorSkeleton label={loadingLabel} />}
				onChange={next => setValue(next ?? '')}
				onMount={handleMount}
				options={{
					ariaLabel,
					fontFamily: 'var(--font-secondary)',
					fontSize: 13,
					minimap: {
						enabled: minimap,
					},
					padding: {
						bottom: 12,
						top: 12,
					},
					readOnly,
					scrollBeyondLastLine: false,
					smoothScrolling: true,
					wordWrap: wordWrap ? 'on' : 'off',
					...options,
				}}
				path={modelPath}
				theme={themeName}
				value={value}
			/>
		</div>
	);
}

export interface MonacoEditorStatusBarProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Footer showing the current language and line/character counts — a static summary rather than a live cursor tracker, so it costs nothing beyond `value`/`language` already in context. */
function MonacoEditorStatusBar({ className, ...props }: MonacoEditorStatusBarProps) {
	const { value, language } = useMonacoEditorContext();
	const lineCount = value === '' ? 0 : value.split('\n').length;
	const current = monacoEditorLanguages.find(option => option.value === language);

	return (
		<div className={cn('flex items-center justify-between gap-2 border-t border-border bg-muted px-3 py-1 font-secondary text-xs text-muted-foreground', className)} {...props}>
			<span>{current?.label ?? language}</span>
			<span>
				{lineCount} {lineCount === 1 ? 'line' : 'lines'} · {value.length} chars
			</span>
		</div>
	);
}

export const MonacoEditor = Object.assign(MonacoEditorRoot, {
	Content: MonacoEditorContent,
	CopyButton: MonacoEditorCopyButton,
	Header: MonacoEditorHeader,
	LanguageSelect: MonacoEditorLanguageSelect,
	StatusBar: MonacoEditorStatusBar,
	WordWrapToggle: MonacoEditorWordWrapToggle,
});
