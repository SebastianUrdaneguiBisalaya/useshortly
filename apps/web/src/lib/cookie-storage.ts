import type { StateStorage } from "zustand/middleware";

/** `zustand` storage backed by a cookie, so the server can read what the client persisted. */
export const cookieStorage: StateStorage = {
  getItem: (name) => {
    const entry = document.cookie
      .split(/;\s*/)
      .find((cookie) => cookie.startsWith(`${name}=`));
    return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
  },
  removeItem: (name) => {
    document.cookie = `${name}=; path=/; max-age=0`;
  },
  setItem: (name, value) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
  },
};

/** Server side: reads `state.preference` out of a cookie written by `cookieStorage` + zustand `persist`. */
export function readPersistedPreference(
  cookieHeader: string | null,
  name: string,
): unknown {
  const entry = cookieHeader
    ?.split(/;\s*/)
    .find((cookie) => cookie.startsWith(`${name}=`));
  if (!entry) return undefined;
  try {
    return JSON.parse(decodeURIComponent(entry.slice(name.length + 1))).state
      ?.preference;
  } catch {
    return undefined;
  }
}
