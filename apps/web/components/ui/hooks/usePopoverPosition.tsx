"use client";

import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useState,
} from "react";

const DEFAULT_GAP = 16;

/**
 * Fixed-position style for a portaled popover anchored to a trigger, flipping above the trigger
 * when there isn't room below and clamping to the viewport horizontally.
 *
 * The panel starts invisible/off-flow: its real width (e.g. two month panels in a range calendar,
 * or three time columns) is only known once it's actually laid out in the DOM, so the first paint
 * must wait for that measurement instead of guessing from the trigger's (much narrower) width —
 * that guess is what sends the panel to the wrong side on its very first open.
 *
 * @param open Whether the popover is rendered; resets to the hidden style when false.
 * @param triggerRef Element the popover is anchored to.
 * @param contentRef The popover panel itself, measured to decide side and clamping.
 * @param options.gap Pixels between trigger and panel, also the minimum viewport inset. @default 16
 */
export function usePopoverPosition(
  open: boolean,
  triggerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options?: {
    gap?: number;
  },
): CSSProperties {
  const gap = options?.gap ?? DEFAULT_GAP;
  const [style, setStyle] = useState<CSSProperties>({
    opacity: 0,
    pointerEvents: "none",
    position: "fixed",
  });

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;

    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const contentWidth = content.offsetWidth;
    const contentHeight = content.offsetHeight;

    const left = Math.min(
      rect.left,
      Math.max(gap, viewportWidth - gap - contentWidth),
    );

    const spaceBelow = viewportHeight - rect.bottom - gap;
    const spaceAbove = rect.top - gap;
    const openUpward = spaceBelow < contentHeight && spaceAbove > spaceBelow;

    setStyle(
      openUpward
        ? {
            bottom: viewportHeight - rect.top + gap,
            left,
            position: "fixed",
            zIndex: 9999,
          }
        : {
            left,
            position: "fixed",
            top: rect.bottom + gap,
            zIndex: 9999,
          },
    );
  }, [
    triggerRef,
    contentRef,
    gap,
  ]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({
        opacity: 0,
        pointerEvents: "none",
        position: "fixed",
      });
      return;
    }
    computePosition();
    window.addEventListener("scroll", computePosition, true);
    window.addEventListener("resize", computePosition);
    return () => {
      window.removeEventListener("scroll", computePosition, true);
      window.removeEventListener("resize", computePosition);
    };
  }, [
    open,
    computePosition,
  ]);

  return style;
}
