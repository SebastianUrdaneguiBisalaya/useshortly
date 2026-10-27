"use client";

import { Monitor } from "lucide-react";
import * as React from "react";
import { Icon } from "../../foundations/icon/icon";
import { cn } from "../../utils/tailwind/cn";

/** `"system"` follows the browser language; the rest are explicit language codes. */
export type LanguagePreference = "system" | "en" | "es";

/** Texts rendered by `SwitchLanguage`. Pass `lang` to override any of them. */
export interface SwitchLanguageLang {
  /** Accessible label for the radiogroup itself. */
  groupLabel: string;
  /** Accessible name for the "system" option. */
  system: string;
  /** Accessible name for the English option. */
  en: string;
  /** Accessible name for the Spanish option. */
  es: string;
}

/** English defaults for `SwitchLanguageLang`. */
export const defaultSwitchLanguageLang: SwitchLanguageLang = {
  en: "English",
  es: "Spanish",
  groupLabel: "Language",
  system: "System",
};

const OPTION_VALUES: LanguagePreference[] = [
  "system",
  "es",
  "en",
];

export interface SwitchLanguageProps {
  /** Current preference. Controlled only: pair it with `useLanguage()`. */
  value: LanguagePreference;
  onValueChange: (language: LanguagePreference) => void;
  className?: string;
  /**
   * Texts rendered by this component. Merges over English defaults.
   * @default defaultSwitchLanguageLang
   */
  lang?: Partial<SwitchLanguageLang>;
}

/**
 * Three-way language switcher (System/ES/EN), a segmented control following
 * the WAI-ARIA radio-group pattern and styled like `SwitchTheme`.
 * @example
 * ```tsx
 * const { preference, setPreference } = useLanguage();
 * <SwitchLanguage value={preference} onValueChange={setPreference} />
 * ```
 */
export function SwitchLanguage({
  value,
  onValueChange,
  className,
  lang,
}: SwitchLanguageProps) {
  const resolvedLang = { ...defaultSwitchLanguageLang, ...lang };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const group = event.currentTarget.closest('[role="radiogroup"]');
    if (!(group instanceof HTMLElement)) return;
    const buttons = Array.from(
      group.querySelectorAll<HTMLElement>('[role="radio"]'),
    );
    const index = buttons.indexOf(event.currentTarget);
    if (index === -1) return;

    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % OPTION_VALUES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + OPTION_VALUES.length) % OPTION_VALUES.length;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    buttons[nextIndex]?.focus();
    const next = OPTION_VALUES[nextIndex];
    if (next) onValueChange(next);
  };

  return (
    <div
      aria-label={resolvedLang.groupLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border border-border bg-background p-0.5",
        className,
      )}
      role="radiogroup"
    >
      {OPTION_VALUES.map((option) => {
        const isActive = value === option;
        return (
          <button
            aria-checked={isActive}
            aria-label={resolvedLang[option]}
            className={cn(
              "flex h-7 min-w-7 shrink-0 cursor-pointer items-center justify-center rounded-full px-1.5 font-primary text-xs font-medium transition-colors duration-150 ease-in-out",
              "focus-visible:outline-2! focus-visible:outline-offset-2! focus-visible:outline-ring!",
              isActive
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
            key={option}
            onClick={() => onValueChange(option)}
            onKeyDown={handleKeyDown}
            role="radio"
            tabIndex={isActive ? 0 : -1}
            type="button"
          >
            {option === "system" ? (
              <Icon
                icon={Monitor}
                size="sm"
              />
            ) : (
              option.toUpperCase()
            )}
          </button>
        );
      })}
    </div>
  );
}
