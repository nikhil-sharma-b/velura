/**
 * A document on local disk: a manifest of tile hashes, plus the tiles.
 *
 * The manifest is written last and only ever names tiles already on the
 * device, so an interrupted save leaves the previous manifest intact and the
 * partial tiles unreferenced. That is what makes a crash cost the stroke in
 * flight at worst, never the document.
 *
 * Tiles are keyed by content hash alone — not by document, layer or step —
 * so the same pixels stored twice cost one blob, and a blob once written is
 * never rewritten or invalidated (D14).
 */

import type { DocumentStructure } from "../doc/structure"
import type { BlobStore } from "./blob-store"
import { decodeTile, encodeTile } from "./tile-codec"

/** One tile of one surface, by grid coordinate and by content. */
export type TileRef = Readonly<{ x: number; y: number; hash: string }>

/** One tile of one surface, named across surfaces: what an index row is. */
export type SurfaceTileRef = TileRef & Readonly<{ surfaceId: string }>

/** Every tile a layer or mask holds. Absent tiles are transparent. */
export type SurfaceTiles = Readonly<{
  surfaceId: string
  tiles: readonly TileRef[]
}>

export type DocumentManifest = Readonly<{
  /** Bumped when the shape below changes; older manifests are not loaded. */
  version: 1
  id: string
  name?: string
  width: number
  height: number
  /** The layer tree without pixels, exactly as history snapshots it. */
  structure: DocumentStructure
  surfaces: readonly SurfaceTiles[]
  updatedAt: number
}>

export const MANIFEST_VERSION = 1

const manifestKey = (id: string) => `documents/${id}`
const tileKeyFor = (hash: string) => `tiles/${hash}`

/** Where the tiles a manifest names are read from while they are still in RAM. */
export type TileSource = (hash: string) => Promise<Uint16Array>

export interface DocumentStore {
  /**
   * Writes the tiles the manifest names that are not already on the device,
   * then the manifest. Returns how many blobs the save actually cost, which
   * is what dedup is measured by.
   */
  save(manifest: DocumentManifest, tiles: TileSource): Promise<number>
  load(id: string): Promise<DocumentManifest | null>
  /** The texels behind one hash, or null where the device does not hold it. */
  readTile(hash: string): Promise<Uint16Array | null>
  has(hash: string): Promise<boolean>
  /** Every stored manifest id. Content blobs are deliberately excluded. */
  list(): Promise<DocumentManifest[]>
  /** Removes only if no save advanced the manifest since the caller read it. */
  removeIfUnchanged(manifest: DocumentManifest): Promise<boolean>
}

export function createDocumentStore(blobs: BlobStore): DocumentStore {
  return {
    async save(manifest, tiles) {
      // One tile referenced by two layers, or by two coordinates of one, is
      // one blob: the write set is hashes, not placements.
      const hashes = new Set(
        manifest.surfaces.flatMap((surface) =>
          surface.tiles.map((tile) => tile.hash)
        )
      )
      let written = 0
      // Tiles first. A manifest may only name pixels that are already down.
      await Promise.all(
        [...hashes].map(async (hash) => {
          const key = tileKeyFor(hash)
          // Immutable by construction, so a hash already on disk is the same
          // bytes and never needs rewriting or checking.
          if (await blobs.has(key)) return
          await blobs.put(key, await encodeTile(await tiles(hash)))
          written++
        })
      )
      await blobs.put(
        manifestKey(manifest.id),
        new TextEncoder().encode(JSON.stringify(manifest))
      )
      return written
    },
    async load(id) {
      const bytes = await blobs.get(manifestKey(id))
      if (!bytes) return null
      // A manifest this build cannot read — a future version, or the bytes a
      // half-written save left behind — is treated as absent rather than
      // half-applied: the artist gets an empty canvas, not a broken document.
      try {
        const manifest = JSON.parse(
          new TextDecoder().decode(bytes)
        ) as DocumentManifest
        return manifest.version === MANIFEST_VERSION ? manifest : null
      } catch {
        return null
      }
    },
    async readTile(hash) {
      const bytes = await blobs.get(tileKeyFor(hash))
      // A tile a manifest names but the device no longer holds is a hole in
      // the document, not a broken document: the rest of the work still opens.
      return bytes ? decodeTile(bytes) : null
    },
    has: (hash) => blobs.has(tileKeyFor(hash)),
    async list() {
      const manifests = await Promise.all(
        (await blobs.keys())
          .filter((key) => key.startsWith("documents/"))
          .sort()
          .map((key) => this.load(key.slice("documents/".length)))
      )
      return manifests.filter(
        (manifest): manifest is DocumentManifest => manifest !== null
      )
    },
    async removeIfUnchanged(manifest) {
      return await blobs.compareAndRemove(
        manifestKey(manifest.id),
        new TextEncoder().encode(JSON.stringify(manifest))
      )
    },
  }
}
