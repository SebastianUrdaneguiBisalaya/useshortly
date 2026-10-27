import { useEffect } from "react";

export function useClickOutside<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  callback: () => void,
  excludeRef?: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (excludeRef?.current?.contains(target)) return;
      callback();
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [
    callback,
    ref,
    excludeRef,
  ]);
}
