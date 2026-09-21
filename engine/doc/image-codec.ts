/**
 * The browser's own decoder and scaler, behind the `ImageSourceCodec` seam.
 *
 * Kept apart from `image-source.ts` for the reason its neighbour
 * `image-placement.ts` states about itself: the geometry is pure value math
 * that a test can exercise without a canvas, and this is the one file that
 * touches one.
 */

import type { ImageSourceCodec } from "./image-source"

type Canvas2D = {
  canvas: { width: number; height: number }
  context: {
    save(): void
    restore(): void
    translate(x: number, y: number): void
    rotate(radians: number): void
    scale(x: number, y: number): void
    drawImage(
      image: CanvasImageSource,
      x: number,
      y: number,
      width: number,
      height: number
    ): void
    getImageData(x: number, y: number, width: number, height: number): ImageData
  }
}

function surface(width: number, height: number): Canvas2D {
  const canvas =
    typeof OffscreenCanvas === "undefined"
      ? Object.assign(document.createElement("canvas"), { width, height })
      : new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d", {
    willReadFrequently: true,
  }) as Canvas2D["context"] | null
  if (!context) throw new Error("This browser could not draw that image.")
  return { canvas, context }
}

/**
 * The browser's own decoder and scaler. `imageSmoothingQuality` is left at
 * the default: what matters is that every drawing is made from the original,
 * which the open-once shape below is what guarantees.
 */
export function createCanvasImageCodec(): ImageSourceCodec {
  async function decode(bytes: Uint8Array, mime: string) {
    // Copied into a Blob of its own: the caller's array may be a view onto a
    // buffer it still owns.
    return await createImageBitmap(
      new Blob([bytes.slice() as BlobPart], { type: mime })
    )
  }
  return {
    async measure(bytes, mime) {
      const bitmap = await decode(bytes, mime)
      try {
        return { width: bitmap.width, height: bitmap.height }
      } finally {
        bitmap.close()
      }
    },
    async open(asset) {
      // Decoded once and held: every adjustment of a drag draws from this
      // bitmap rather than decoding the file again (06).
      const bitmap = await decode(asset.bytes, asset.mime)
      let open = true
      return {
        source: bitmap,
        close() {
          if (!open) return
          open = false
          bitmap.close()
        },
      }
    },
    async encode(image) {
      const { canvas, context } = surface(image.width, image.height)
      const data = new ImageData(
        new Uint8ClampedArray(
          image.pixels.buffer.slice(
            image.pixels.byteOffset,
            image.pixels.byteOffset + image.pixels.byteLength
          ) as ArrayBuffer
        ),
        image.width,
        image.height
      )
      ;(context as unknown as CanvasRenderingContext2D).putImageData(data, 0, 0)
      // PNG: the original has to come back exactly, or a transform would be
      // re-rendering from something the artist never gave us.
      const blob =
        canvas instanceof OffscreenCanvas
          ? await canvas.convertToBlob({ type: "image/png" })
          : await new Promise<Blob>((resolve, reject) =>
              (canvas as HTMLCanvasElement).toBlob(
                (result) =>
                  result ? resolve(result) : reject(new Error("no blob")),
                "image/png"
              )
            )
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        mime: "image/png",
      }
    },
  }
}
