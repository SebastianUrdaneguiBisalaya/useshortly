'use client';

import { type AnyExtension, type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { BubbleMenu as TiptapBubbleMenu } from '@tiptap/react/menus';
import {
	AlertCircle,
	AlignCenter,
	AlignLeft,
	AlignRight,
	Bold,
	Check,
	Heading1,
	Heading2,
	Heading3,
	Highlighter,
	Italic,
	Link as LinkIcon,
	List,
	ListOrdered,
	ListTodo,
	LoaderCircle,
	type LucideIcon,
	Minus,
	Quote,
	Redo2,
	Save,
	Strikethrough,
	Underline as UnderlineIcon,
	Undo2,
} from 'lucide-react';
import * as React from 'react';
import { Button } from '../../actions-controls/button/button';
import { Icon } from '../../foundations/icon/icon';
import { Separator } from '../../foundations/separator/separator';
import { cn } from '../../utils/tailwind/cn';
import type { RichTextEditorValue } from './rich-text-editor.types';
import { baseExtensions } from './rich-text-editor-extensions';

/**
 * Manual/auto-save lifecycle driven by `RichTextEditorRootProps.onSave`:
 * `"idle"` until the first edit (or forever, if `onSave` isn't configured),
 * `"unsaved"` after an edit with no save yet in flight, `"saving"` while
 * `onSave` is pending, `"saved"` once it resolves, `"error"` if it rejects.
 */
export type RichTextEditorSaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

/** Texts rendered by `RichTextEditor`'s subcomponents. Pass `lang` to `RichTextEditor` to override any of them. */
export interface RichTextEditorLang {
	/** Label of the save-status indicator, per status. */
	saveStatus: Record<RichTextEditorSaveStatus, string>;
	/** Label of `RichTextEditor.SaveButton`. */
	save: string;
	/** Prompt message asking for a link URL. */
	linkUrlPrompt: string;
	/** Toolbar and bubble-menu button titles. */
	undo: string;
	redo: string;
	heading1: string;
	heading2: string;
	heading3: string;
	bold: string;
	italic: string;
	underline: string;
	strikethrough: string;
	highlight: string;
	link: string;
	bulletList: string;
	numberedList: string;
	checklist: string;
	alignLeft: string;
	alignCenter: string;
	alignRight: string;
	quote: string;
	divider: string;
}

/** English defaults for `RichTextEditorLang`. */
export const defaultRichTextEditorLang: RichTextEditorLang = {
	alignCenter: 'Align center',
	alignLeft: 'Align left',
	alignRight: 'Align right',
	bold: 'Bold',
	bulletList: 'Bulleted list',
	checklist: 'Checklist',
	divider: 'Divider',
	heading1: 'Heading 1',
	heading2: 'Heading 2',
	heading3: 'Heading 3',
	highlight: 'Highlight',
	italic: 'Italic',
	link: 'Link',
	linkUrlPrompt: 'URL',
	numberedList: 'Numbered list',
	quote: 'Quote',
	redo: 'Redo',
	save: 'Save',
	saveStatus: {
		error: "Couldn't save",
		idle: '',
		saved: 'Saved',
		saving: 'Saving…',
		unsaved: 'Unsaved changes',
	},
	strikethrough: 'Strikethrough',
	underline: 'Underline',
	undo: 'Undo',
};

type RichTextEditorContextValue = {
	readonly editor: Editor | null;
	readonly saveStatus: RichTextEditorSaveStatus;
	readonly triggerSave: () => void;
	readonly lang: RichTextEditorLang;
};

const RichTextEditorContext = React.createContext<RichTextEditorContextValue | null>(null);

function useRichTextEditorLang(): RichTextEditorLang {
	return useRichTextEditorContext().lang;
}

function useRichTextEditorContext(): RichTextEditorContextValue {
	const context = React.useContext(RichTextEditorContext);
	if (!context) {
		throw new Error('RichTextEditor compound components must be used inside <RichTextEditor>.');
	}
	return context;
}

/** Reads the shared Tiptap `Editor` instance. `null` until the editor mounts (it's created asynchronously). Useful for a custom toolbar/menu built outside the pieces this file already provides. */
export function useRichTextEditor(): Editor | null {
	return useRichTextEditorContext().editor;
}

/**
 * Reads the save status driven by `RichTextEditorRootProps.onSave`/`autoSaveDelay`, plus a
 * `save()` function that saves immediately (bypassing `autoSaveDelay`'s debounce, e.g. for a
 * manual "Save now" action or a keyboard shortcut). A no-op when `onSave` isn't configured.
 */
export function useRichTextEditorSaveStatus(): {
	readonly status: RichTextEditorSaveStatus;
	readonly save: () => void;
} {
	const { saveStatus, triggerSave } = useRichTextEditorContext();
	return {
		save: triggerSave,
		status: saveStatus,
	};
}

export interface RichTextEditorRootProps {
	/** Content as Tiptap/ProseMirror JSON (controlled usage). Never pass HTML — JSON is this editor's only source of truth, since block attrs (`queryId`, chart specs, …) can't round-trip through HTML. */
	readonly value?: RichTextEditorValue;
	/** Initial content as JSON (uncontrolled usage). */
	readonly defaultValue?: RichTextEditorValue;
	/** Called with the new document JSON on every edit. */
	readonly onChange?: (value: RichTextEditorValue) => void;
	/** Disables editing; the toolbar/bubble menu/slash menu should be omitted by the consumer when this is `true`. @default false */
	readonly readOnly?: boolean;
	/** Placeholder shown in an empty document. */
	readonly placeholder?: string;
	/**
	 * Extensions appended after the built-in set (`baseExtensions`) — this is
	 * where analytical blocks (`createChartBlockExtension()`, …) and the
	 * slash-command suggestion are registered. The editor's own core never
	 * needs to change to add one.
	 */
	readonly extensions?: readonly AnyExtension[];
	/**
	 * Persists the document's current Tiptap JSON — e.g. a `PATCH` to your
	 * backend, or a `localStorage` write. Enables the save state machine
	 * backing `RichTextEditor.SaveStatus`/`.SaveButton` and
	 * `useRichTextEditorSaveStatus`; omit to leave saving entirely to your own
	 * `onChange` handling. Only one save ever runs at a time: an edit that
	 * lands while a save is already in flight (from you typing, or from an
	 * external `value` update arriving mid-save) is queued and re-saved with
	 * the latest content the moment the current save settles, instead of
	 * either overlapping requests or dropping the newer change.
	 */
	readonly onSave?: (value: RichTextEditorValue) => void | Promise<void>;
	/**
	 * Debounces `onSave` to fire this many milliseconds after the last edit,
	 * for automatic saving. Combine with `RichTextEditor.SaveButton` for "save
	 * automatically, but also let the user force one"; omit `autoSaveDelay`
	 * for manual-only saving (`RichTextEditor.SaveButton`, or
	 * `useRichTextEditorSaveStatus().save()`, alone).
	 */
	readonly autoSaveDelay?: number;
	/**
	 * Texts rendered by the toolbar, bubble menu, save controls and link prompt. Merges over English defaults.
	 * @default defaultRichTextEditorLang
	 */
	readonly lang?: Partial<RichTextEditorLang>;
	readonly className?: string;
	readonly children: React.ReactNode;
}

/**
 * Compound rich text / analytics-report editor, built on Tiptap. The Tiptap
 * `Editor` instance is shared via context with `RichTextEditor.Toolbar`,
 * `RichTextEditor.BubbleMenu` and `RichTextEditor.Content` (and with any
 * custom analytical block's `NodeView`, via `useRichTextEditor`). Analytical
 * blocks aren't JSX children — they're Tiptap node extensions registered
 * through the `extensions` prop — so the JSX composed here is only the
 * chrome around the prose.
 * @example
 * ```tsx
 * <RichTextEditor extensions={[chartBlockExtension, kpiBlockExtension]} onChange={setDoc} value={doc}>
 *   <RichTextEditor.Toolbar />
 *   <RichTextEditor.BubbleMenu />
 *   <RichTextEditor.Content />
 * </RichTextEditor>
 * ```
 */
function RichTextEditorRoot({
	lang,
	value: controlledValue,
	defaultValue,
	onChange,
	onSave,
	autoSaveDelay,
	readOnly = false,
	placeholder,
	extensions = [],
	className,
	children,
}: RichTextEditorRootProps) {
	const isControlled = controlledValue !== undefined;

	// Kept as refs (not read directly by the long-lived `onUpdate` closure below) so a new
	// `onChange`/`onSave`/`autoSaveDelay` identity on a later render — an inline arrow function is
	// the common case — doesn't get missed: `useEditor`'s own options are only captured once, at
	// creation.
	const latestOptionsRef = React.useRef({
		autoSaveDelay,
		onChange,
		onSave,
	});
	latestOptionsRef.current = {
		autoSaveDelay,
		onChange,
		onSave,
	};

	const [saveStatus, setSaveStatus] = React.useState<RichTextEditorSaveStatus>('idle');
	// Mutex: only one `onSave` call is ever in flight. An edit that lands while one is already
	// running (ours, mid-typing, or an external `value` update arriving mid-save) just flags
	// `dirtyDuringSaveRef` instead of overlapping or being dropped; the in-flight save's own
	// `.then` re-runs itself once more when it sees that flag, converging on "the last save
	// reflects the latest content" without any queueing/versioning machinery.
	const savingRef = React.useRef(false);
	const dirtyDuringSaveRef = React.useRef(false);
	const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
	// The initial content-load triggers its own settling transaction (the `blockId` plugin's
	// `appendTransaction` assigning IDs to nodes that don't have one yet), which fires `onUpdate`
	// just like a real edit would. Left alone, that would mark a freshly loaded, untouched
	// document "Unsaved changes" before the user has done anything.
	const hasSkippedInitialUpdateRef = React.useRef(false);
	// Doesn't close over the `editor` variable below (it takes the live instance as an argument
	// instead), so it stays safe to call from `onUpdate`'s closure, which — since `useEditor`
	// only captures its options once, at creation — would otherwise permanently reference
	// whatever `editor` happened to be on that very first render (possibly still `null`).
	const runSaveCycle = React.useCallback((activeEditor: Editor) => {
		if (!latestOptionsRef.current.onSave) return;
		if (savingRef.current) {
			dirtyDuringSaveRef.current = true;
			return;
		}

		const persist = () => {
			savingRef.current = true;
			dirtyDuringSaveRef.current = false;
			setSaveStatus('saving');

			const snapshot = activeEditor.getJSON();
			Promise.resolve(latestOptionsRef.current.onSave?.(snapshot)).then(
				() => {
					// A change landed while this save was in flight (ours, or an external `value` update):
					// re-run immediately with the now-current content instead of reporting "saved" for a
					// snapshot that's already out of date.
					if (dirtyDuringSaveRef.current) {
						persist();
						return;
					}
					savingRef.current = false;
					setSaveStatus('saved');
				},
				() => {
					savingRef.current = false;
					setSaveStatus('error');
				}
			);
		};

		persist();
	}, []);

	const editor = useEditor({
		content: controlledValue ?? defaultValue ?? '',
		editable: !readOnly,
		editorProps: {
			attributes: {
				class: cn(
					// `pl-12` (not `px-4`) reserves a gutter for each block's hover
					// `BlockMenu` (drag/move/duplicate/delete), which sits at `-left-8`
					// of the block itself — without this gutter that menu pokes past
					// this container's own left edge and gets clipped by an ancestor's
					// `overflow-auto`/`overflow-hidden` (`RichTextEditor.Content`, a
					// `Resizable.Panel`, …).
					'min-h-32 py-3 pr-4 pl-12 font-primary text-sm text-foreground outline-none',
					'[&_p]:mb-2 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-3 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold',
					'[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5',
					'[&_ul[data-type=taskList]]:mb-2 [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]_li]:flex [&_ul[data-type=taskList]_li]:items-start [&_ul[data-type=taskList]_li]:gap-2',
					'[&_blockquote]:my-2 [&_blockquote]:border-border [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
					'[&_hr]:my-3 [&_hr]:border-border',
					'[&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2',
					'[&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-secondary [&_code]:text-[0.8125rem]',
					'[&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-secondary [&_pre]:text-[0.8125rem] [&_pre_code]:bg-transparent [&_pre_code]:p-0',
					'[&_mark]:rounded-sm [&_mark]:bg-warning/30 [&_mark]:px-0.5 [&_mark]:text-inherit',
					'[&_p.is-editor-empty:first-child::before]:pointer-events-none [&_p.is-editor-empty:first-child::before]:float-left [&_p.is-editor-empty:first-child::before]:h-0 [&_p.is-editor-empty:first-child::before]:text-muted-foreground [&_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]'
				),
			},
		},
		extensions: [
			...baseExtensions({
				// Every registered extension's own name — harmless no-op for
				// non-block extensions (e.g. the slash menu), and exactly the
				// custom analytical block node names for the ones that are blocks,
				// so `createChartBlockExtension()` etc. never has to be listed
				// twice (once in `extensions`, once for the ID plugin).
				blockTypes: extensions.map(extension => extension.name),
				placeholder,
			}),
			...extensions,
		],
		immediatelyRender: false,
		onUpdate: ({ editor: currentEditor }) => {
			latestOptionsRef.current.onChange?.(currentEditor.getJSON());

			if (!hasSkippedInitialUpdateRef.current) {
				hasSkippedInitialUpdateRef.current = true;
				return;
			}

			if (!latestOptionsRef.current.onSave) return;
			if (savingRef.current) {
				dirtyDuringSaveRef.current = true;
			} else {
				setSaveStatus('unsaved');
			}

			const delay = latestOptionsRef.current.autoSaveDelay;
			if (delay) {
				if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
				autoSaveTimerRef.current = setTimeout(() => {
					autoSaveTimerRef.current = null;
					runSaveCycle(currentEditor);
				}, delay);
			}
		},
		// `@tiptap/react` defaults this to `false` (a v3 perf opt-out): without it, nothing that reads
		// `editor.can()`/`editor.isActive()` directly during render — the toolbar's undo/redo/active
		// states chief among them — ever updates after the initial mount, since transactions wouldn't
		// otherwise force this tree to re-render.
		shouldRerenderOnTransaction: true,
	});

	React.useEffect(() => {
		if (!editor || !isControlled || !controlledValue) return;
		const next = JSON.stringify(controlledValue);
		const current = JSON.stringify(editor.getJSON());
		if (next === current) return;
		editor.commands.setContent(controlledValue, {
			emitUpdate: false,
		});
	}, [controlledValue, editor, isControlled]);

	React.useEffect(() => {
		editor?.setEditable(!readOnly);
	}, [editor, readOnly]);

	React.useEffect(() => {
		return () => {
			if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
		};
	}, []);

	const triggerSave = React.useCallback(() => {
		if (!editor) return;
		// A manual save supersedes whatever autosave was about to do.
		if (autoSaveTimerRef.current) {
			clearTimeout(autoSaveTimerRef.current);
			autoSaveTimerRef.current = null;
		}
		runSaveCycle(editor);
	}, [editor, runSaveCycle]);

	const resolvedLang = React.useMemo<RichTextEditorLang>(
		() => ({
			...defaultRichTextEditorLang,
			...lang,
		}),
		[lang]
	);

	const contextValue = React.useMemo<RichTextEditorContextValue>(
		() => ({
			editor: editor ?? null,
			lang: resolvedLang,
			saveStatus,
			triggerSave,
		}),
		[editor, resolvedLang, saveStatus, triggerSave]
	);

	return (
		<RichTextEditorContext.Provider value={contextValue}>
			<div className={cn('flex flex-col', className)}>{children}</div>
		</RichTextEditorContext.Provider>
	);
}

interface ToolbarButtonProps {
	readonly onClick: () => void;
	readonly active?: boolean;
	readonly disabled?: boolean;
	readonly title: string;
	readonly icon: LucideIcon;
}

/** One formatting toggle, shared by `RichTextEditor.Toolbar` and `RichTextEditor.BubbleMenu`. */
function ToolbarButton({ onClick, active, disabled, title, icon }: ToolbarButtonProps) {
	return (
		<button
			className={cn(
				'flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-sm transition-colors duration-150 ease-in-out disabled:pointer-events-none disabled:opacity-40',
				'focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!',
				active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
			)}
			disabled={disabled}
			onClick={onClick}
			title={title}
			type='button'
		>
			<Icon icon={icon} size='sm' />
		</button>
	);
}

export interface RichTextEditorToolbarProps {
	readonly className?: string;
}

/** Fixed formatting toolbar (undo/redo, headings, marks, lists, alignment, quote, divider, link). */
function RichTextEditorToolbar({ className }: RichTextEditorToolbarProps) {
	const editor = useRichTextEditor();
	const lang = useRichTextEditorLang();
	// Reading `editor.can()`/`.isActive()` directly during render would only ever reflect the
	// state from whenever this component happened to last render: `RichTextEditor.Toolbar` is
	// passed in as `children` by the consumer, so `RichTextEditorRoot` re-rendering on a
	// transaction doesn't itself force this subtree to re-render too. `useEditorState` subscribes
	// this component directly to transactions instead.
	const toolbarState = useEditorState({
		editor,
		selector: ({ editor: current }) =>
			current && {
				alignCenter: current.isActive({
					textAlign: 'center',
				}),
				alignLeft: current.isActive({
					textAlign: 'left',
				}),
				alignRight: current.isActive({
					textAlign: 'right',
				}),
				canRedo: current.can().redo(),
				canUndo: current.can().undo(),
				isBlockquote: current.isActive('blockquote'),
				isBold: current.isActive('bold'),
				isBulletList: current.isActive('bulletList'),
				isHeading1: current.isActive('heading', {
					level: 1,
				}),
				isHeading2: current.isActive('heading', {
					level: 2,
				}),
				isHeading3: current.isActive('heading', {
					level: 3,
				}),
				isHighlight: current.isActive('highlight'),
				isItalic: current.isActive('italic'),
				isLink: current.isActive('link'),
				isOrderedList: current.isActive('orderedList'),
				isStrike: current.isActive('strike'),
				isTaskList: current.isActive('taskList'),
				isUnderline: current.isActive('underline'),
			},
	});

	if (!editor || !toolbarState) return null;

	const setLink = () => {
		const previousUrl = editor.getAttributes('link').href as string | undefined;
		const url = window.prompt(lang.linkUrlPrompt, previousUrl ?? '');
		if (url === null) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		editor
			.chain()
			.focus()
			.extendMarkRange('link')
			.setLink({
				href: url,
			})
			.run();
	};

	return (
		<div className={cn('flex flex-wrap items-center gap-0.5 rounded-t-md border border-border bg-muted/40 px-2 py-1.5', className)}>
			<ToolbarButton disabled={!toolbarState.canUndo} icon={Undo2} onClick={() => editor.chain().focus().undo().run()} title={lang.undo} />
			<ToolbarButton disabled={!toolbarState.canRedo} icon={Redo2} onClick={() => editor.chain().focus().redo().run()} title={lang.redo} />
			<Separator className='mx-1 h-4' orientation='vertical' />
			<ToolbarButton
				active={toolbarState.isHeading1}
				icon={Heading1}
				onClick={() =>
					editor
						.chain()
						.focus()
						.toggleHeading({
							level: 1,
						})
						.run()
				}
				title={lang.heading1}
			/>
			<ToolbarButton
				active={toolbarState.isHeading2}
				icon={Heading2}
				onClick={() =>
					editor
						.chain()
						.focus()
						.toggleHeading({
							level: 2,
						})
						.run()
				}
				title={lang.heading2}
			/>
			<ToolbarButton
				active={toolbarState.isHeading3}
				icon={Heading3}
				onClick={() =>
					editor
						.chain()
						.focus()
						.toggleHeading({
							level: 3,
						})
						.run()
				}
				title={lang.heading3}
			/>
			<Separator className='mx-1 h-4' orientation='vertical' />
			<ToolbarButton active={toolbarState.isBold} icon={Bold} onClick={() => editor.chain().focus().toggleBold().run()} title={lang.bold} />
			<ToolbarButton active={toolbarState.isItalic} icon={Italic} onClick={() => editor.chain().focus().toggleItalic().run()} title={lang.italic} />
			<ToolbarButton active={toolbarState.isUnderline} icon={UnderlineIcon} onClick={() => editor.chain().focus().toggleUnderline().run()} title={lang.underline} />
			<ToolbarButton active={toolbarState.isStrike} icon={Strikethrough} onClick={() => editor.chain().focus().toggleStrike().run()} title={lang.strikethrough} />
			<ToolbarButton active={toolbarState.isHighlight} icon={Highlighter} onClick={() => editor.chain().focus().toggleHighlight().run()} title={lang.highlight} />
			<ToolbarButton active={toolbarState.isLink} icon={LinkIcon} onClick={setLink} title={lang.link} />
			<Separator className='mx-1 h-4' orientation='vertical' />
			<ToolbarButton active={toolbarState.isBulletList} icon={List} onClick={() => editor.chain().focus().toggleBulletList().run()} title={lang.bulletList} />
			<ToolbarButton active={toolbarState.isOrderedList} icon={ListOrdered} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={lang.numberedList} />
			<ToolbarButton active={toolbarState.isTaskList} icon={ListTodo} onClick={() => editor.chain().focus().toggleTaskList().run()} title={lang.checklist} />
			<Separator className='mx-1 h-4' orientation='vertical' />
			<ToolbarButton active={toolbarState.alignLeft} icon={AlignLeft} onClick={() => editor.chain().focus().setTextAlign('left').run()} title={lang.alignLeft} />
			<ToolbarButton active={toolbarState.alignCenter} icon={AlignCenter} onClick={() => editor.chain().focus().setTextAlign('center').run()} title={lang.alignCenter} />
			<ToolbarButton active={toolbarState.alignRight} icon={AlignRight} onClick={() => editor.chain().focus().setTextAlign('right').run()} title={lang.alignRight} />
			<Separator className='mx-1 h-4' orientation='vertical' />
			<ToolbarButton active={toolbarState.isBlockquote} icon={Quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} title={lang.quote} />
			<ToolbarButton icon={Minus} onClick={() => editor.chain().focus().setHorizontalRule().run()} title={lang.divider} />
		</div>
	);
}

export interface RichTextEditorBubbleMenuProps {
	readonly className?: string;
}

/** Floating formatting toolbar shown above the current text selection. */
function RichTextEditorBubbleMenu({ className }: RichTextEditorBubbleMenuProps) {
	const editor = useRichTextEditor();
	const lang = useRichTextEditorLang();
	const bubbleState = useEditorState({
		editor,
		selector: ({ editor: current }) =>
			current && {
				isBold: current.isActive('bold'),
				isHighlight: current.isActive('highlight'),
				isItalic: current.isActive('italic'),
				isStrike: current.isActive('strike'),
				isUnderline: current.isActive('underline'),
			},
	});

	if (!editor || !bubbleState) return null;

	return (
		<TiptapBubbleMenu
			className={cn('flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-md', className)}
			editor={editor}
			options={{
				placement: 'top',
			}}
			shouldShow={({ state }) => !state.selection.empty}
		>
			<ToolbarButton active={bubbleState.isBold} icon={Bold} onClick={() => editor.chain().focus().toggleBold().run()} title={lang.bold} />
			<ToolbarButton active={bubbleState.isItalic} icon={Italic} onClick={() => editor.chain().focus().toggleItalic().run()} title={lang.italic} />
			<ToolbarButton active={bubbleState.isUnderline} icon={UnderlineIcon} onClick={() => editor.chain().focus().toggleUnderline().run()} title={lang.underline} />
			<ToolbarButton active={bubbleState.isStrike} icon={Strikethrough} onClick={() => editor.chain().focus().toggleStrike().run()} title={lang.strikethrough} />
			<ToolbarButton active={bubbleState.isHighlight} icon={Highlighter} onClick={() => editor.chain().focus().toggleHighlight().run()} title={lang.highlight} />
		</TiptapBubbleMenu>
	);
}

export interface RichTextEditorContentProps {
	readonly className?: string;
}

/** Editable prose area. The bottom border/radius closes off whatever chrome (`Toolbar`) is rendered above it. */
function RichTextEditorContentArea({ className }: RichTextEditorContentProps) {
	const editor = useRichTextEditor();

	return (
		<div className={cn('overflow-hidden rounded-b-md border border-t-0 border-border', className)}>
			<EditorContent editor={editor} />
		</div>
	);
}

export interface RichTextEditorSaveStatusProps extends React.HTMLAttributes<HTMLSpanElement> {}

/**
 * "Saving…" / "Saved" / "Unsaved changes" / "Couldn't save" indicator, driven
 * by `RichTextEditorRootProps.onSave`/`autoSaveDelay`. Renders nothing before
 * the first edit, and nothing at all if `onSave` isn't configured.
 */
function RichTextEditorSaveStatus({ className, ...props }: RichTextEditorSaveStatusProps) {
	const { saveStatus, lang } = useRichTextEditorContext();

	if (saveStatus === 'idle') return null;

	return (
		<span aria-live='polite' className={cn('flex items-center gap-1.5 font-primary text-xs', saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground', className)} {...props}>
			{saveStatus === 'saving' && <Icon className='animate-spin motion-reduce:animate-none' icon={LoaderCircle} size='xs' />}
			{saveStatus === 'saved' && <Icon icon={Check} size='xs' />}
			{saveStatus === 'error' && <Icon icon={AlertCircle} size='xs' />}
			{saveStatus === 'unsaved' && <span aria-hidden='true' className='size-1.5 shrink-0 rounded-full bg-current' />}
			{lang.saveStatus[saveStatus]}
		</span>
	);
}

export interface RichTextEditorSaveButtonProps extends Omit<React.ComponentProps<typeof Button>, 'onClick' | 'loading' | 'children'> {}

/**
 * Manual "Save" action wired to the same save state machine
 * `RichTextEditor.SaveStatus` reads. Works standalone for manual-only
 * saving, or alongside `autoSaveDelay` as a "save now" override on top of
 * autosave. Disabled while there's nothing new to persist (`"idle"`/
 * `"saved"`) or while a save is already running.
 */
function RichTextEditorSaveButton({ disabled, variant = 'secondary', ...props }: RichTextEditorSaveButtonProps) {
	const { saveStatus, triggerSave, lang } = useRichTextEditorContext();

	return (
		<Button disabled={disabled || saveStatus === 'idle' || saveStatus === 'saved'} loading={saveStatus === 'saving'} onClick={triggerSave} variant={variant} {...props}>
			<Button.Icon icon={Save} />
			<Button.Text>{lang.save}</Button.Text>
		</Button>
	);
}

/**
 * Compound rich text / analytics-report editor (see `RichTextEditorRoot`).
 */
export const RichTextEditor = Object.assign(RichTextEditorRoot, {
	BubbleMenu: RichTextEditorBubbleMenu,
	Content: RichTextEditorContentArea,
	SaveButton: RichTextEditorSaveButton,
	SaveStatus: RichTextEditorSaveStatus,
	Toolbar: RichTextEditorToolbar,
});
