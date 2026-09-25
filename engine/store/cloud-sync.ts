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

import type { ImageAssetRef } from "../doc/image-source"
import { structureAssets, type DocumentStructure } from "../doc/structure"
import type {
  DocumentManifest,
  DocumentStore,
  SurfaceTileRef,
  SurfaceTiles,
  TileRef,
} from "./document-store"
import type { AssetSource, TileSource } from "./document-store"
import { decodeTile, encodeTile } from "./tile-codec"

export type DocumentSnapshot = {
  structure: DocumentStructure
  surfaces: readonly SurfaceTiles[]
  /** The originals placed images were made from (06). */
  assets?: readonly ImageAssetRef[]
}

/** What cloud sync needs from the backend. Convex in production, a fake in tests. */
export interface RemoteIndex {
  missingHashes(hashes: readonly string[]): Promise<readonly string[]>
  presignUploads(
    hashes: readonly string[]
  ): Promise<readonly { hash: string; url: string }[]>
  /**
   * The same batch mint for the originals placed images keep (06). They are
   * content-addressed like tiles and share the dedup ledger, but they are
   * whole files rather than tiles, so they are objects of their own kind —
   * and an id is not a tile hash, so it is not called one.
   */
  presignAssetUploads(
    ids: readonly string[]
  ): Promise<readonly { id: string; url: string }[]>
  presignAssetDownloads(
    ids: readonly string[]
  ): Promise<readonly { id: string; url: string }[]>
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
    /** Bumped by every flush from any device — what "newer elsewhere" means. */
    updatedAt: number
    /** Absent until a preview has landed; the library shows none without it. */
    previewVersion?: number
  }>
  /** Every tile this document currently names, across every surface. */
  tileIndex(): Promise<
    readonly { surfaceId: string; x: number; y: number; hash: string }[]
  >
  presignDownloads(
    hashes: readonly string[]
  ): Promise<readonly { hash: string; url: string }[]>
  /** Restore points for this document, newest first (§9.4). */
  listVersions(): Promise<readonly RestorePoint[]>
  /** One restore point in full: the tree it had and the tiles it named. */
  versionSnapshot(versionId: string): Promise<VersionSnapshot>
}

/** A restore point as the artist picks one: a time, and a handle to fetch it by. */
export type RestorePoint = Readonly<{ id: string; createdAt: number }>

export type VersionSnapshot = Readonly<{
  structure: DocumentStructure
  tiles: readonly SurfaceTileRef[]
}>

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

export type UploadRetryOptions = {
  attempts?: number
  baseDelayMs?: number
  sleep?: (delayMs: number) => Promise<void>
}

