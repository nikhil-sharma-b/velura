"use client"

import type { Engine } from "@/engine"
import { fitPlacement, type SourceImage } from "@/engine/doc/image-tiles"

/**
 * Bringing a picture in from a file: a reference photo, a scan to trace over,
 * a plate to paint on top of.
 *
 * The resampling is the browser's, done once here at the size the image will
 * be drawn at, rather than the engine carrying a scaler of its own — the same
 * split `texture-import` makes, where the decode is the platform's and every
 * decision around it is ours and testable.
 */

/** A file's name without its extension: what the layer ends up called. */
export function layerNameForFile(fileName: string): string {
  const trimmed = fileName.replace(/\.[^.]+$/, "").trim()
  return trimmed === "" ? "Image" : trimmed
}

export async function readImageFile(
  file: Blob,
  canvas: { width: number; height: number }
): Promise<SourceImage> {
  const bitmap = await createImageBitmap(file)
  try {
    // Only the size is taken from the placement here; where it lands is the
    // engine's to decide, so the two cannot disagree about the centre.
    const size = fitPlacement(bitmap, canvas)
    const surface = document.createElement("canvas")
    surface.width = size.width
    surface.height = size.height
    const ink = surface.getContext("2d", { willReadFrequently: true })
    if (!ink) throw new Error("This browser could not read that image.")
    ink.drawImage(bitmap, 0, 0, size.width, size.height)
    const pixels = ink.getImageData(0, 0, size.width, size.height)
    return { width: size.width, height: size.height, pixels: pixels.data }
  } finally {
    bitmap.close()
  }
}

/**
 * The image in a drop or a paste, if there is one. Both hand over a
 * `DataTransfer`, so both arrive here: a file dragged off the desktop, a
 * screenshot on the clipboard, an image dragged out of another tab.
 *
 * `files` alone is not enough — a copied screenshot reaches the clipboard as
 * an item with no file list behind it in some browsers — so the items are the
 * fallback rather than the other way round.
 */
export function firstImageFile(transfer: DataTransfer | null): File | null {
  if (!transfer) return null
  for (const file of transfer.files)
    if (file.type.startsWith("image/")) return file
  for (const item of transfer.items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (file) return file
  }
  return null
}

/**
 * Whether a drag in flight is carrying a file at all. A drag does not let its
 * contents be read until it is dropped — that is the browser's own privacy
 * rule, not an oversight — so this is as much as the hint over the canvas can
 * honestly know, and whether the file was an image is answered on the drop.
 */
export function dragCarriesFile(transfer: DataTransfer | null): boolean {
  if (!transfer) return false
  return (
    [...transfer.items].some((item) => item.kind === "file") ||
    [...transfer.types].includes("Files")
  )
}

/**
 * Puts a file on a layer of its own, at the document's size rather than the
 * window's: an image is placed in the artwork, not in the view of it.
 */
export async function placeImageFile(
  engine: Engine,
  file: File
): Promise<void> {
  const { width, height } = engine.getSnapshot()
  const image = await readImageFile(file, { width, height })
  await engine.dispatch({
    type: "placeImage",
    image,
    name: layerNameForFile(file.name),
  })
}
