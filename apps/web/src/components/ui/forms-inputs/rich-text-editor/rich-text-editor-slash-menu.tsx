'use client';

import type { Editor, Range } from '@tiptap/react';
import { Extension, ReactRenderer } from '@tiptap/react';
import Suggestion, { type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

/** One row in the `/`-menu — text blocks, list types, and analytical blocks are all just entries in the same list. */
export interface SlashCommandItem {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon: LucideIcon;
	/** Extra terms matched against the typed query besides `label`. */
	readonly keywords?: readonly string[];
	/** Runs the insertion. Receives the already-open `editor` and the `range` the `/query` occupies, which the implementation should delete before inserting (see the default text-block items in `rich-text-editor-block-menu.tsx`-adjacent call sites). */
	readonly onSelect: (context: { editor: Editor; range: Range }) => void;
}

interface SlashMenuListProps {
	readonly items: readonly SlashCommandItem[];
	readonly onSelect: (item: SlashCommandItem) => void;
	readonly lang: SlashMenuLang;
}

interface SlashMenuListHandle {
	onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const SlashMenuList = React.forwardRef<SlashMenuListHandle, SlashMenuListProps>(({ items, onSelect, lang }, ref) => {
	const [activeIndex, setActiveIndex] = React.useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: resets the highlighted row whenever the item list changes, not on every render
	React.useEffect(() => {
		setActiveIndex(0);
	}, [items]);

	React.useImperativeHandle(
		ref,
		() => ({
			onKeyDown: ({ event }) => {
				if (event.key === 'ArrowDown') {
					setActiveIndex(index => (index + 1) % Math.max(items.length, 1));
					return true;
				}
				if (event.key === 'ArrowUp') {
					setActiveIndex(index => (index - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1));
					return true;
				}
				if (event.key === 'Enter') {
					const item = items[activeIndex];
					if (item) onSelect(item);
					return true;
				}
				return false;
			},
		}),
		[items, activeIndex, onSelect]
	);

	if (items.length === 0) {
		return <div className='w-64 rounded-lg border border-border bg-background p-3 font-primary text-muted-foreground text-sm shadow-md'>{lang.noMatchingCommands}</div>;
	}

	return (
		<div aria-label={lang.slashCommands} className='flex w-64 flex-col gap-0.5 rounded-lg border border-border bg-background p-1.5 shadow-md' role='listbox'>
			{items.map((item, index) => (
				<button
					aria-selected={index === activeIndex}
					className={cn(
						'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left font-primary text-sm transition-colors duration-100 ease-in-out',
						index === activeIndex ? 'bg-muted text-foreground' : 'text-foreground hover:bg-muted'
					)}
					key={item.id}
					onClick={() => onSelect(item)}
					onMouseEnter={() => setActiveIndex(index)}
					role='option'
					type='button'
				>
					<Icon className='shrink-0 text-muted-foreground' icon={item.icon} size='sm' />
					<span className='flex min-w-0 flex-col'>
						<span className='truncate'>{item.label}</span>
						{item.description && <span className='truncate text-muted-foreground text-xs'>{item.description}</span>}
					</span>
				</button>
			))}
		</div>
	);
});
SlashMenuList.displayName = 'SlashMenuList';

function filterSlashCommandItems(items: readonly SlashCommandItem[], query: string): SlashCommandItem[] {
	if (!query) return [...items];
	const needle = query.toLowerCase();
	return items.filter(item => item.label.toLowerCase().includes(needle) || item.keywords?.some(keyword => keyword.toLowerCase().includes(needle)));
}

/** Texts rendered by the `/` menu. Pass `lang` to override any of them. */
export interface SlashMenuLang {
	/** Accessible name of the command list. */
	slashCommands: string;
	/** Shown when no command matches the typed query. */
	noMatchingCommands: string;
}

/** English defaults for `SlashMenuLang`. */
export const defaultSlashMenuLang: SlashMenuLang = {
	noMatchingCommands: 'No matching commands.',
	slashCommands: 'Slash commands',
};

export interface CreateSlashMenuExtensionOptions {
	/**
	 * Texts rendered by the menu. Merges over English defaults.
	 * @default defaultSlashMenuLang
	 */
	readonly lang?: Partial<SlashMenuLang>;
	/**
	 * The full command list. Analytical block extensions contribute their own
	 * entries here (e.g. `createChartBlockExtension` exports a
	 * `chartSlashCommand` item to spread into this array) — the editor core
	 * never needs to know a "chart" command exists.
	 */
	readonly items: readonly SlashCommandItem[];
}

/**
 * Tiptap extension powering the `/`-menu, built on `@tiptap/suggestion`'s
 * managed positioning (`props.mount`, Floating UI under the hood — no manual
 * positioning code needed). Register it via `RichTextEditorRootProps.extensions`.
 */
export function createSlashMenuExtension({ items, lang }: CreateSlashMenuExtensionOptions) {
	const resolvedLang = { ...defaultSlashMenuLang, ...lang };
	return Extension.create({
		addProseMirrorPlugins() {
			return [
				Suggestion<SlashCommandItem, SlashCommandItem>({
					char: '/',
					command: ({ editor, range, props }) => {
						editor.chain().focus().deleteRange(range).run();
						props.onSelect({
							editor,
							range,
						});
					},
					editor: this.editor,
					items: ({ query }) => filterSlashCommandItems(items, query),
					render: () => {
						let component: ReactRenderer<SlashMenuListHandle, SlashMenuListProps> | null = null;
						let unmount: (() => void) | null = null;

						return {
							onExit: () => {
								unmount?.();
								component?.destroy();
								component = null;
								unmount = null;
							},
							onKeyDown: (props: SuggestionKeyDownProps) => {
								if (props.event.key === 'Escape') {
									unmount?.();
									return true;
								}
								return component?.ref?.onKeyDown(props) ?? false;
							},
							onStart: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
								component = new ReactRenderer(SlashMenuList, {
									editor: props.editor,
									props: {
										lang: resolvedLang,
										items: props.items,
										onSelect: (item: SlashCommandItem) => props.command(item),
									},
								});
								unmount = props.mount(component.element);
							},
							onUpdate: (props: SuggestionProps<SlashCommandItem, SlashCommandItem>) => {
								component?.updateProps({
									lang: resolvedLang,
									items: props.items,
									onSelect: (item: SlashCommandItem) => props.command(item),
								});
							},
						};
					},
				}),
			];
		},
		name: 'slashMenu',
	});
}
