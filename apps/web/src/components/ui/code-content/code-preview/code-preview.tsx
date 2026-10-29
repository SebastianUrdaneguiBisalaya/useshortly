'use client';

import { Monitor, Play, RotateCcw, Smartphone, Tablet } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { Resizable, type ResizableHandleProps, type ResizablePanelProps, type ResizableProps } from '../../layout/resizable/resizable';
import { cn } from '../../utils/tailwind/cn';
import { MonacoEditor, type MonacoEditorContentProps } from '../monaco-editor/monaco-editor';

/** Languages `CodePreview` knows how to run: a full HTML document (inline `<style>`/`<script>` included) or a bare JavaScript snippet. */
export type CodePreviewLanguage = 'html' | 'javascript';

/** Languages offered by `CodePreview` — pass to `MonacoEditor.LanguageSelect` if you compose one into `CodePreview.Editor`. */
export const codePreviewLanguages: {
	value: CodePreviewLanguage;
	label: string;
}[] = [
	{
		label: 'HTML',
		value: 'html',
	},
	{
		label: 'JavaScript',
		value: 'javascript',
	},
];

/** Texts rendered by `CodePreview`. Pass `lang` on `CodePreview` to override any of them. */
export interface CodePreviewLang {
	/** Accessible label of the `CodePreview.DeviceSelect` group. */
	device: string;
	/** Accessible label of the full-width device option. */
	deviceFull: string;
	/** Accessible label of the mobile device option. */
	deviceMobile: string;
	/** Accessible label of the tablet device option. */
	deviceTablet: string;
	/** Prefix of the runtime error shown under the preview. */
	error: string;
	/** Title of the preview toolbar and accessible name of the preview frame. */
	preview: string;
	/** Accessible label of `CodePreview.ResetButton`. */
	reset: string;
	/** Label of `CodePreview.RunButton`. */
	run: string;
}

/** Width the preview frame takes at each device preset. `full` fills the column; the others are capped by it (`max-w-full`), so they never overflow a narrow container. */
export type CodePreviewDevice = 'full' | 'tablet' | 'mobile';

const DEVICE_WIDTHS: Record<CodePreviewDevice, number | undefined> = {
	full: undefined,
	mobile: 375,
	tablet: 768,
};

/** English defaults for `CodePreviewLang`. */
export const defaultCodePreviewLang: CodePreviewLang = {
	device: 'Preview width',
	deviceFull: 'Full width',
	deviceMobile: 'Mobile',
	deviceTablet: 'Tablet',
	error: 'Error',
	preview: 'Preview',
	reset: 'Reset code',
	run: 'Run',
};

/** Maximum length of a runtime error message rendered under the preview — it comes from untrusted code, so it is truncated. */
const MAX_ERROR_LENGTH = 300;

/**
 * Sandbox flags of the preview frame. Deliberately WITHOUT `allow-same-origin`
 * (the frame gets an opaque origin, so it can't read the host's cookies,
 * storage or DOM), `allow-top-navigation`, `allow-popups` and
 * `allow-modals`. Not configurable: combining `allow-scripts` with
 * `allow-same-origin` would let the code remove its own sandbox.
 */
const SANDBOX = 'allow-scripts';

/**
 * Content-Security-Policy injected first into every preview document. The
 * code runs inline, but it can't make any network request (no `fetch`/XHR/
 * WebSocket, no remote scripts, images, fonts or frames), can't submit forms
 * and can't change `<base>` — so it can't exfiltrate anything or load a
 * second-stage payload.
 */
const CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline'",
	"style-src 'unsafe-inline'",
	'img-src data: blob:',
	'font-src data:',
	'media-src data: blob:',
	"connect-src 'none'",
	"frame-src 'none'",
	"form-action 'none'",
	"base-uri 'none'",
].join('; ');

interface PreviewTheme {
	background: string;
	dark: boolean;
	fontFamily: string;
	foreground: string;
}

