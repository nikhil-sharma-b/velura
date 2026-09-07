import { decodeTransfer, srgbToWorking } from "../color/display-transform"
import type { LinearColor, TiledLayer } from "./tiled-layer"

/** The canvas backdrop, authored as sRGB bytes and held in the working space. */
export const BACKGROUND = srgbToWorking([
  decodeTransfer(255 / 255),
  decodeTransfer(255 / 255),
  decodeTransfer(255 / 255),
])

/**
 * The neutral matting surrounding the authored document. Mid-grey rather than
 * near-black: a very dark surround makes the eye adapt to it, so white paper
 * blooms and midtones are painted darker than intended. Editing tools mat in
 * grey for the same reason a gallery does. Kept neutral (r = g = b + 5) so it
 * biases no hue judgement; #18181b was cool enough to pull colour warm.
 */
export const WORKSPACE_BACKGROUND = srgbToWorking([
  decodeTransfer(48 / 255),
  decodeTransfer(49 / 255),
  decodeTransfer(54 / 255),
])

/**
 * Fully saturated working-space green. It lies outside sRGB, so a wide-gamut
 * display shows it as a colour sRGB cannot reach and a narrow one clips it.
 */
const WIDE_GREEN: LinearColor = [0, 1, 0, 1]

/** Half-transparent warm orange, premultiplied, to exercise linear compositing. */
const HALF_ORANGE: LinearColor = [0.8 * 0.5, 0.3 * 0.5, 0.05 * 0.5, 0.5]

export const SHAPES = [
  { rect: { x: 8, y: 4, width: 24, height: 12 }, color: WIDE_GREEN },
  { rect: { x: 36, y: 4, width: 20, height: 12 }, color: HALF_ORANGE },
] as const

/**
 * The hardcoded content of a new document, painted into a layer's own surface.
 * Nothing here is drawable yet; it exists so the storage and colour
 * foundations render something an eye and a golden image can check.
 */
export function seedScene(surface: TiledLayer): void {
  for (const shape of SHAPES) surface.fillRect(shape.rect, shape.color)
}
