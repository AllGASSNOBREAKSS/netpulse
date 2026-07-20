/**
 * Mounts the NetPulse Astryx theme at the app root.
 *
 * `mode` is driven explicitly from the shared color-mode store rather than
 * left at 'system', so Astryx components switch in the same tick as the
 * `.dark` class that themes Tailwind, shadcn and the legacy gauge CSS.
 *
 * This is a client-only Vite SPA, so the runtime (non-`/built`) theme is the
 * right choice — there's no SSR pass for component overrides to flash against.
 */
import type { ReactNode } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { netpulseTheme } from "./netpulse";
import { useColorMode } from "./colorMode";

export function AstryxProvider({ children }: { children: ReactNode }) {
  const mode = useColorMode();

  return (
    <Theme theme={netpulseTheme} mode={mode}>
      {children}
    </Theme>
  );
}