function readPreviewTheme(): PreviewTheme {
	const root = document.documentElement;
	const styles = getComputedStyle(root);
	const explicit = root.getAttribute('data-theme');
	const dark = explicit === 'dark' || (explicit !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	return {
		background: styles.getPropertyValue('--background').trim() || 'transparent',
		dark,
		fontFamily: styles.getPropertyValue('--font-primary').trim() || 'system-ui, sans-serif',
		foreground: styles.getPropertyValue('--foreground').trim() || 'inherit',
	};
}

/** Resolved light/dark tokens of the host page, re-read when `data-theme` or the OS preference changes — `null` until mounted so SSR and hydration markup match. */
function usePreviewTheme(): PreviewTheme | null {
	const [theme, setTheme] = React.useState<PreviewTheme | null>(null);

	React.useEffect(() => {
		const sync = () => setTheme(readPreviewTheme());
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
	}, []);

	return theme;
}

/** Strips characters that could close the `<style>`/`<script>` blocks this module writes tokens or theme values into. */
function sanitizeInline(value: string): string {
	return value.replace(/[<>\\]/g, '');
}

/** Escapes a closing `</script` sequence so a JavaScript snippet can't break out of the `<script>` it is wrapped in. */
function escapeScript(code: string): string {
	return code.replace(/<\/(script)/gi, '<\\/$1');
}

/** Builds the sandboxed document: CSP first, then theme baseline, then an error reporter, then the user's code. */
function buildSrcDoc({ code, language, token, theme }: { code: string; language: string; token: string; theme: PreviewTheme }): string {
	const baseline = `html,body{margin:0}:root{color-scheme:${theme.dark ? 'dark' : 'light'}}body{background:${sanitizeInline(theme.background)};color:${sanitizeInline(theme.foreground)};font-family:${sanitizeInline(theme.fontFamily)}}`;
	const reporter = `(function(){var t=${JSON.stringify(token)};function s(m){try{parent.postMessage({codePreview:t,message:String(m)},"*")}catch(e){}}window.addEventListener("error",function(e){s(e.message)});window.addEventListener("unhandledrejection",function(e){s(e.reason&&e.reason.message||e.reason)})})();`;
	const body = language === 'javascript' ? `<script>${escapeScript(code)}</script>` : code;

	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="referrer" content="no-referrer"><style>${baseline}</style><script>${reporter}</script></head><body>${body}</body></html>`;
}

interface CodePreviewContextValue {
	ariaLabel: string;
	code: string;
	device: CodePreviewDevice;
	lang: CodePreviewLang;
	language: string;
	readOnly: boolean;
	reset: () => void;
	run: () => void;
	/** Code the preview is currently running — follows `code` (debounced) in `live` mode, only advances on `run()` in `manual`. */
	runCode: string;
	runMode: 'live' | 'manual';
	setCode: (code: string) => void;
	setDevice: (device: CodePreviewDevice) => void;
	setLanguage: (language: string) => void;
}

const CodePreviewContext = React.createContext<CodePreviewContextValue | null>(null);

function useCodePreviewContext() {
	const context = React.useContext(CodePreviewContext);
	if (!context) {
		throw new Error('CodePreview subcomponents must be used within <CodePreview.Root>.');
	}
	return context;
}

export interface CodePreviewRootProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'defaultValue' | 'lang'> {
	/**
	 * Accessible name for the editor's text area.
	 * @default "Code editor"
	 */
	ariaLabel?: string;
	/**
	 * Delay in ms between the last keystroke and the preview refresh, in `live` mode.
	 * @default 400
	 */
	debounceMs?: number;
	/**
	 * Initial width preset of the preview frame, switched through `CodePreview.DeviceSelect`.
	 * @default "full"
	 */
	defaultDevice?: CodePreviewDevice;
	/**
	 * Initial language, for uncontrolled usage.
	 * @default "html"
	 */
	defaultLanguage?: CodePreviewLanguage;
	/** Initial source code, for uncontrolled usage. `CodePreview.ResetButton` restores it. @default "" */
	defaultValue?: string;
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultCodePreviewLang
	 */
	lang?: Partial<CodePreviewLang>;
	/** Language of the code, for controlled usage. */
	language?: CodePreviewLanguage;
	/** Called with the new language when changed through a `MonacoEditor.LanguageSelect` composed into the editor. */
	onLanguageChange?: (language: CodePreviewLanguage) => void;
	/** Called with the new source code on every edit. */
	onValueChange?: (value: string) => void;
	/**
	 * Disables edits; the editor still scrolls, selects and copies.
	 * @default false
	 */
	readOnly?: boolean;
	/**
	 * `"live"` re-runs the preview shortly after every edit; `"manual"` only when `CodePreview.RunButton` is pressed.
	 * @default "live"
	 */
	runMode?: 'live' | 'manual';
	/** Source code, for controlled usage. */
	value?: string;
}

/**
 * Compound live code playground: a Monaco editor and a sandboxed preview of
 * its output, side by side in two resizable columns (stacked on small
 * screens). It has no intrinsic size — it fills its parent (`h-full w-full`),
 * so give it a height through the parent, or `flex-1`/`h-*` via `className`
 * inside a fixed-size container or modal.
 *
 * **Security:** the code is untrusted and runs in an `<iframe>` with
 * `sandbox="allow-scripts"` (opaque origin: no access to the host's cookies,
 * storage, DOM or `window.top`), a strict Content-Security-Policy (no network
 * requests, remote resources, forms or popups) and no referrer. Runtime
 * errors are reported back via `postMessage`, filtered by frame and token, and
 * shown as plain text.
 * @example
 * ```tsx
 * <div className="h-96">
 *   <CodePreview.Root defaultValue={html}>
 *     <CodePreview.Body>
 *       <CodePreview.Editor />
 *       <CodePreview.Handle />
 *       <CodePreview.Preview />
 *     </CodePreview.Body>
 *   </CodePreview.Root>
 * </div>
 * ```
 */
function CodePreviewRoot({
	value: controlledValue,
	defaultValue = '',
	onValueChange,
	language: controlledLanguage,
	defaultLanguage = 'html',
	onLanguageChange,
	runMode = 'live',
	debounceMs = 400,
	readOnly = false,
	ariaLabel = 'Code editor',
	defaultDevice = 'full',
	lang,
	className,
	children,
	...props
}: CodePreviewRootProps) {
	const [device, setDevice] = React.useState<CodePreviewDevice>(defaultDevice);
	const langDevice = lang?.device;
	const langDeviceFull = lang?.deviceFull;
	const langDeviceMobile = lang?.deviceMobile;
	const langDeviceTablet = lang?.deviceTablet;
	const langError = lang?.error;
	const langPreview = lang?.preview;
	const langReset = lang?.reset;
	const langRun = lang?.run;
	const resolvedLang = React.useMemo<CodePreviewLang>(
		() => ({
			device: langDevice ?? defaultCodePreviewLang.device,
			deviceFull: langDeviceFull ?? defaultCodePreviewLang.deviceFull,
			deviceMobile: langDeviceMobile ?? defaultCodePreviewLang.deviceMobile,
			deviceTablet: langDeviceTablet ?? defaultCodePreviewLang.deviceTablet,
			error: langError ?? defaultCodePreviewLang.error,
			preview: langPreview ?? defaultCodePreviewLang.preview,
			reset: langReset ?? defaultCodePreviewLang.reset,
			run: langRun ?? defaultCodePreviewLang.run,
		}),
		[langDevice, langDeviceFull, langDeviceMobile, langDeviceTablet, langError, langPreview, langReset, langRun]
	);
	const initialCode = React.useRef(controlledValue ?? defaultValue);

	const [internalValue, setInternalValue] = React.useState(defaultValue);
	const code = controlledValue ?? internalValue;
	const setCode = React.useCallback(
		(next: string) => {
			if (controlledValue === undefined) setInternalValue(next);
			onValueChange?.(next);
		},
		[controlledValue, onValueChange]
	);

	const [internalLanguage, setInternalLanguage] = React.useState<string>(defaultLanguage);
	const language = controlledLanguage ?? internalLanguage;
	const setLanguage = React.useCallback(
		(next: string) => {
			if (controlledLanguage === undefined) setInternalLanguage(next);
			onLanguageChange?.(next as CodePreviewLanguage);
		},
		[controlledLanguage, onLanguageChange]
	);

	const [runCode, setRunCode] = React.useState(code);

	React.useEffect(() => {
		if (runMode !== 'live') return;
		const id = setTimeout(() => setRunCode(code), debounceMs);
		return () => clearTimeout(id);
	}, [code, runMode, debounceMs]);

	const run = React.useCallback(() => setRunCode(code), [code]);
	const reset = React.useCallback(() => {
		setCode(initialCode.current);
		setRunCode(initialCode.current);
	}, [setCode]);

	const contextValue = React.useMemo<CodePreviewContextValue>(
		() => ({
			ariaLabel,
			code,
			device,
			lang: resolvedLang,
			language,
			readOnly,
			reset,
			run,
			runCode,
			runMode,
			setCode,
			setDevice,
			setLanguage,
		}),
		[ariaLabel, code, device, resolvedLang, language, readOnly, reset, run, runCode, runMode, setCode, setLanguage]
	);

	return (
		<CodePreviewContext.Provider value={contextValue}>
			<div className={cn('flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-border bg-background font-primary text-foreground', className)} {...props}>
				{children}
			</div>
		</CodePreviewContext.Provider>
	);
}

export interface CodePreviewBodyProps extends ResizableProps {}

/**
 * The split itself: lays out `CodePreview.Editor`, `CodePreview.Handle` and `CodePreview.Preview` in two resizable columns, stacking them below the `md` breakpoint. Fills the remaining space of `CodePreview.Root`.
 */
function CodePreviewBody({ className, stackBelow = 'md', ...props }: CodePreviewBodyProps) {
	return (
		<div className={cn('min-h-0 min-w-0 flex-1', className)}>
			<Resizable stackBelow={stackBelow} {...props} />
		</div>
	);
}

export interface CodePreviewEditorProps extends Omit<ResizablePanelProps, 'children'> {
	/**
	 * Content of the editor column, composed from `MonacoEditor.*` parts and `CodePreview.EditorContent`. Defaults to a toolbar (language label, word-wrap toggle, copy button) plus the editor.
	 */
	children?: React.ReactNode;
}

/** Left column: a `MonacoEditor` bound to `CodePreview.Root`'s code, language and read-only state. */
function CodePreviewEditor({ children, className, defaultSize = '50%', id = 'code-preview-editor', minSize = '25%', ...props }: CodePreviewEditorProps) {
	const { code, setCode, language, setLanguage, readOnly, ariaLabel } = useCodePreviewContext();
	const current = codePreviewLanguages.find(option => option.value === language);

	return (
		<Resizable.Panel className={cn('flex min-h-0 flex-col overflow-hidden', className)} defaultSize={defaultSize} id={id} minSize={minSize} {...props}>
			<MonacoEditor
				ariaLabel={ariaLabel}
				className='min-h-0 flex-1 rounded-none border-0'
				height='100%'
				language={language}
				onLanguageChange={setLanguage}
				onValueChange={setCode}
				readOnly={readOnly}
				value={code}
			>
				{children ?? (
					<>
						<MonacoEditor.Header className='h-9 shrink-0 py-0'>
							<span className='font-secondary text-xs font-medium text-foreground'>{current?.label ?? language}</span>
							<div className='flex items-center gap-1'>
								<MonacoEditor.WordWrapToggle />
								<MonacoEditor.CopyButton />
							</div>
						</MonacoEditor.Header>
						<CodePreviewEditorContent />
					</>
				)}
			</MonacoEditor>
		</Resizable.Panel>
	);
}

export interface CodePreviewEditorContentProps extends MonacoEditorContentProps {}

/** `MonacoEditor.Content` set up to fill its column and re-layout whenever the column is resized (Monaco doesn't do that by itself). */
function CodePreviewEditorContent({ className, options, ...props }: CodePreviewEditorContentProps) {
	return (
		<MonacoEditor.Content
			className={cn('min-h-0 flex-1', className)}
			options={{
				automaticLayout: true,
				...options,
			}}
			{...props}
		/>
	);
}

export interface CodePreviewHandleProps extends ResizableHandleProps {}

/** Draggable divider between the editor and the preview — keyboard-resizable (arrow keys, Home/End) as a WAI-ARIA window splitter. */
function CodePreviewHandle(props: CodePreviewHandleProps) {
	return <Resizable.Handle {...props} />;
}

export interface CodePreviewPreviewProps extends Omit<ResizablePanelProps, 'children'> {
	/**
	 * Content of the preview column. Defaults to `CodePreview.PreviewHeader` plus `CodePreview.PreviewFrame`.
	 */
	children?: React.ReactNode;
}

/** Right column: the sandboxed output of the code. */
function CodePreviewPreview({ children, className, defaultSize = '50%', id = 'code-preview-preview', minSize = '25%', ...props }: CodePreviewPreviewProps) {
	return (
		<Resizable.Panel className={cn('flex min-h-0 flex-col overflow-hidden', className)} defaultSize={defaultSize} id={id} minSize={minSize} {...props}>
			{children ?? (
				<>
					<CodePreviewPreviewHeader />
					<CodePreviewPreviewFrame />
				</>
			)}
		</Resizable.Panel>
	);
}

export interface CodePreviewPreviewHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Toolbar above the preview. Defaults to the title, `ResetButton` and — in `manual` mode — `RunButton`. */
function CodePreviewPreviewHeader({ className, children, ...props }: CodePreviewPreviewHeaderProps) {
	const { lang, runMode } = useCodePreviewContext();
	return (
		<div className={cn('flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border bg-muted px-3', className)} {...props}>
			{children ?? (
				<>
					<span className='font-secondary text-xs font-medium text-foreground'>{lang.preview}</span>
					<div className='flex items-center gap-1'>
						<CodePreviewDeviceSelect />
						<CodePreviewResetButton />
						{runMode === 'manual' && <CodePreviewRunButton />}
					</div>
				</>
			)}
		</div>
	);
}

export interface CodePreviewRunButtonProps {
	className?: string;
}

/** Runs the current code in the preview now, instead of waiting for the live debounce. */
function CodePreviewRunButton({ className }: CodePreviewRunButtonProps) {
	const { run, lang } = useCodePreviewContext();
	return (
		<button
			className={cn(
				'flex cursor-pointer items-center gap-1.5 rounded-sm bg-foreground px-2 py-1 font-primary text-xs font-medium text-background transition-opacity duration-150 ease-in-out hover:opacity-90',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				className
			)}
			onClick={run}
			type='button'
		>
			<Icon icon={Play} size='xs' />
			{lang.run}
		</button>
	);
}

export interface CodePreviewResetButtonProps {
	className?: string;
}

/** Restores the code to its initial value. */
function CodePreviewResetButton({ className }: CodePreviewResetButtonProps) {
	const { reset, lang, readOnly } = useCodePreviewContext();
	return (
		<button
			aria-label={lang.reset}
			className={cn(
				'flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 text-muted-foreground transition-colors duration-150 ease-in-out hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				className
			)}
			disabled={readOnly}
			onClick={reset}
			type='button'
		>
			<Icon icon={RotateCcw} size='xs' />
		</button>
	);
}

export interface CodePreviewDeviceSelectProps {
	className?: string;
}

/** Group of toggle buttons that switches the preview frame between full column width and tablet/mobile widths. The widths are caps (`max-w-full`), so the layout stays flexible inside any container. */
function CodePreviewDeviceSelect({ className }: CodePreviewDeviceSelectProps) {
	const { device, setDevice, lang } = useCodePreviewContext();
	const options: {
		value: CodePreviewDevice;
		label: string;
		icon: typeof Monitor;
	}[] = [
		{
			icon: Monitor,
			label: lang.deviceFull,
			value: 'full',
		},
		{
			icon: Tablet,
			label: lang.deviceTablet,
			value: 'tablet',
		},
		{
			icon: Smartphone,
			label: lang.deviceMobile,
			value: 'mobile',
		},
	];

	return (
		<fieldset aria-label={lang.device} className={cn('m-0 flex min-w-0 items-center gap-0.5 border-0 p-0', className)}>
			{options.map(option => (
				<button
					aria-label={option.label}
					aria-pressed={device === option.value}
					className={cn(
						'flex shrink-0 cursor-pointer items-center justify-center rounded-sm p-1 transition-colors duration-150 ease-in-out',
						'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
						device === option.value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-background hover:text-foreground'
					)}
					key={option.value}
					onClick={() => setDevice(option.value)}
					type='button'
				>
					<Icon icon={option.icon} size='xs' />
				</button>
			))}
		</fieldset>
	);
}

export interface CodePreviewPreviewFrameProps extends Omit<React.IframeHTMLAttributes<HTMLIFrameElement>, 'sandbox' | 'srcDoc' | 'src' | 'referrerPolicy' | 'allow'> {}

/** The sandboxed `<iframe>` that runs the code, plus an inline alert for runtime errors. The sandbox, CSP and referrer policy are fixed and can't be overridden through props. */
function CodePreviewPreviewFrame({ className, title, ...props }: CodePreviewPreviewFrameProps) {
	const { runCode, language, lang, device } = useCodePreviewContext();
	const theme = usePreviewTheme();
	const token = React.useId();
	const frameRef = React.useRef<HTMLIFrameElement>(null);
	const [error, setError] = React.useState<string | null>(null);

	const srcDoc = React.useMemo(
		() =>
			theme
				? buildSrcDoc({
						code: runCode,
						language,
						theme,
						token,
					})
				: undefined,
		[runCode, language, theme, token]
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: a new document clears the previous run's error.
	React.useEffect(() => {
		setError(null);
	}, [srcDoc]);

	React.useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			// Only our own frame, and only messages carrying this instance's token — any other window can post to us.
			if (event.source !== frameRef.current?.contentWindow) return;
			const data: unknown = event.data;
			if (
				typeof data !== 'object' ||
				data === null ||
				(
					data as {
						codePreview?: unknown;
					}
				).codePreview !== token
			)
				return;
			const message = (
				data as {
					message?: unknown;
				}
			).message;
			if (typeof message !== 'string') return;
			setError(message.slice(0, MAX_ERROR_LENGTH));
		};
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	}, [token]);

	return (
		<div className='relative flex min-h-0 flex-1 flex-col bg-background'>
			<div className='flex min-h-0 flex-1 justify-center'>
				{srcDoc !== undefined && (
					<iframe
						{...props}
						className={cn('h-full min-h-0 max-w-full border-0', device === 'full' ? 'w-full' : 'border-x border-border', className)}
						ref={frameRef}
						referrerPolicy='no-referrer'
						sandbox={SANDBOX}
						srcDoc={srcDoc}
						style={{
							...props.style,
							width: DEVICE_WIDTHS[device],
						}}
						title={title ?? lang.preview}
					/>
				)}
			</div>
			{error !== null && (
				<div className='border-t border-destructive/30 bg-destructive/10 px-3 py-2 font-secondary text-xs text-destructive' role='alert'>
					{lang.error}: {error}
				</div>
			)}
		</div>
	);
}

export const CodePreview = Object.assign(CodePreviewRoot, {
	Body: CodePreviewBody,
	DeviceSelect: CodePreviewDeviceSelect,
	Editor: CodePreviewEditor,
	EditorContent: CodePreviewEditorContent,
	Handle: CodePreviewHandle,
	Preview: CodePreviewPreview,
	PreviewFrame: CodePreviewPreviewFrame,
	PreviewHeader: CodePreviewPreviewHeader,
	ResetButton: CodePreviewResetButton,
	Root: CodePreviewRoot,
	RunButton: CodePreviewRunButton,
});
