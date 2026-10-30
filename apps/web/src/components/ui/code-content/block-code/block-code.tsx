'use client';

import type { Element, RootContent, Root as RootReact } from 'hast';
import { Check, Copy } from 'lucide-react';
import * as React from 'react';
import bash from 'refractor/bash';
import { refractor } from 'refractor/core';
import css from 'refractor/css';
import javascript from 'refractor/javascript';
import json from 'refractor/json';
import jsx from 'refractor/jsx';
import markup from 'refractor/markup';
import python from 'refractor/python';
import sql from 'refractor/sql';
import tsx from 'refractor/tsx';
import typescript from 'refractor/typescript';
import { Icon } from '../../foundations/icon/icon';
import { cn } from '../../utils/tailwind/cn';

for (const syntax of [bash, css, javascript, json, jsx, markup, python, sql, tsx, typescript]) {
	if (!refractor.registered(syntax.displayName)) refractor.register(syntax);
}

/** Languages registered for `BlockCode.Content`'s syntax highlighting out of the box. */
export const blockCodeLanguages = refractor.listLanguages();

/** Prism token type → color token. Deliberately restrained (3 accent hues: `json-key`, `json-value` and `code-tag` for markup tags/types), not a full rainbow theme. */
const tokenToneClassName: Record<string, string> = {
	atrule: 'text-json-key',
	'attr-name': 'text-foreground font-medium',
	'attr-value': 'text-json-value',
	boolean: 'text-json-key',
	builtin: 'text-json-key',
	cdata: 'text-muted-foreground italic',
	char: 'text-json-value',
	'class-name': 'text-code-tag',
	comment: 'text-muted-foreground italic',
	constant: 'text-json-key',
	deleted: 'text-destructive',
	doctype: 'text-muted-foreground italic',
	function: 'text-foreground font-medium',
	important: 'text-json-key font-medium',
	inserted: 'text-success',
	keyword: 'text-json-key',
	'known-class-name': 'text-code-tag',
	'literal-property': 'text-foreground font-medium',
	'maybe-class-name': 'text-code-tag',
	number: 'text-json-key',
	operator: 'text-muted-foreground',
	prolog: 'text-muted-foreground italic',
	property: 'text-foreground font-medium',
	punctuation: 'text-muted-foreground',
	regex: 'text-json-value',
	selector: 'text-foreground font-medium',
	string: 'text-json-value',
	symbol: 'text-json-key',
	tag: 'text-code-tag',
	'template-string': 'text-json-value',
	variable: 'text-foreground',
};

function toneClassNameFor(node: Element): string | undefined {
	const classNames = node.properties?.className;
	const list = Array.isArray(classNames) ? classNames.map(String) : [];
	const token = list.find(name => name !== 'token');
	return token ? tokenToneClassName[token] : undefined;
}

function renderHastNode(node: RootContent, key: React.Key): React.ReactNode {
	if (node.type === 'text') return node.value;
	if (node.type !== 'element') return null;

	return (
		<span className={toneClassNameFor(node)} key={key}>
			{node.children.map((child, index) => renderHastNode(child, index))}
		</span>
	);
}

/** Highlights `code` as `language` into React elements — walks Prism's token tree (via `refractor`) directly rather than injecting HTML. */
function highlight(code: string, language: string): React.ReactNode {
	if (!refractor.registered(language)) return code;

	let tree: RootReact;
	try {
		tree = refractor.highlight(code, language);
	} catch {
		return code;
	}
	return tree.children.map((node, index) => renderHastNode(node, index));
}

/**
 * Highlights `code` as `language` and returns one React node per line, so a
 * consumer can lay the lines out itself (line numbers, diffs). The whole text is
 * tokenized at once, so tokens spanning several lines (block comments, template
 * strings) stay correctly highlighted on every line. Falls back to plain text
 * for an unregistered language.
 */
