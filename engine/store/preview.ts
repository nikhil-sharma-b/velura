import type { RenderedPixels } from "../index"

export const PREVIEW_MAX_EDGE = 512

export function previewSize(
  width: number,
  height: number
): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** Encodes display pixels without applying a second colour transform. */
export async function encodePreview(
  pixels: RenderedPixels
): Promise<Uint8Array> {
  const size = previewSize(pixels.width, pixels.height)
  // Browser-managed bitmap creation and resize yield instead of painting a
  // document-sized 2D canvas on the main thread during a flush.
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
    {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    }
  )
  const preview = new OffscreenCanvas(size.width, size.height)
  const previewContext = preview.getContext("2d", {
    colorSpace: pixels.colorSpace,
  })
  if (!previewContext) throw new Error("A 2D canvas is required for previews.")
  previewContext.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await preview.convertToBlob({ type: "image/png" })
  return new Uint8Array(await blob.arrayBuffer())
}
