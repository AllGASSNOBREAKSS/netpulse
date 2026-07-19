import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DARK_QUERY,
  THEME_KEY,
  ThemeContext,
  applyTheme,
  readTheme,
  type ResolvedTheme,
  type ThemePreference,
} from "../lib/theme";

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(readTheme);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => applyTheme(theme));

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const update = () => setResolvedTheme(applyTheme(theme));
    update();
    if (theme === "system") media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [theme]);

  const setTheme = (next: ThemePreference) => {
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Theme still applies for this session when storage is unavailable.
    }
    setThemeState(next);
  };

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
