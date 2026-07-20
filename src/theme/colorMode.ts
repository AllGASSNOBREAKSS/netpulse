/**
 * Single owner for NetPulse's color mode.
 *
 * Two consumers must never disagree about light/dark:
 *   - the `.dark` class on <html>, which drives the Tailwind/shadcn tokens in
 *     index.css and the legacy surfaces in styles.css
 *   - Astryx's <Theme mode>, which drives every Astryx component
 *
 * So both read from this store. The class is the source of truth because
 * index.html applies it before first paint (no flash); this module keeps
 * localStorage and React subscribers in step with it.
 */
import { useSyncExternalStore } from "react";

const THEME_KEY = "netpulse_theme";

export type ColorMode = "light" | "dark";

let listeners: (() => void)[] = [];

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function readMode(): ColorMode {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Dark is the product default, and matches the SSR/prerender fallback. */
const SERVER_MODE: ColorMode = "dark";

export function setColorMode(next: ColorMode) {
  document.documentElement.classList.toggle("dark", next === "dark");
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    /* localStorage unavailable — the class still applies for this session */
  }
  emit();
}

export function toggleColorMode() {
  setColorMode(readMode() === "dark" ? "light" : "dark");
}

/** Subscribe a component to the current color mode. */
export function useColorMode(): ColorMode {
  return useSyncExternalStore(subscribe, readMode, () => SERVER_MODE);
}
