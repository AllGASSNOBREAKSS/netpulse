import { createContext } from "react";

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";
export type ThemeContextValue = {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
};

export const THEME_KEY = "netpulse_theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";
export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function readTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolved = theme === "system" && window.matchMedia(DARK_QUERY).matches ? "dark" : theme === "system" ? "light" : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  return resolved;
}

export function applyStoredTheme(): void {
  applyTheme(readTheme());
}
