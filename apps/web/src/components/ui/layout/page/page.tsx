'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../../utils/tailwind/cn';
import { Layout, type LayoutContainerVariantProps } from '../layout/layout';

export interface PageRootProps extends React.HTMLAttributes<HTMLDivElement> {
	/**
	 * Max-width the page content is capped at, same scale as `Layout.Container`.
	 * @default "xl"
	 */
	size?: LayoutContainerVariantProps;
}

/**
 * Root of the compound page shell — the header + body (+ optional footer)
 * rhythm most app/SaaS pages share, so every screen gets the same padding,
 * gaps, and max-width instead of reinventing them per page. Built on
 * `Layout.Container`/`Layout.Stack`, not a parallel spacing system.
 * @example
 * ```tsx
 * <Page.Root>
 *   <Page.Header>
 *     <div>
 *       <Page.Title>Billing</Page.Title>
 *       <Page.Description>Manage your plan and payment methods.</Page.Description>
 *     </div>
 *     <Page.Actions>
 *       <Button><Button.Text>Upgrade plan</Button.Text></Button>
 *     </Page.Actions>
 *   </Page.Header>
 *   <Page.Body>
 *     <Page.Section>
 *       <Page.SectionHeader>
 *         <Page.Title>Payment method</Page.Title>
 *       </Page.SectionHeader>
 *       ...
 *     </Page.Section>
 *   </Page.Body>
 * </Page.Root>
 * ```
 */
function PageRoot({ size = 'xl', className, children, ...props }: PageRootProps) {
	return (
		<Layout.Container className={cn('flex flex-col gap-8 py-8 sm:py-10', className)} size={size} {...props}>
			{children}
		</Layout.Container>
	);
}

export interface PageHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Page-level header row — title/description on the left, `Page.Actions` on the right, collapsing to a stack on narrow viewports. */
function PageHeader({ className, children, ...props }: PageHeaderProps) {
	return (
		<div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)} {...props}>
			{children}
		</div>
	);
}

const titleVariants = cva('font-primary font-semibold tracking-tight text-foreground', {
	defaultVariants: {
		level: 'page',
	},
	variants: {
		/** `"page"` for `Page.Header`'s title; `"section"` for `Page.SectionHeader`'s, one size down. */
		level: {
			page: 'text-2xl',
			section: 'text-lg',
		},
	},
});

export type PageTitleLevel = VariantProps<typeof titleVariants>['level'];

export interface PageTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
	/**
	 * Visual size — use `"section"` inside a `Page.SectionHeader` so it reads
	 * a step below the page's own `Page.Header` title.
	 * @default "page"
	 */
	level?: PageTitleLevel;
}

/** Heading text, for `Page.Header` or `Page.SectionHeader`. Always renders an `<h1>`/`<h2>` semantically — pass `level` only to change its visual size. */
function PageTitle({ level = 'page', className, ...props }: PageTitleProps) {
	const Tag = level === 'page' ? 'h1' : 'h2';

	return (
		<Tag
			className={cn(
				titleVariants({
					level,
				}),
				className
			)}
			{...props}
		/>
	);
}

export interface PageDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Supporting text under `Page.Title`, for `Page.Header` or `Page.SectionHeader`. */
function PageDescription({ className, ...props }: PageDescriptionProps) {
	return <p className={cn('mt-1 font-primary text-sm text-muted-foreground', className)} {...props} />;
}

export interface PageActionsProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Row of actions (typically `Button`s) for `Page.Header` or `Page.SectionHeader`. */
function PageActions({ className, children, ...props }: PageActionsProps) {
	return (
		<div className={cn('flex shrink-0 flex-wrap items-center gap-2', className)} {...props}>
			{children}
		</div>
	);
}

export interface PageBodyProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Main content area — a vertical stack of `Page.Section`s (or any content) with consistent chapter spacing. */
function PageBody({ className, children, ...props }: PageBodyProps) {
	return (
		<div className={cn('flex flex-col gap-10', className)} {...props}>
			{children}
		</div>
	);
}

export interface PageSectionProps extends React.HTMLAttributes<HTMLElement> {}

/** One chapter of `Page.Body` — a thin top rule (not a boxed card) separates it from the previous section, per a spacious editorial rhythm. The first section in a `Page.Body` should drop the rule via `className="border-t-0 pt-0"`. */
function PageSection({ className, children, ...props }: PageSectionProps) {
	return (
		<section className={cn('flex flex-col gap-4 border-t border-border pt-8', className)} {...props}>
			{children}
		</section>
	);
}

export interface PageSectionHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Header row for a `Page.Section` — a `Page.Title` at `level="section"` (plus optional `Page.Description`) on the left, `Page.Actions` on the right. */
function PageSectionHeader({ className, children, ...props }: PageSectionHeaderProps) {
	return (
		<div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', className)} {...props}>
			{children}
		</div>
	);
}

export interface PageFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Optional footer below `Page.Body`, e.g. for pagination or a save bar. */
function PageFooter({ className, children, ...props }: PageFooterProps) {
	return (
		<div className={cn('flex flex-wrap items-center justify-between gap-4 border-t border-border pt-6', className)} {...props}>
			{children}
		</div>
	);
}

export const Page = {
	Actions: PageActions,
	Body: PageBody,
	Description: PageDescription,
	Footer: PageFooter,
	Header: PageHeader,
	Root: PageRoot,
	Section: PageSection,
	SectionHeader: PageSectionHeader,
	Title: PageTitle,
};
