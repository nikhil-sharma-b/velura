import type { RenderedPixels } from "../index"

export type ImageExportOptions =
  | { format: "png" }
  | { format: "jpeg"; quality: number; maxEdge?: number }

/** Encodes the renderer's already display-transformed bytes without recolouring them. */
export async function encodeExportImage(
  pixels: RenderedPixels,
  options: ImageExportOptions
): Promise<Blob> {
  if (
    options.format === "jpeg" &&
    (!Number.isFinite(options.quality) ||
      options.quality < 0.1 ||
      options.quality > 1)
  )
    throw new Error("JPEG quality must be between 10% and 100%.")
  const maxEdge =
    options.format === "jpeg" ? (options.maxEdge ?? 2048) : Infinity
  const scale = Math.min(1, maxEdge / Math.max(pixels.width, pixels.height))
  const width = Math.max(1, Math.round(pixels.width * scale))
  const height = Math.max(1, Math.round(pixels.height * scale))
  const bitmap = await createImageBitmap(
    new ImageData(
      new Uint8ClampedArray(
        pixels.data.buffer as ArrayBuffer,
        pixels.data.byteOffset,
        pixels.data.byteLength
      ),
      pixels.width,
      pixels.height,
      { colorSpace: pixels.colorSpace }
    ),
    { resizeWidth: width, resizeHeight: height, resizeQuality: "high" }
  )
  try {
    const canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext("2d", { colorSpace: pixels.colorSpace })
    if (!context) throw new Error("A 2D canvas is required to export images.")
    context.drawImage(bitmap, 0, 0)
    return await canvas.convertToBlob({
      type: options.format === "png" ? "image/png" : "image/jpeg",
      ...(options.format === "jpeg" ? { quality: options.quality } : {}),
    })
  } finally {
    bitmap.close()
  }
}
