/**
 * The write-back half of local-first storage (§9.2).
 *
 * A completed stroke is on disk before the artist has lifted their attention
 * from it: history commits, this hears about it, and the tiles the commit
 * touched are written and named by a fresh manifest. Nothing is debounced,
 * because the whole durability claim rests on that write having happened.
 *
 * What keeps it cheap is content addressing. The tiles come out of the same
 * `TileStore` that undo is holding them in, and a tile whose hash is already
 * on the device is not written again — so a stroke that touched three tiles
 * costs three blobs however large the document is, and reopening never has to
 * decide whether a cached tile is stale (D14).
 */

import type { ImageAssetRef } from "../doc/image-source"
import type { DocumentStructure } from "../doc/structure"
import type {
  AssetSource,
  DocumentManifest,
  DocumentStore,
  TileSource,
} from "./document-store"
import { MANIFEST_VERSION, type SurfaceTiles } from "./document-store"

/** The document as persistence needs it, asked for at the moment of saving. */
export type DocumentSnapshot = {
  width: number
  height: number
  name?: string
  structure: DocumentStructure
  surfaces: readonly SurfaceTiles[]
  /** The originals placed images were made from (06). */
  assets?: readonly ImageAssetRef[]
}

export interface DocumentPersistence {
  /** Writes the document as it stands. Overlapping calls coalesce into one. */
  save(): Promise<void>
  /** What a save would write, without writing it. */
  manifest(): DocumentManifest
  /** Waits for saves still in flight, including one a commit just queued. */
  settle(): Promise<void>
  /** The stored document, or null where this device has never held it. */
  load(): Promise<DocumentManifest | null>
}

export function createDocumentPersistence(options: {
  documentId: string
  store: DocumentStore
  /** The document, read at save time so a queued save writes current pixels. */
  snapshot: () => DocumentSnapshot
  /** Texels by hash — the live tile store, so undo and disk share one copy. */
  tiles: TileSource
  /** An original's file bytes by id, for the assets the snapshot names. */
  assets?: AssetSource
  /** Told when a save fails. Losing durability is not a silent condition. */
  onError?: (error: unknown) => void
}): DocumentPersistence {
  let running: Promise<void> | undefined
  /** A save asked for while one was in flight: run once more, not once each. */
  let queued = false

  function manifest(): DocumentManifest {
    const document = options.snapshot()
    return {
      version: MANIFEST_VERSION,
      id: options.documentId,
      ...(document.name ? { name: document.name } : {}),
      width: document.width,
      height: document.height,
      structure: document.structure,
      surfaces: document.surfaces,
      ...(document.assets && document.assets.length > 0
        ? { assets: document.assets }
        : {}),
      updatedAt: Date.now(),
    }
  }

  async function write() {
    do {
      queued = false
      await options.store.save(manifest(), options.tiles, options.assets)
      // A commit that landed mid-save is not covered by the manifest just
      // written, so the loop goes round rather than leaving it unsaved.
    } while (queued)
  }

  function save(): Promise<void> {
    if (running) {
      queued = true
      return running
    }
    running = write()
      .catch((error) => options.onError?.(error))
      .finally(() => {
        running = undefined
      })
    return running
  }

  return {
    save,
    manifest,
    async settle() {
      while (running) await running
    },
    load: () => options.store.load(options.documentId),
  }
}
