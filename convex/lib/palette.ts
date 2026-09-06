/**
 * Palette rules that hold with or without a database, in the shape of
 * `convex/lib/documents.ts`: kept free of `ctx` so the picker can reorder a
 * palette optimistically and the mutation can enforce the same rule on
 * arrival, without two versions of "what a swatch is" drifting apart.
 *
 * Swatches are stored as sRGB hex rather than as working-space triples. Hex is
 * what the artist types, what round-trips exactly (`engine/color/oklch.ts`),
 * and what stays readable in a database row years from now; the engine does
 * the one conversion into linear light at the moment of painting. The notation
 * itself is shared with the engine (`lib/hex-color.ts`), so the two cannot
 * disagree about what a swatch is.
 */

import { canonicalHex } from "../../engine/color/hex"

/** How many colours stay to hand. Two rows of six in the picker. */
export const RECENT_LIMIT = 12
export const MAX_PALETTE_COLORS = 256
export const MAX_PALETTE_NAME_LENGTH = 120
export const DEFAULT_PALETTE_NAME = "Untitled palette"

/** Canonical `#rrggbb`, or null when the text is not a colour. */
export function normaliseSwatch(hex: string): string | null {
  return canonicalHex(hex)
}

/**
 * Validates and canonicalises in one pass, throwing the reason it cannot.
 * One pass rather than two because a caller that has already checked should
 * not then have to assert that each swatch parses a second time.
 */
export function normaliseColors(colors: readonly string[]): string[] {
  if (colors.length > MAX_PALETTE_COLORS)
    throw new Error(`A palette holds at most ${MAX_PALETTE_COLORS} colours.`)
  return colors.map((color) => {
    const swatch = canonicalHex(color)
    if (swatch === null) throw new Error(`${color} is not a colour.`)
    return swatch
  })
}

/**
 * Records a colour as just used. Newest first, no duplicates, bounded — so
 * moving back and forth between a working set keeps that set to hand instead
 * of filling the strip with one colour picked twice.
 */
export function recordRecent(
  recent: readonly string[],
  hex: string,
  limit = RECENT_LIMIT
): string[] {
  const swatch = normaliseSwatch(hex)
  if (!swatch) return [...recent]
  return [swatch, ...recent.filter((existing) => existing !== swatch)].slice(
    0,
    limit
  )
}

/**
 * Moves a colour to a position counted in the resulting palette. Positions are
 * clamped rather than rejected: a drag that overshoots the end of the strip
 * means "put it last", which is what the hand was saying.
 */
export function moveColor(
  colors: readonly string[],
  from: number,
  to: number
): string[] {
  if (from < 0 || from >= colors.length) return [...colors]
  const next = [...colors]
  const [moved] = next.splice(from, 1)
  next.splice(Math.min(next.length, Math.max(0, to)), 0, moved)
  return next
}

export function normalisePaletteName(name: string): string {
  const collapsed = name.trim().replace(/\s+/g, " ")
  return (collapsed || DEFAULT_PALETTE_NAME).slice(0, MAX_PALETTE_NAME_LENGTH)
}

/** Returns null when the colours are storable, or the reason they are not. */
export function paletteProblem(colors: readonly string[]): string | null {
  if (colors.length > MAX_PALETTE_COLORS)
    return `A palette holds at most ${MAX_PALETTE_COLORS} colours.`
  const bad = colors.find((color) => normaliseSwatch(color) === null)
  return bad === undefined ? null : `${bad} is not a colour.`
}
