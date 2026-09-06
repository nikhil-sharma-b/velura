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
    /** Bumped by every flush from any device — what "newer elsewhere" means. */
    updatedAt: number
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

/**
 * Genuine upload state, never an optimistic guess: "fully-synced" only holds
 * once a flush has actually committed exactly what the document now looks
 * like, and a single new stroke — or a flush that fails partway — drops it
 * back to "saved-locally" until the next flush closes the gap.
 */
export type SyncStatus = "saved-locally" | "syncing" | "fully-synced"

export interface CloudSync {
  /** Uploads whatever has changed since the last flush. Overlapping calls coalesce. */
  flush(): Promise<void>
  /** Waits for a flush in flight, including one a commit just queued. */
  settle(): Promise<void>
  metrics(): SyncMetrics
  status(): SyncStatus
}

export function createCloudSync(options: {
  remote: RemoteIndex
  snapshot: () => DocumentSnapshot
  tiles: TileSource
  /** Uploads bytes to a presigned URL. Overridable for tests; defaults to fetch PUT. */
  put?: (url: string, bytes: Uint8Array) => Promise<void>
  onError?: (error: unknown) => void
  /** Told whenever `status()` may have changed, so a host can re-read it. */
  onStatusChange?: () => void
}): CloudSync {
  const put = options.put ?? fetchPut
  let running: Promise<void> | undefined
  let queued = false
  let putCount = 0
  let mutationCount = 0
  // The key of the last snapshot a flush actually committed in full. Compared
  // against the current snapshot's key, this is what makes "fully-synced"
  // an observation rather than a guess: it only holds while nothing painted
  // since has changed what a flush would upload.
  let syncedKey: string | undefined

  function allTiles(surfaces: readonly SurfaceTiles[]): readonly TileRef[] {
    return surfaces.flatMap((surface) => surface.tiles)
  }

  function keyOf(document: DocumentSnapshot): string {
    return JSON.stringify({
      structure: document.structure,
      surfaces: document.surfaces.map((surface) => ({
        surfaceId: surface.surfaceId,
        tiles: [...surface.tiles]
          .sort((a, b) => a.x - b.x || a.y - b.y)
          .map((tile) => `${tile.x},${tile.y}:${tile.hash}`),
      })),
    })
  }

  async function write() {
    do {
      queued = false
      const document = options.snapshot()
      const refs = allTiles(document.surfaces)
      if (refs.length === 0) continue

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

      await options.remote.commitFlush({
        tiles: document.surfaces.flatMap((surface) =>
          surface.tiles.map((tile) => ({
            surfaceId: surface.surfaceId,
            ...tile,
          }))
        ),
        uploaded,
        structure: document.structure,
        metrics: { putCount, mutationCount: mutationCount + 1 },
      })
      mutationCount++
      // This exact snapshot is now on the server, whether or not a later
      // round of the loop moves past it.
      syncedKey = keyOf(document)
      options.onStatusChange?.()
      // A commit that landed mid-flush is not covered by the snapshot just
      // uploaded, so the loop goes round rather than leaving it unsynced.
    } while (queued)
  }

  function flush(): Promise<void> {
    if (running) {
      queued = true
      return running
    }
    options.onStatusChange?.()
    running = write()
      .catch((error) => options.onError?.(error))
      .finally(() => {
        running = undefined
        options.onStatusChange?.()
      })
    return running
  }

  return {
    flush,
    async settle() {
      while (running) await running
    },
    metrics: () => ({ putCount, mutationCount }),
    status() {
      if (running) return "syncing"
      return keyOf(options.snapshot()) === syncedKey
        ? "fully-synced"
        : "saved-locally"
    },
  }
}

async function fetchPut(url: string, bytes: Uint8Array): Promise<void> {
  const response = await fetch(url, { method: "PUT", body: bytes as BodyInit })
  if (!response.ok) {
    throw new Error(
      `Tile upload failed: ${response.status} ${response.statusText}`
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
