import { useContext } from "react";
import { ThemeContext, type ThemeContextValue } from "../lib/theme";

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside ThemeProvider.");
  return value;
}
