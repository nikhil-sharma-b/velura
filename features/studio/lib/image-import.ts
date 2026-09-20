"use client"

import type { Engine } from "@/engine"

/**
 * Bringing a picture in from a file: a reference photo, a scan to trace over,
 * a plate to paint on top of.
 *
 * The file's own bytes go to the engine, not a decoded and scaled buffer. A
 * placed image keeps the picture it came from (06), so every later move and
 * scale is rendered from the original rather than from the last render of it;
 * the decoding and the scaler are still the browser's, in the engine's image
 * codec, where the split `texture-import` makes is kept.
 */

/** A file's name without its extension: what the layer ends up called. */
export function layerNameForFile(fileName: string): string {
  const trimmed = fileName.replace(/\.[^.]+$/, "").trim()
  return trimmed === "" ? "Image" : trimmed
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
 * Puts a file on a layer of its own, centred in the artwork rather than in the
 * window: an image is placed in the document, not in the view of it.
 */
export async function placeImageFile(
  engine: Engine,
  file: File
): Promise<void> {
  await engine.dispatch({
    type: "placeImage",
    file: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      // A file dragged from a place that did not say what it was: the decoder
      // sniffs the bytes, so an empty type is not a reason to refuse it.
      mime: file.type || "application/octet-stream",
    },
    name: layerNameForFile(file.name),
  })
}
