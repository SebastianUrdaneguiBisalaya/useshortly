import { useEffect } from "react";
import type { ThemePreference } from "~/components/ui/actions-controls/switch-theme/switch-theme";
import { useThemeStore } from "~/stores/theme-store";

export interface UseTheme {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Theme preference with `"system"` support, backed by `useThemeStore`.
 * Pass it to `SwitchTheme` in controlled mode:
 * `<SwitchTheme value={preference} onValueChange={setPreference} />`.
 */
export function useTheme(): UseTheme {
  const preference = useThemeStore((state) => state.preference);
  const setPreference = useThemeStore((state) => state.setPreference);

  useEffect(() => {
    void useThemeStore.persist.rehydrate();
  }, []);

  return {
    preference,
    setPreference,
  };
}
