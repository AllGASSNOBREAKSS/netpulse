/**
 * NetPulse Astryx theme.
 *
 * Extends theme-neutral rather than redefining a full token set, so any token
 * we don't name here keeps a vetted Astryx default (and stays correct when the
 * design system updates).
 *
 * Visual direction:
 *   - deep black main workspace, charcoal sidebar / elevated surfaces
 *   - white + muted-gray typography, minimal borders
 *   - one controlled electric-blue accent (never a section background)
 *   - Geist / Geist Mono (loaded via index.html; font loading is the app's job)
 *
 * Token values are [light, dark] tuples, which defineTheme compiles to CSS
 * light-dark(), so both modes come from a single source of truth.
 *
 * The accent is declared through `color.accent` instead of writing
 * --color-accent by hand: the scale generator derives --color-on-accent,
 * --color-accent-muted and --color-text-accent from it with real contrast.
 * Hand-writing --color-accent alone would leave --color-on-accent at its stale
 * default with no contrast guarantee (see `npx astryx docs migration`).
 */
import { defineTheme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral";

/**
 * Controlled electric blue, as solid per-mode values.
 *
 * These are written out instead of being left to `color.accent`'s HCT
 * generator for two reasons:
 *
 * 1. Identity. Seeding the generator produced a pale periwinkle (#B9C3FF) in
 *    dark mode — legible, but not the controlled electric blue NetPulse wants
 *    against a deep-black workspace.
 *
 * 2. Correctness. The generator derives --color-accent-muted by nesting the
 *    generated accent inside a color-mix() inside a light-dark():
 *      light-dark(color-mix(in srgb, light-dark(#005ACC,#B9C3FF) 20%, …), …)
 *    A nested light-dark() is invalid as a color-mix() argument, so the token
 *    computed to transparent — which silently killed TextInput's focus ring
 *    (`box-shadow: inset 0 0 0 2px var(--color-accent-muted)`), an outright
 *    WCAG 2.4.7 failure. Flat per-mode values keep every token valid.
 *
 * The fill and the text accent are deliberately different: a mid-blue fill
 * carries white label text (>=4.5:1), while accent *text* on the near-black
 * body needs to be lighter to stay readable.
 */
export const NETPULSE_ACCENT = { light: "#0B5FD9", dark: "#1D6BF0" } as const;

export const netpulseTheme = defineTheme({
  name: "netpulse",
  extends: neutralTheme,

  // Seeds the non-accent parts of the palette (neutrals, tints). Every accent
  // token itself is pinned explicitly in `tokens` below.
  color: {
    accent: NETPULSE_ACCENT.dark,
    neutralStyle: "cool",
    contrast: "standard",
  },

  typography: {
    scale: { base: 15, ratio: 1.2 },
    body: { family: "Geist", fallbacks: "system-ui, -apple-system, sans-serif" },
    heading: { family: "Geist", fallbacks: "system-ui, sans-serif", weight: "semibold" },
    code: { family: "Geist Mono", fallbacks: 'ui-monospace, "SF Mono", monospace' },
  },

  radius: { base: 4, multiplier: 1.15 },

  // Restrained motion: quick enough to feel responsive, never showy.
  motion: { fast: 140, medium: 300, ratio: 0.75 },

  tokens: {
    // ---- Accent: one controlled electric blue, never a section background ----
    // Solid fill; carries white text at 5.8:1 (light) and 4.8:1 (dark).
    "--color-accent": [NETPULSE_ACCENT.light, NETPULSE_ACCENT.dark],
    "--color-on-accent": ["#FFFFFF", "#FFFFFF"],
    // Focus ring + accent-tinted surfaces. Solid (not an alpha tint) so the
    // TextInput focus ring stays clearly visible in both modes.
    "--color-accent-muted": ["#8CB4F8", "#3A6FD8"],
    // Accent *text/icons* sit on the page background, so dark mode needs a
    // lighter blue than the fill: 7.7:1 on the near-black body vs 4.2:1.
    "--color-text-accent": ["#0B5FD9", "#6BA1FF"],
    "--color-icon-accent": ["#0B5FD9", "#6BA1FF"],

    // ---- Surfaces: deep black workspace, charcoal elevation ----
    "--color-background-body": ["#FAFAFB", "#08090B"],
    "--color-background-surface": ["#FFFFFF", "#121317"],
    "--color-background-card": ["#FFFFFF", "#141519"],
    "--color-background-popover": ["#FFFFFF", "#17181D"],
    "--color-background-muted": ["#F2F3F5", "#1A1B20"],

    // ---- Typography: white / muted gray ----
    "--color-text-primary": ["#101114", "#F4F5F7"],
    "--color-text-secondary": ["#5C626D", "#9BA1AC"],
    "--color-text-disabled": ["#9AA0AA", "#5A606B"],

    "--color-icon-primary": ["#101114", "#E8EAEE"],
    "--color-icon-secondary": ["#5C626D", "#9BA1AC"],

    // ---- Minimal borders: present, never loud ----
    "--color-border": ["#E6E7EA", "#23252B"],
    "--color-border-emphasized": ["#CDD0D6", "#31343C"],

    // ---- Status: aligned with the existing --status-* gauge/metric colors ----
    "--color-success": ["#1A8A4F", "#3DD68C"],
    "--color-warning": ["#B26A00", "#F0A93B"],
    "--color-error": ["#C4342B", "#F2635A"],

    "--color-skeleton": ["#ECEDF0", "#1C1E23"],
    "--color-track": ["#E6E7EA", "#23252B"],
  },
});

export type NetPulseTheme = typeof netpulseTheme;
