/**
 * Hex colour notation — the one thing an artist can type, a database can
 * store, and a design specified elsewhere arrives as.
 *
 * It lives here, beside the rest of the colour pipeline, because the engine is
 * framework-free and may not reach outward for it. The backend imports it the
 * other way — `convex/lib/palette.ts` stores palettes as hex — the same
 * direction `convex/lib/retention.ts` is already read from the engine's tests.
 * Two copies of the parse would eventually disagree about what "#abc" means.
 *
 * Hex is sRGB by definition, so these are display-encoded sRGB channels — not
 * the working space, and not linear light.
 */

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Display-encoded sRGB channels in [0, 1], or null when it is not a colour. */
export function parseHex(text: string): [number, number, number] | null {
  const match = HEX_PATTERN.exec(text.trim())
  if (!match) return null
  const digits = match[1]
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits
  return [0, 2, 4].map(
    (offset) => Number.parseInt(full.slice(offset, offset + 2), 16) / 255
  ) as [number, number, number]
}

/** Canonical lowercase `#rrggbb`, clipping rather than wrapping out-of-range. */
export function formatHex(
  encodedSrgb: readonly [number, number, number]
): string {
  return `#${encodedSrgb
    .map((channel) =>
      Math.round(Math.min(1, Math.max(0, channel)) * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`
}

/** The same colour written the one way, or null when it is not a colour. */
export function canonicalHex(text: string): string | null {
  const parsed = parseHex(text)
  return parsed === null ? null : formatHex(parsed)
}
