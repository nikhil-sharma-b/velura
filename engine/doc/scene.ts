import { decodeTransfer, srgbToWorking } from "../color/display-transform"
import {
  createTiledLayer,
  type LinearColor,
  type TiledLayer,
} from "./tiled-layer"

/** The canvas backdrop, authored as sRGB bytes and held in the working space. */
export const BACKGROUND = srgbToWorking([
  decodeTransfer(24 / 255),
  decodeTransfer(24 / 255),
  decodeTransfer(27 / 255),
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
 * The hardcoded document. Nothing is drawable yet; this exists so the storage
 * and colour foundations render something an eye and a golden image can check.
 */
export function createScene(width: number, height: number): TiledLayer {
  const layer = createTiledLayer({ width, height })
  for (const shape of SHAPES) layer.fillRect(shape.rect, shape.color)
  return layer
}
