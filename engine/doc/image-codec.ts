/**
 * The browser's own decoder and scaler, behind the `ImageSourceCodec` seam.
 *
 * Kept apart from `image-source.ts` for the reason its neighbour
 * `image-placement.ts` states about itself: the geometry is pure value math
 * that a test can exercise without a canvas, and this is the one file that
 * touches one.
 */

import { drawPlan, type ImageSourceCodec } from "./image-source"

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
 * The browser's own decoder and scaler. `imageSmoothingQuality` is left at the
 * default: the resampling that matters is the one from the original, and it
 * happens exactly once per commit however many adjustments preceded it.
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
    async render(asset, placement) {
      const plan = drawPlan(placement)
      const bitmap = await decode(asset.bytes, asset.mime)
      try {
        const { canvas, context } = surface(
          Math.max(1, plan.box.width),
          Math.max(1, plan.box.height)
        )
        context.save()
        context.translate(plan.centre.x, plan.centre.y)
        context.rotate(plan.rotation)
        context.scale(plan.scaleX, plan.scaleY)
        context.drawImage(
          bitmap,
          -plan.drawWidth / 2,
          -plan.drawHeight / 2,
          plan.drawWidth,
          plan.drawHeight
        )
        context.restore()
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
        return {
          origin: { x: plan.box.x, y: plan.box.y },
          image: {
            width: canvas.width,
            height: canvas.height,
            pixels: pixels.data,
          },
        }
      } finally {
        bitmap.close()
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
