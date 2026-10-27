'use client';

import type * as React from 'react';
import { cn } from '../../utils/tailwind/cn';

export interface CardProps extends React.HTMLAttributes<HTMLElement> {
	/**
	 * Element to render, so the card carries the right semantics (e.g. `"article"` for a self-contained item in a list).
	 * @default "div"
	 */
	as?: 'div' | 'article' | 'section';
	/**
	 * Adds hover/focus affordances for a card that acts as a single target. The card itself is not focusable: put a link or button inside (e.g. in `Card.Title`) and stretch it with `after:absolute after:inset-0` so the whole surface is clickable and keyboard reachable.
	 * @default false
	 */
	interactive?: boolean;
}

/**
 * Compound card — the base surface for grouped content: a bordered,
 * rounded container with optional `Card.Media`, `Card.Header` (`Card.Title`,
 * `Card.Description`, `Card.Action`), `Card.Content` and `Card.Footer`.
 * Sizing follows the shadcn/ui Card (`rounded-xl`, `py-6`, `px-6`, `gap-6`).
 * @example
 * ```tsx
 * <Card>
 *   <Card.Header>
 *     <Card.Title>Team plan</Card.Title>
 *     <Card.Description>Billed monthly.</Card.Description>
 *     <Card.Action><Button variant="secondary"><Button.Text>Manage</Button.Text></Button></Card.Action>
 *   </Card.Header>
 *   <Card.Content>…</Card.Content>
 *   <Card.Footer>…</Card.Footer>
 * </Card>
 * ```
 */
function CardRoot({ as: Element = 'div', interactive = false, className, ...props }: CardProps) {
	return (
		<Element
			className={cn(
				'relative flex w-full flex-col gap-6 overflow-hidden rounded-xl border border-border bg-background py-6 font-primary text-foreground shadow-xs',
				'transition-[border-color,box-shadow] duration-150 ease-in-out',
				interactive && 'cursor-pointer hover:border-border-strong hover:shadow-sm has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
				className
			)}
			{...props}
		/>
	);
}

export interface CardMediaProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Full-bleed slot for an image or illustration. Sits flush against the card's top edge, cancelling the card's top padding. */
function CardMedia({ className, ...props }: CardMediaProps) {
	return <div className={cn('-mt-6 w-full overflow-hidden [&>img]:block [&>img]:w-full', className)} {...props} />;
}

export interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Top block: `Card.Title` and `Card.Description` stacked on the left, with an optional `Card.Action` pinned to the right. */
function CardHeader({ className, ...props }: CardHeaderProps) {
	return <div className={cn('grid auto-rows-min grid-cols-[1fr_auto] items-start gap-y-1.5 px-6', className)} {...props} />;
}

export interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
	/**
	 * Heading element to render, so the card fits the page's outline.
	 * @default "h3"
	 */
	as?: 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

/** Title of the card, rendered as a heading (`h3` by default). */
function CardTitle({ as: Heading = 'h3', className, ...props }: CardTitleProps) {
	return <Heading className={cn('col-start-1 font-semibold leading-none', className)} {...props} />;
}

export interface CardDescriptionProps extends React.HTMLAttributes<HTMLParagraphElement> {}

/** Supporting text under the title. */
function CardDescription({ className, ...props }: CardDescriptionProps) {
	return <p className={cn('col-start-1 text-sm text-muted-foreground', className)} {...props} />;
}

export interface CardActionProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Control (button, menu, badge…) aligned to the top-right corner of `Card.Header`. */
function CardAction({ className, ...props }: CardActionProps) {
	return <div className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)} {...props} />;
}

export interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Main body of the card. */
function CardContent({ className, ...props }: CardContentProps) {
	return <div className={cn('px-6 text-sm', className)} {...props} />;
}

export interface CardFooterProps extends React.HTMLAttributes<HTMLDivElement> {}

/** Bottom row, for actions or metadata. Lays out its children horizontally. */
function CardFooter({ className, ...props }: CardFooterProps) {
	return <div className={cn('flex items-center gap-2 px-6', className)} {...props} />;
}

export const Card = Object.assign(CardRoot, {
	Action: CardAction,
	Content: CardContent,
	Description: CardDescription,
	Footer: CardFooter,
	Header: CardHeader,
	Media: CardMedia,
	Title: CardTitle,
});
