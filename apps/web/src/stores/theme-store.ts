import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ThemePreference } from "~/components/ui/actions-controls/switch-theme/switch-theme";

/** Key read by the inline script in `root.tsx` to set `data-theme` before first paint. */
export const THEME_STORAGE_KEY = "ui-theme";

/** Sets (or removes, for `"system"`) `data-theme` on `<html>`, which the CSS tokens key off. */
function applyTheme(preference: ThemePreference) {
  if (preference === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", preference);
  }
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

/**
 * Persisted theme preference. `skipHydration` keeps the first client render
 * equal to the server's; `useTheme` rehydrates after mount.
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      preference: "system",
      setPreference: (preference) => {
        applyTheme(preference);
        set({
          preference,
        });
      },
    }),
    {
      name: THEME_STORAGE_KEY,
      onRehydrateStorage: () => (state) => {
        applyTheme(state?.preference ?? "system");
      },
      partialize: (state) => ({
        preference: state.preference,
      }),
      skipHydration: true,
    },
  ),
);