export function highlightCodeLines(code: string, language: string): React.ReactNode[] {
	const plain = code.split('\n');
	if (!refractor.registered(language)) return plain;

	let tree: RootReact;
	try {
		tree = refractor.highlight(code, language);
	} catch {
		return plain;
	}

	let key = 0;
	// Splits a node list into lines: a text node with "\n" ends the current
	// line, and an element crossing a newline is re-opened on the next line.
	const toLines = (nodes: RootContent[]): React.ReactNode[][] => {
		const lines: React.ReactNode[][] = [[]];
		for (const node of nodes) {
			if (node.type === 'text') {
				node.value.split('\n').forEach((part, index) => {
					if (index > 0) lines.push([]);
					if (part) lines[lines.length - 1].push(part);
				});
			} else if (node.type === 'element') {
				toLines(node.children).forEach((segments, index) => {
					if (index > 0) lines.push([]);
					if (segments.length > 0)
						lines[lines.length - 1].push(
							<span className={toneClassNameFor(node)} key={key++}>
								{segments}
							</span>
						);
				});
			}
		}
		return lines;
	};

	return toLines(tree.children).map((segments, index) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional.
		<React.Fragment key={index}>{segments}</React.Fragment>
	));
}

const BlockCodeContext = React.createContext<{
	code: string;
	language: string;
} | null>(null);

function useBlockCodeContext() {
	const context = React.useContext(BlockCodeContext);
	if (!context) {
		throw new Error('BlockCode subcomponents must be used within <BlockCode.Root>.');
	}
	return context;
}

export interface BlockCodeRootProps extends React.HTMLAttributes<HTMLDivElement> {
	/** Raw code text, shared with `BlockCode.Content` and `BlockCode.CopyButton` via context. */
	code: string;
	/**
	 * Prism language name (e.g. `"tsx"`, `"json"`, `"bash"`). Unregistered
	 * languages render as plain text — see `blockCodeLanguages` for the
	 * built-in set.
	 * @default "text"
	 */
	language?: string;
}

/**
 * Compound code block with per-language syntax highlighting.
 * @example
 * ```tsx
 * <BlockCode.Root code={snippet} language="tsx">
 *   <BlockCode.Header>
 *     <span>tsx</span>
 *     <BlockCode.CopyButton />
 *   </BlockCode.Header>
 *   <BlockCode.Content />
 * </BlockCode.Root>
 * ```
 */
function Root({ code, language = 'text', className, children, ...props }: BlockCodeRootProps) {
	const contextValue = React.useMemo(
		() => ({
			code,
			language,
		}),
		[code, language]
	);

	return (
		<BlockCodeContext.Provider value={contextValue}>
			<div className={cn('overflow-hidden rounded-md border border-border bg-muted', className)} {...props}>
				{children}
			</div>
		</BlockCodeContext.Provider>
	);
}

export interface BlockCodeHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Toolbar row above the code — typically a language label and `BlockCode.CopyButton`. */
function Header({ className, ...props }: BlockCodeHeaderProps) {
	return <div className={cn('flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 font-primary text-xs text-muted-foreground', className)} {...props} />;
}

/** Texts rendered by `BlockCode.CopyButton`. Pass `lang` to override any of them. */
export interface BlockCodeCopyButtonLang {
	/** Accessible label before copying. */
	copy: string;
	/** Accessible label right after copying. */
	copied: string;
}

/** English defaults for `BlockCodeCopyButtonLang`. */
export const defaultBlockCodeCopyButtonLang: BlockCodeCopyButtonLang = {
	copied: 'Copied',
	copy: 'Copy code',
};

export interface BlockCodeCopyButtonProps {
	/**
	 * Texts rendered by this component. Merges over English defaults.
	 * @default defaultBlockCodeCopyButtonLang
	 */
	lang?: Partial<BlockCodeCopyButtonLang>;
	className?: string;
}

/** Copies `BlockCode.Root`'s `code` to the clipboard, showing a brief confirmation. */
function CopyButton({ lang, className }: BlockCodeCopyButtonProps) {
	const resolvedLang = {
		...defaultBlockCodeCopyButtonLang,
		...lang,
	};
	const { code } = useBlockCodeContext();
	const [copied, setCopied] = React.useState(false);

	const handleClick = async () => {
		await navigator.clipboard.writeText(code);
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

export interface BlockCodeContentProps extends React.HTMLAttributes<HTMLPreElement> {}

/** Renders `BlockCode.Root`'s `code`, syntax-highlighted for its `language`, as preformatted monospace text. */
function Content({ className, ...props }: BlockCodeContentProps) {
	const { code, language } = useBlockCodeContext();
	return (
		<pre className={cn('overflow-x-auto p-3 font-secondary text-sm text-foreground', className)} {...props}>
			<code>{highlight(code, language)}</code>
		</pre>
	);
}

export const BlockCode = {
	Content,
	CopyButton,
	Header,
	Root,
};
