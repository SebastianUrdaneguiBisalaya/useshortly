'use client';

import * as React from 'react';

import { cn } from '../../utils/tailwind/cn';

export interface InputOtpProps {
	/** Current code, for controlled usage. */
	value?: string;
	/** Initial code, for uncontrolled usage. @default "" */
	defaultValue?: string;
	onChange?: (value: string) => void;
	/**
	 * Number of digits.
	 * @default 6
	 */
	length?: number;
	/** Splits the slots into visual groups, e.g. `[3, 3]` renders "XXX — XXX". @default [length] (no grouping) */
	groups?: number[];
	label?: string;
	/**
	 * Accessible name used when `label` isn't passed.
	 * @default "Verification code"
	 */
	fallbackLabel?: string;
	errorMessage?: string;
	disabled?: boolean;
}

/**
 * One-time-passcode input. A single visually-hidden `<input>` receives all
 * keystrokes/paste/autofill (`autoComplete="one-time-code"` picks up SMS
 * codes natively) while a row of `<div>` slots derived from its value
 * renders the boxes — the same trick headless OTP libraries use, without
 * the dependency, since the logic itself is a few lines of state.
 */
export function InputOtp({ value: controlledValue, defaultValue = '', onChange, length = 6, groups, label, fallbackLabel = 'Verification code', errorMessage, disabled }: InputOtpProps) {
	const inputId = React.useId();
	const errorId = `${inputId}-error`;
	const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue);
	const [focused, setFocused] = React.useState(false);
	const isControlled = controlledValue !== undefined;
	const value = isControlled ? controlledValue : uncontrolledValue;

	const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const sanitized = event.target.value.replace(/\D/g, '').slice(0, length);
		if (!isControlled) setUncontrolledValue(sanitized);
		onChange?.(sanitized);
	};

	const segments = groups ?? [length];
	let charIndex = 0;

	return (
		<div className='flex flex-col gap-1.5 self-center'>
			{label && (
				<label className='text-sm font-medium font-primary text-foreground text-center' htmlFor={inputId}>
					{label}
				</label>
			)}
			<div className='relative inline-flex w-fit items-center gap-3 has-disabled:opacity-40'>
				<input
					aria-describedby={errorMessage ? errorId : undefined}
					aria-invalid={Boolean(errorMessage)}
					aria-label={label ? undefined : fallbackLabel}
					autoComplete='one-time-code'
					className='absolute inset-0 z-20 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed'
					disabled={disabled}
					id={inputId}
					inputMode='numeric'
					maxLength={length}
					onBlur={() => setFocused(false)}
					onChange={handleChange}
					onFocus={() => setFocused(true)}
					type='text'
					value={value}
				/>
				{segments.map((count, groupIndex) => {
					const startIndex = charIndex;
					charIndex += count;
					return (
						<div
							className='flex'
							key={`group-${
								// biome-ignore lint/suspicious/noArrayIndexKey: group boundaries are fixed by the `groups` prop, never reordered
								groupIndex
							}`}
						>
							{Array.from(
								{
									length: count,
								},
								(_, offset) => {
									const index = startIndex + offset;
									return <Slot active={focused && index === value.length} char={value[index] ?? null} key={index} />;
								}
							)}
						</div>
					);
				})}
			</div>
			{errorMessage && (
				<p className='text-xs text-destructive' id={errorId} role='alert'>
					{errorMessage}
				</p>
			)}
		</div>
	);
}

interface SlotProps {
	char: string | null;
	active: boolean;
}

function Slot({ char, active }: SlotProps) {
	return (
		<div
			className={cn(
				'relative flex h-10 w-10 items-center justify-center border-y border-r border-border font-primary text-lg text-foreground transition-colors duration-150 ease-in-out',
				'first:rounded-l-md first:border-l last:rounded-r-md',
				active && 'z-10 outline-2 -outline-offset-1 outline-ring'
			)}
		>
			{char}
			{active && !char && (
				<span className='pointer-events-none absolute inset-0 flex items-center justify-center'>
					<span className='h-5 w-px animate-caret-blink bg-foreground' />
				</span>
			)}
		</div>
	);
}
