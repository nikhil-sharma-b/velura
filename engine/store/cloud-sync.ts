/**
 * The upload half of cloud sync (§9.2). Local persistence (D14) already put
 * every stroke on disk immediately; this only has to get those same
 * content-addressed tiles into R2, without costing a write per stroke.
 *
 * Three calls per flush, no matter how many tiles changed:
 *   1. ask which of the changed hashes the server has never seen (a Convex
 *      query, not an R2 HeadObject — R2 ops are the metered resource)
 *   2. mint one batch of presigned PUTs for the missing hashes
 *   3. one mutation to upsert the tile index rows and log the flush
 *
 * Retrying a flush after a dropped response costs nothing extra: PUTs are
 * keyed by content hash (uploading the same bytes twice is a no-op at the
 * object store), and the index upsert is idempotent by construction.
 */

import type { DocumentStructure } from "../doc/structure"
import type {
  DocumentManifest,
  DocumentStore,
  SurfaceTiles,
  TileRef,
} from "./document-store"
import type { TileSource } from "./document-store"
import { decodeTile, encodeTile } from "./tile-codec"

export type DocumentSnapshot = {
  structure: DocumentStructure
  surfaces: readonly SurfaceTiles[]
}

/** What cloud sync needs from the backend. Convex in production, a fake in tests. */
export interface RemoteIndex {
  missingHashes(hashes: readonly string[]): Promise<readonly string[]>
  presignUploads(
    hashes: readonly string[]
  ): Promise<readonly { hash: string; url: string }[]>
  /** One mutable object per document; the document row versions its URL. */
  presignPreviewUpload?(): Promise<string>
  /** Publishes a preview only after its object upload has succeeded. */
  commitPreview?(): Promise<void>
  commitFlush(payload: {
    tiles: readonly { surfaceId: string; x: number; y: number; hash: string }[]
    uploaded: readonly { hash: string; size: number }[]
    structure: DocumentStructure
    metrics: { putCount: number; mutationCount: number }
  }): Promise<void>
  /** The document's size, name and layer tree — everything but pixels (§9.3). */
  documentMeta(): Promise<{
    width: number
    height: number
    name?: string
    structure: DocumentStructure | null
  }>
  /** Every tile this document currently names, across every surface. */
  tileIndex(): Promise<
    readonly { surfaceId: string; x: number; y: number; hash: string }[]
  >
  presignDownloads(
    hashes: readonly string[]
  ): Promise<readonly { hash: string; url: string }[]>
}

/** Cumulative R2/Convex operation counts for one painting session (§9.6). */
export type SyncMetrics = Readonly<{ putCount: number; mutationCount: number }>

export interface CloudSync {
  /** Uploads whatever has changed since the last flush. Overlapping calls coalesce. */
  flush(): Promise<void>
  /** Waits for a flush in flight, including one a commit just queued. */
  settle(): Promise<void>
  metrics(): SyncMetrics
}

export function createCloudSync(options: {
  remote: RemoteIndex
  snapshot: () => DocumentSnapshot
  tiles: TileSource
  /** A flattened, display-transformed PNG. Generated only when a flush runs. */
  preview?: () => Promise<Uint8Array>
  /** Uploads bytes to a presigned URL. Overridable for tests; defaults to fetch PUT. */
  put?: (url: string, bytes: Uint8Array, contentType?: string) => Promise<void>
  onError?: (error: unknown) => void
}): CloudSync {
  const put = options.put ?? fetchPut
  let running: Promise<void> | undefined
  let queued = false
  let putCount = 0
  let mutationCount = 0

  function allTiles(surfaces: readonly SurfaceTiles[]): readonly TileRef[] {
    return surfaces.flatMap((surface) => surface.tiles)
  }

  async function write() {
    do {
      queued = false
      const document = options.snapshot()
      const refs = allTiles(document.surfaces)

      const hashes = [...new Set(refs.map((tile) => tile.hash))]
      const missing = await options.remote.missingHashes(hashes)

      const uploaded: { hash: string; size: number }[] = []
      if (missing.length > 0) {
        const urls = await options.remote.presignUploads(missing)
        await Promise.all(
          urls.map(async ({ hash, url }) => {
            const bytes = await encodeTile(await options.tiles(hash))
            await put(url, bytes)
            putCount++
            uploaded.push({ hash, size: bytes.byteLength })
          })
        )
      }

      const preview =
        options.preview &&
        options.remote.presignPreviewUpload &&
        options.remote.commitPreview
          ? Promise.all([
              options.preview(),
              options.remote.presignPreviewUpload(),
            ] as const)
          : undefined

      await options.remote.commitFlush({
        tiles: document.surfaces.flatMap((surface) =>
          surface.tiles.map((tile) => ({
            surfaceId: surface.surfaceId,
            ...tile,
          }))
        ),
        uploaded,
        structure: document.structure,
        metrics: {
          putCount: putCount + (preview ? 1 : 0),
          mutationCount: mutationCount + (preview ? 2 : 1),
        },
      })
      mutationCount++
      // The index mutation lands before the preview upload (§9.2). Generation
      // starts alongside tile work, but none of it runs in a drawing frame.
      if (preview) {
        const [bytes, url] = await preview
        await put(url, bytes, "image/png")
        putCount++
        await options.remote.commitPreview!()
        mutationCount++
      }
      // A commit that landed mid-flush is not covered by the snapshot just
      // uploaded, so the loop goes round rather than leaving it unsynced.
    } while (queued)
  }

  function flush(): Promise<void> {
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
    flush,
    async settle() {
      while (running) await running
    },
    metrics: () => ({ putCount, mutationCount }),
  }
}

