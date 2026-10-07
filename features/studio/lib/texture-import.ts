"use client"

import type { SourceImage } from "@/engine/brush/source-image"
import type { BrushStore } from "./brush-store"
import {
  type ImportDeps,
  type ImportOutcome,
  importBrushFiles,
} from "./brush-import"
import type { ShippedTextures } from "./shipped-textures"
import { type GrayscaleTexture, toGrayscale } from "@/engine/brush/texture"
import { MAX_TEXTURE_DIMENSION } from "@/convex/lib/brush"

// Kept importable from here: this is where a file becomes a texture.
export { toGrayscale }

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

/** Past this an image is a photograph, not a tip, and is drawn smaller. */
const MAX_DECODED_SIDE = 4096

/**
 * Any image the browser can read, as RGBA pixels at (nearly) its own size:
 * the import (brush library 07) needs the source's size to size the brush,
 * and shrinks the texture itself.
 */
export async function decodeImage(bytes: Uint8Array): Promise<SourceImage> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
  try {
    const size = importedSize(bitmap.width, bitmap.height, MAX_DECODED_SIDE)
    const canvas = document.createElement("canvas")
    canvas.width = size.width
    canvas.height = size.height
    const ink = canvas.getContext("2d", { willReadFrequently: true })
    if (!ink) throw new Error("This browser could not read that image.")
    ink.drawImage(bitmap, 0, 0, size.width, size.height)
    const pixels = ink.getImageData(0, 0, size.width, size.height)
    return {
      width: size.width,
      height: size.height,
      channels: 4,
      pixels: new Uint8Array(pixels.data.buffer),
    }
  } finally {
    bitmap.close()
  }
}

/** Files as the import reads them: a name and its bytes. */
export function readFiles(
  files: readonly File[]
): Promise<{ name: string; bytes: Uint8Array }[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }))
  )
}

/**
 * The library's "Import brush…" as the studio runs it: into the artist's
 * store, with each texture also registered on the engine before the brush
 * naming it can be put in the hand.
 */
export async function studioImport(
  files: readonly File[],
  options: {
    store: BrushStore
    shipped: ShippedTextures
    register(id: string, texture: GrayscaleTexture): Promise<unknown>
  }
): Promise<ImportOutcome> {
  const { store, shipped, register } = options
  const isShipped = (id: string, kind: "tip" | "grain") =>
    shipped.ofKind(kind).find((texture) => texture.id === id)
  const deps: ImportDeps = {
    decodeImage,
    async saveTexture(name, texture) {
      const id = await store.saveTexture(name, texture)
      await register(id, texture)
      return id
    },
    save: (name, set, brush) => store.save(name, set, brush),
    async shippedTip(id) {
      const entry = isShipped(id, "tip")
      const texture = entry && (await shipped.load(id))
      if (!entry || !texture) return undefined
      return {
        width: texture.width,
        height: texture.height,
        selection: entry.selection,
      }
    },
    shippedGrain: (id) => isShipped(id, "grain") !== undefined,
  }
  return importBrushFiles(await readFiles(files), deps)
}
