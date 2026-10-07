import type { GimpImage } from "../../engine/brush/gimp-resources"
import { type GrayscaleTexture, toGrayscale } from "../../engine/brush/texture"

/**
 * What the asset pipeline decides about a pixel: the pure half of
 * `tooling/krita-assets.ts`, kept apart so it can be tested without the
 * bundle.
 */

export type SourceImage = Pick<
  GimpImage,
  "width" | "height" | "channels" | "pixels"
>

function toRgba({ width, height, channels, pixels }: SourceImage): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const at = i * channels
    const grey = channels <= 2
    rgba[i * 4] = pixels[at]
    rgba[i * 4 + 1] = grey ? pixels[at] : pixels[at + 1]
    rgba[i * 4 + 2] = grey ? pixels[at] : pixels[at + 2]
    rgba[i * 4 + 3] =
      channels === 2 ? pixels[at + 1] : channels === 4 ? pixels[at + 3] : 255
  }
  return rgba
}

/**
 * A tip is coverage. A greyscale GIMP brush already stores it that way (its
 * background is 0, its mark 255), so its bytes are kept. Anything in colour
 * is a picture of a mark, read the way an imported tip is: dark is ink and
 * transparency is none (`toGrayscale`).
 */
export function tipFromImage(image: SourceImage): GrayscaleTexture {
  if (image.channels === 1)
    return {
      width: image.width,
      height: image.height,
      data: image.pixels.slice(),
    }
  return toGrayscale(toRgba(image), image.width, image.height)
}

/**
 * A grain is how much of a dab the paper lets through, so it reads the
 * opposite way from a tip: light is a peak that takes ink, as Krita's own
 * texturing reads a pattern. Transparency is paper with nothing on it.
 *
 * Then it is stretched to the full byte range, as the procedural paper is
 * (`createPaper`): the renderer cuts the tooth at a threshold set by depth,
 * and a pattern that used a third of the range would make depth mean a third
 * as much. A pattern of one tone has no tooth and lets everything through.
 */
export function grainFromImage(image: SourceImage): GrayscaleTexture {
  const rgba = toRgba(image)
  const count = image.width * image.height
  const level = new Float64Array(count)
  let low = Infinity
  let high = -Infinity
  for (let i = 0; i < count; i++) {
    const luminance =
      0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]
    const alpha = rgba[i * 4 + 3] / 255
    level[i] = luminance * alpha + 255 * (1 - alpha)
    low = Math.min(low, level[i])
    high = Math.max(high, level[i])
  }
  const data = new Uint8Array(count)
  const span = high - low
  for (let i = 0; i < count; i++)
    data[i] = span < 1e-6 ? 255 : Math.round(((level[i] - low) / span) * 255)
  return { width: image.width, height: image.height, data }
}

/**
 * Halves a texture until neither side exceeds `limit`, averaging each two by
 * two block. Halving rather than resampling to the limit exactly keeps a
 * tileable paper tileable while its sides are even: a whole number of source
 * texels still falls in each output one, so the edges keep meeting. An odd
 * side loses its last row or column, which no shipped paper is large enough
 * to need today.
 */
export function shrinkToFit(
  texture: GrayscaleTexture,
  limit: number
): GrayscaleTexture {
  let current = texture
  while (current.width > limit || current.height > limit) {
    const width = Math.max(1, current.width >> 1)
    const height = Math.max(1, current.height >> 1)
    const data = new Uint8Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        let sum = 0
        let n = 0
        for (let dy = 0; dy < 2; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const sx = x * 2 + dx
            const sy = y * 2 + dy
            if (sx >= current.width || sy >= current.height) continue
            sum += current.data[sy * current.width + sx]
            n++
          }
        data[y * width + x] = Math.round(sum / n)
      }
    current = { width, height, data }
  }
  return current
}

function stem(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
}

/** The name a menu shows: Krita's `03_` ordering prefix gone, words spaced. */
export function assetName(file: string): string {
  const words = stem(file)
    .replace(/^\d+[a-z]?[_-]/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words[0].toUpperCase() + words.slice(1)
}

/** The id under `krita:`, which brushes store: it must never change. */
export function assetSlug(file: string): string {
  return stem(file)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