async function fetchPut(
  url: string,
  bytes: Uint8Array,
  contentType?: string
): Promise<void> {
  const response = await fetch(url, {
    method: "PUT",
    body: bytes as BodyInit,
    ...(contentType ? { headers: { "Content-Type": contentType } } : {}),
  })
  if (!response.ok) {
    throw new Error(
      `Object upload failed: ${response.status} ${response.statusText}`
    )
  }
}

async function fetchGet(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(
      `Tile download failed: ${response.status} ${response.statusText}`
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * A fresh session with no local cache reads its document straight from the
 * cloud (§9.3): the tile index and layer tree come from Convex, the pixels
 * behind each hash from R2, and the result is written into local storage
 * through the same `DocumentStore.save` local persistence already uses — so
 * a tile the device happens to already hold (recompressed after a crash, a
 * shared hash from another document) costs no download at all.
 *
 * Returns null where the document has never been flushed to the cloud —
 * nothing to hydrate, not an error.
 */
export async function hydrateFromRemote(options: {
  documentId: string
  remote: RemoteIndex
  local: DocumentStore
  get?: (url: string) => Promise<Uint8Array>
}): Promise<DocumentManifest | null> {
  const get = options.get ?? fetchGet
  const [meta, rows] = await Promise.all([
    options.remote.documentMeta(),
    options.remote.tileIndex(),
  ])
  if (meta.structure === null || rows.length === 0) return null

  const bySurface = new Map<string, TileRef[]>()
  for (const row of rows) {
    const list = bySurface.get(row.surfaceId) ?? []
    list.push({ x: row.x, y: row.y, hash: row.hash })
    bySurface.set(row.surfaceId, list)
  }
  const surfaces: SurfaceTiles[] = [...bySurface].map(([surfaceId, tiles]) => ({
    surfaceId,
    tiles,
  }))

  const manifest: DocumentManifest = {
    version: 1,
    id: options.documentId,
    ...(meta.name ? { name: meta.name } : {}),
    width: meta.width,
    height: meta.height,
    structure: meta.structure,
    surfaces,
    updatedAt: Date.now(),
  }

  // Only mint GETs for hashes this device does not already hold — the same
  // "OPFS hit skips the network" rule §9.3 states for the read path, and the
  // reason `DocumentStore.save` below is safe to call with a manifest naming
  // tiles this device may already have under a different document.
  const uniqueHashes = [...new Set(rows.map((row) => row.hash))]
  const needed = (
    await Promise.all(
      uniqueHashes.map(async (hash) =>
        (await options.local.has(hash)) ? null : hash
      )
    )
  ).filter((hash): hash is string => hash !== null)

  const urlByHash = new Map(
    needed.length > 0
      ? (await options.remote.presignDownloads(needed)).map(({ hash, url }) => [
          hash,
          url,
        ])
      : []
  )

  await options.local.save(manifest, async (hash) => {
    const url = urlByHash.get(hash)
    if (!url) throw new Error(`No download URL minted for tile ${hash}`)
    return decodeTile(await get(url))
  })

  return manifest
}
