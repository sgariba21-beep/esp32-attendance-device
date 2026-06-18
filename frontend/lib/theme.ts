import type { CSSProperties } from 'react'

/**
 * Per-institution brand theming.
 *
 * Each institution stores a single brand colour (hex) in
 * `institutions.theme_primary`. The dashboard shell injects it as CSS custom
 * properties server-side (no FOUC, no client JS) via `brandStyle()`. Tailwind's
 * `@theme inline` maps `--color-primary → var(--primary)`, so overriding
 * `--primary` on the shell cascades to every `bg-primary` / `text-primary` /
 * `ring-primary` in the tree. Neutrals stay fixed; only the accent is tenant-scoped.
 *
 * The full accent scale (hover, soft tints, focus halos) derives from `--primary`
 * via `color-mix()` in globals.css, so we only override a handful of vars here.
 */

export type ThemePreset = {
  /** Stable key persisted in `institutions.theme_preset`. */
  key: string
  label: string
  hex: string
}

/** Curated brand palette. `indigo` is the platform default. */
export const THEME_PRESETS: ThemePreset[] = [
  { key: 'indigo', label: 'Indigo', hex: '#4F46E5' },
  { key: 'blue', label: 'Blue', hex: '#2563EB' },
  { key: 'sky', label: 'Sky', hex: '#0284C7' },
  { key: 'cyan', label: 'Cyan', hex: '#0891B2' },
  { key: 'teal', label: 'Teal', hex: '#0D9488' },
  { key: 'emerald', label: 'Emerald', hex: '#059669' },
  { key: 'green', label: 'Green', hex: '#16A34A' },
  { key: 'amber', label: 'Amber', hex: '#D97706' },
  { key: 'orange', label: 'Orange', hex: '#EA580C' },
  { key: 'rose', label: 'Rose', hex: '#E11D48' },
  { key: 'pink', label: 'Pink', hex: '#DB2777' },
  { key: 'violet', label: 'Violet', hex: '#7C3AED' },
  { key: 'slate', label: 'Slate', hex: '#475569' },
]

export const DEFAULT_BRAND = '#4F46E5'

/** Accepts `#rgb` / `#rrggbb` (case-insensitive). */
export function isValidHex(hex: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim())
}

/** Normalise to lowercase `#rrggbb`, expanding shorthand. */
export function normalizeHex(hex: string): string {
  let h = hex.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3]
  }
  return h
}

function hexToRgb(hex: string): [number, number, number] {
  const h = normalizeHex(hex)
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ]
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Readable text colour for content placed directly on the brand fill. */
export function brandForeground(hex: string): string {
  return relativeLuminance(hex) > 0.55 ? '#0a0a0a' : '#ffffff'
}

/**
 * Normalise brand fields from a settings form into DB columns. Shared by the
 * settings and institution-editor save actions. Pure (not a server action), so
 * it lives here rather than in a `'use server'` module.
 */
export function brandColumns(input: { theme_primary: string; theme_preset: string }) {
  const trimmed = input.theme_primary.trim()
  return {
    theme_primary: trimmed && isValidHex(trimmed) ? normalizeHex(trimmed) : null,
    theme_preset: input.theme_preset.trim() || null,
  }
}

type BrandVars = CSSProperties & Record<`--${string}`, string>

/**
 * CSS custom properties for the app shell. Returns `{}` for an invalid/empty
 * colour so the globals.css defaults stand. Set on a wrapper that contains the
 * whole dashboard (and is mounted under both `:root` and `.dark`).
 */
export function brandStyle(hex: string | null | undefined): BrandVars {
  if (!hex || !isValidHex(hex)) return {} as BrandVars
  const color = normalizeHex(hex)
  const fg = brandForeground(color)
  return {
    '--primary': color,
    '--primary-foreground': fg,
    '--ring': color,
    '--chart-1': color,
    '--sidebar-primary': color,
    '--sidebar-primary-foreground': fg,
  }
}
