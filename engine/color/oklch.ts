/**
 * The authoring space (architecture §5.1). The picker works in OKLCH because
 * that is what makes a slider behave: a fixed step of lightness looks like a
 * fixed step to the eye, and changing lightness does not drag the hue with it,
 * which is exactly what HSV does and why HSV pickers feel wrong to paint with.
 *
 * Two conversions live here and nowhere else:
 *
 * - **OKLCH against the engine's working space.** Oklab's published matrices
 *   are defined against *linear sRGB*; the working space is *linear Display
 *   P3* (`display-transform.ts`). So the primaries are converted first, and a
 *   colour outside sRGB is still a perfectly ordinary Oklab value — nothing is
 *   clipped in the maths, only when a colour is finally encoded for display.
 * - **Hex against the working space.** Hex is sRGB by definition, so it is the
 *   narrower channel: a P3-only colour has no hex, and `clampChromaToSrgb`
 *   gives up chroma — never hue or lightness — to fit one.
 */

import {
  decodeTransfer,
  displayTransform,
  srgbToWorking,
  workingToSrgb,
} from "./display-transform"
import { formatHex, parseHex } from "./hex"

export { canonicalHex, formatHex, parseHex } from "./hex"

/** A colour as the picker holds it: perceptual lightness, chroma and hue. */
export type Oklch = Readonly<{
  /** Perceptual lightness, 0 (black) to 1 (white). */
  lightness: number
  /** Distance from grey. Unbounded in principle; ~0.37 is the sRGB maximum. */
  chroma: number
  /** Hue angle in degrees, [0, 360). */
  hue: number
}>

export type Rgb = readonly [number, number, number]

// Ottosson's Oklab matrices, against linear sRGB.
function linearSrgbToOklab(color: Rgb): [number, number, number] {
  const long = Math.cbrt(
    0.4122214708 * color[0] + 0.5363325363 * color[1] + 0.0514459929 * color[2]
  )
  const medium = Math.cbrt(
    0.2119034982 * color[0] + 0.6806995451 * color[1] + 0.1073969566 * color[2]
  )
  const short = Math.cbrt(
    0.0883024619 * color[0] + 0.2817188376 * color[1] + 0.6299787005 * color[2]
  )
  return [
    0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  ]
}

function oklabToLinearSrgb(lab: Rgb): [number, number, number] {
  const long = (lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2]) ** 3
  const medium = (lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2]) ** 3
  const short = (lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2]) ** 3
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

export function workingToOklch(working: Rgb): Oklch {
  const [lightness, a, b] = linearSrgbToOklab(workingToSrgb(working))
  const chroma = Math.hypot(a, b)
  // A grey has no hue to report; zero keeps the picker's slider still rather
  // than letting floating-point dust swing it.
  const hue =
    chroma < 1e-7 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
  return { lightness, chroma, hue }
}

/** The linear P3 the engine paints in. May fall outside [0, 1]: see clamping. */
export function oklchToWorking({
  lightness,
  chroma,
  hue,
}: Oklch): [number, number, number] {
  const radians = (hue * Math.PI) / 180
  return srgbToWorking(
    oklabToLinearSrgb([
      lightness,
      chroma * Math.cos(radians),
      chroma * Math.sin(radians),
    ])
  )
}

/** Whether a working colour survives the trip to sRGB without being clipped. */
export function isSrgbDisplayable(working: Rgb): boolean {
  // A hair of slack: the P3 and sRGB matrices are a numerical inverse pair,
  // not an exact one, and a primary should not be judged out of gamut by its
  // own rounding error.
  const epsilon = 1e-4
  return workingToSrgb(working).every(
    (channel) => channel >= -epsilon && channel <= 1 + epsilon
  )
}

/**
 * The nearest colour of the same hue and lightness that sRGB can hold. Chroma
 * is the only thing given up, because giving up hue would change *which*
 * colour it is and giving up lightness would change where it sits in a
 * painting — both far more visible than a slightly duller version of the
 * colour asked for.
 */
export function clampChromaToSrgb(color: Oklch): Oklch {
  if (isSrgbDisplayable(oklchToWorking(color))) return color
  // Bisection: chroma zero is always displayable (it is a grey), so the
  // boundary is bracketed from the start. Twenty halvings put it well inside
  // one 8-bit step, which is all a hex can record anyway.
  let low = 0
  let high = color.chroma
  for (let step = 0; step < 20; step++) {
    const middle = (low + high) / 2
    if (isSrgbDisplayable(oklchToWorking({ ...color, chroma: middle })))
      low = middle
    else high = middle
  }
  return { ...color, chroma: low }
}

/**
 * The most chroma this lightness and hue can carry and still have a hex.
 *
 * The picker's saturation slider is a fraction of this rather than a raw
 * chroma, because the ceiling varies enormously by hue — yellow runs out long
 * before blue does — and a slider whose top two thirds are the same clipped
 * colour is a slider that lies about what it is doing.
 */
export function maxSrgbChroma(lightness: number, hue: number): number {
  // 0.5 is comfortably past the sRGB maximum (~0.37) at every hue, so the
  // bisection in `clampChromaToSrgb` always starts outside the gamut.
  return clampChromaToSrgb({ lightness, chroma: 0.5, hue }).chroma
}

/** Hex is authored sRGB; the engine paints in linear P3. */
export function hexToWorking(hex: string): [number, number, number] {
  const encoded = parseHex(hex)
  if (!encoded) throw new Error(`Not a colour: ${hex}`)
  return srgbToWorking(encoded.map(decodeTransfer) as [number, number, number])
}

/**
 * The hex for a working colour, by the same display transform the present pass
 * uses — so what the field says is what the canvas shows, clipped identically
 * when the colour is outside sRGB.
 */
export function workingToHex(working: Rgb): string {
  return formatHex(displayTransform(working, "srgb"))
}