export function createCloudSync(options: {
  remote: RemoteIndex
  snapshot: () => DocumentSnapshot
  tiles: TileSource
  /** An original's file bytes by id, for the assets a snapshot names. */
  assets?: AssetSource
  /** A flattened, display-transformed PNG. Generated only when a flush runs. */
  preview?: () => Promise<Uint8Array>
  /** Uploads bytes to a presigned URL. Overridable for tests; defaults to fetch PUT. */
  put?: (url: string, bytes: Uint8Array, contentType?: string) => Promise<void>
  onError?: (error: unknown) => void
  /** Told whenever `status()` may have changed, so a host can re-read it. */
  onStatusChange?: () => void
  /** Bounded upload retry policy. Overridable so tests need no real clock. */
  retry?: UploadRetryOptions
}): CloudSync {
  const put = options.put ?? fetchPut
  const attempts = Math.max(1, options.retry?.attempts ?? 4)
  const baseDelayMs = Math.max(0, options.retry?.baseDelayMs ?? 500)
  const sleep =
    options.retry?.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)))
  let running: Promise<void> | undefined
  let queued = false
  let putCount = 0
  let mutationCount = 0
  // The key of the last snapshot a flush actually committed in full. Compared
  // against the current snapshot's key, this is what makes "fully-synced"
  // an observation rather than a guess: it only holds while nothing painted
  // since has changed what a flush would upload.
  let syncedKey: string | undefined

  async function upload(
    url: string,
    bytes: Uint8Array,
    contentType?: string
  ): Promise<void> {
    let cause: unknown
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await put(url, bytes, contentType)
        return
      } catch (error) {
        cause = error
        if (attempt < attempts) await sleep(baseDelayMs * 2 ** (attempt - 1))
      }
    }
    throw new Error(
      `Upload still failed after ${attempts} attempts. Retry when the connection is stable.`,
      { cause }
    )
  }

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

      const assets = options.assets
        ? (document.assets ?? structureAssets(document.structure))
        : []

      const hashes = [...new Set(refs.map((tile) => tile.hash))]
      // One dedup check for both kinds: an id is a content hash either way,
      // and the ledger the answer comes from does not care what the bytes
      // behind one are.
      const missing = await options.remote.missingHashes([
        ...hashes,
        ...assets.map((asset) => asset.id),
      ])
      const wanted = new Set(missing)

      const uploaded: { hash: string; size: number }[] = []
      const missingTiles = hashes.filter((hash) => wanted.has(hash))
      if (missingTiles.length > 0) {
        const urls = await options.remote.presignUploads(missingTiles)
        await Promise.all(
          urls.map(async ({ hash, url }) => {
            const bytes = await encodeTile(await options.tiles(hash))
            await upload(url, bytes)
            putCount++
            uploaded.push({ hash, size: bytes.byteLength })
          })
        )
      }
      const missingAssets = assets.filter((asset) => wanted.has(asset.id))
      if (missingAssets.length > 0) {
        const urls = await options.remote.presignAssetUploads(
          missingAssets.map((asset) => asset.id)
        )
        const mimes = new Map(
          missingAssets.map((asset) => [asset.id, asset.mime])
        )
        await Promise.all(
          urls.map(async ({ id, url }) => {
            const bytes = await options.assets!(id)
            await upload(url, bytes, mimes.get(id))
            putCount++
            // The dedup ledger is one ledger: an id is confirmed uploaded
            // the same way a tile hash is.
            uploaded.push({ hash: id, size: bytes.byteLength })
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
        await upload(url, bytes, "image/png")
        putCount++
        await options.remote.commitPreview!()
        mutationCount++
      }
      // This exact snapshot, including its preview where configured, is now
      // on the server whether or not a later loop round moves past it.
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
 * The pixels behind a restore point, by hash.
 *
 * A version names tiles, never copies them (§9.4), so most of what it names
 * is already on this device — the tiles the document still holds, and every
 * tile any session since has cached. Only the genuinely absent ones are
 * fetched, which is what makes going back an hour cost about what that hour
 * painted rather than the size of the document.
 *
 * A hash neither held nor downloadable is left out rather than thrown over:
 * a hole in a restored state is still worth showing, the way a hole in a
 * reopened document is.
 */
export async function loadVersionTiles(options: {
  remote: RemoteIndex
  local: Pick<DocumentStore, "readTile">
  hashes: readonly string[]
  get?: (url: string) => Promise<Uint8Array>
}): Promise<Map<string, Uint16Array>> {
  const get = options.get ?? fetchGet
  const texels = new Map<string, Uint16Array>()
  const missing: string[] = []

  await Promise.all(
    [...new Set(options.hashes)].map(async (hash) => {
      const held = await options.local.readTile(hash)
      if (held) texels.set(hash, held)
      else missing.push(hash)
    })
  )
  if (missing.length === 0) return texels

  const urls = await options.remote.presignDownloads(missing)
  await Promise.all(
    urls.map(async ({ hash, url }) => {
      texels.set(hash, await decodeTile(await get(url)))
    })
  )
  return texels
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

  // The originals the tree names (06), so a document opened on a second
  // machine can be moved and scaled there, not only looked at.
  const assets = structureAssets(meta.structure)
  const manifest: DocumentManifest = {
    version: 1,
    id: options.documentId,
    ...(meta.name ? { name: meta.name } : {}),
    width: meta.width,
    height: meta.height,
    structure: meta.structure,
    surfaces,
    ...(assets.length > 0 ? { assets } : {}),
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

  // An original this device already holds is not fetched again: same content
  // addressing, same rule as the tiles above.
  const neededAssets = (
    await Promise.all(
      assets.map(async (asset) =>
        (await options.local.readAsset(asset.id)) ? null : asset.id
      )
    )
  ).filter((id): id is string => id !== null)
  const urlByAsset = new Map(
    neededAssets.length > 0
      ? (await options.remote.presignAssetDownloads(neededAssets)).map(
          ({ id, url }) => [id, url]
        )
      : []
  )

  await options.local.save(
    manifest,
    async (hash) => {
      const url = urlByHash.get(hash)
      if (!url) throw new Error(`No download URL minted for tile ${hash}`)
      return decodeTile(await get(url))
    },
    async (id) => {
      const url = urlByAsset.get(id)
      if (!url) throw new Error(`No download URL minted for image ${id}`)
      return await get(url)
    }
  )

  return manifest
}
