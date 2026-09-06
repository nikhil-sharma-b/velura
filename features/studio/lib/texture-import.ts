"use client"

import type { GrayscaleTexture } from "@/engine/brush/texture"
import { MAX_TEXTURE_DIMENSION } from "@/convex/lib/brush"

/**
 * Bringing a texture in from a file (24/25): a scanned paper, a photographed
 * tip, a mark made elsewhere.
 *
 * Tips and grain are single-channel — coverage, and how much of it the paper
 * lets through — so an imported image is reduced to one byte per texel here,
 * at the boundary, rather than three quarters of it being carried around and
 * discarded by the uploader. That is also what makes the stored asset the same
 * shape as a built-in one, so nothing downstream has to know where it came
 * from.
 */

/**
 * Ink, as the engine means it: a texel is how much the brush marks there, so
 * 255 is full coverage and 0 is nothing — the convention `createTip` builds
 * the shipped tips to, where the texture falls to zero at the rim.
 *
 * An image says the opposite in the medium artists actually have one in: a
 * stamp is a dark mark on white paper, or a dark mark on nothing at all. So
 * the darkness is the ink, and transparency is where there is none — take
 * luminance directly and a scanned tip would import as a covering square with
 * a hole where the mark is. Luminance is weighted perceptually rather than
 * averaged flat, so a blue mark and a yellow one of the same lightness import
 * as the same strength of ink.
 */
export function toGrayscale(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number
): GrayscaleTexture {
  const data = new Uint8Array(width * height)
  for (let index = 0; index < data.length; index++) {
    const at = index * 4
    const luminance =
      0.2126 * rgba[at] + 0.7152 * rgba[at + 1] + 0.0722 * rgba[at + 2]
    const alpha = rgba[at + 3] / 255
    data[index] = Math.round((255 - luminance) * alpha)
  }
  return { width, height, data }
}

/** The size an image is drawn at: its own, until it is larger than we store. */
export function importedSize(
  width: number,
  height: number,
  limit = MAX_TEXTURE_DIMENSION
): { width: number; height: number } {
  const scale = Math.min(1, limit / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * A file as a texture. The decode and the draw are the browser's, so this is
 * the thin part that cannot be unit-tested; everything it decides — the
 * reduction and the size — is above and is.
 */
export async function readTextureFile(file: Blob): Promise<GrayscaleTexture> {
  const bitmap = await createImageBitmap(file)
  try {
    const size = importedSize(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const ink = canvas.getContext("2d", { willReadFrequently: true })
    if (!ink) throw new Error("This browser could not read that image.")
    ink.drawImage(bitmap, 0, 0, size.width, size.height)
    const pixels = ink.getImageData(0, 0, size.width, size.height)
    return toGrayscale(pixels.data, size.width, size.height)
  } finally {
    bitmap.close()
  }
}
