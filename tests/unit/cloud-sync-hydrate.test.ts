import { describe, expect, test } from "bun:test"

import {
  createCloudSync,
  hydrateFromRemote,
  type RemoteIndex,
} from "../../engine/store/cloud-sync"
import { createMemoryBlobStore } from "../../engine/store/blob-store"
import { createDocumentStore } from "../../engine/store/document-store"
import type { DocumentStructure } from "../../engine/doc/structure"
import { decodeTile, encodeTile } from "../../engine/store/tile-codec"
import { surfaces } from "./helpers/cloud-sync-fixtures"

const STRUCTURE: DocumentStructure = {
  layers: [
    {
      id: "layer-1",
      kind: "raster",
      name: "Layer 1",
      opacity: 1,
      visible: true,
      blend: "normal",
      clip: false,
    },
  ],
  activeLayerId: "layer-1",
  paintingMask: false,
}

/** A minimal cloud: a hash→bytes store plus a per-document tile index and metadata, mirroring what Convex + R2 hold together. */
function createFakeCloud() {
  const blobs = new Map<string, Uint8Array>()
  const tiles: { surfaceId: string; x: number; y: number; hash: string }[] = []
  let structure: DocumentStructure | null = null
  const size = { width: 512, height: 256 }

  const remote: RemoteIndex = {
    async missingHashes(hashes) {
      return hashes.filter((hash) => !blobs.has(hash))
    },
    async presignUploads(hashes) {
      return hashes.map((hash) => ({ hash, url: `put:${hash}` }))
    },
    async listVersions() {
      return []
    },
    async versionSnapshot() {
      throw new Error("This fake keeps no restore points.")
    },
    async presignDownloads(hashes) {
      return hashes.map((hash) => ({ hash, url: `get:${hash}` }))
    },
    async presignAssetUploads(ids) {
      return ids.map((id) => ({ id, url: `put:${id}` }))
    },
    async presignAssetDownloads(ids) {
      return ids.map((id) => ({ id, url: `get:${id}` }))
    },
    async commitFlush(payload) {
      for (const tile of payload.tiles) {
        const existing = tiles.find(
          (t) =>
            t.surfaceId === tile.surfaceId && t.x === tile.x && t.y === tile.y
        )
        if (existing) existing.hash = tile.hash
        else tiles.push({ ...tile })
      }
      structure = payload.structure
    },
    async documentMeta() {
      return { ...size, structure, updatedAt: 0 }
    },
    async tileIndex() {
      return tiles
    },
  }

  const put = async (url: string, bytes: Uint8Array) => {
    blobs.set(url.slice(4), bytes)
  }
  const get = async (url: string) => {
    const bytes = blobs.get(url.slice(4))
    if (!bytes) throw new Error(`no such object: ${url}`)
    return bytes
  }

  return { remote, put, get }
}

function texelsFor(hash: string) {
  return new Uint16Array(4).fill(hash.charCodeAt(hash.length - 1))
}

describe("hydrate", () => {
  test("a document flushed in one session opens complete in a fresh local store", async () => {
    const cloud = createFakeCloud()
    const doc = surfaces([
      { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
      { surfaceId: "layer-1", x: 1, y: 0, hash: "hash-b" },
    ])

    // Session A: paints, flushes to the cloud.
    const sync = createCloudSync({
      remote: cloud.remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: cloud.put,
    })
    await sync.flush()

    // Session B: a different device, an empty local blob store.
    const freshLocal = createDocumentStore(createMemoryBlobStore())
    const manifest = await hydrateFromRemote({
      documentId: "doc-1",
      remote: cloud.remote,
      local: freshLocal,
      get: cloud.get,
    })

    expect(manifest).not.toBeNull()
    expect(manifest?.structure).toEqual(STRUCTURE)
    expect(manifest?.width).toBe(512)
    expect(manifest?.height).toBe(256)

    const reopened = await freshLocal.load("doc-1")
    expect(reopened?.surfaces).toEqual(doc)
    expect(await freshLocal.readTile("hash-a")).toEqual(texelsFor("hash-a"))
    expect(await freshLocal.readTile("hash-b")).toEqual(texelsFor("hash-b"))
  })

  test("a hydrated copy is dated by the server's clock, so it reads as in step with it", async () => {
    const cloud = createFakeCloud()
    cloud.remote.documentMeta = async () => ({
      width: 512,
      height: 256,
      structure: STRUCTURE,
      updatedAt: 1_000,
    })
    await createCloudSync({
      remote: cloud.remote,
      snapshot: () => ({
        structure: STRUCTURE,
        surfaces: surfaces([
          { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
        ]),
      }),
      tiles: async (hash) => texelsFor(hash),
      put: cloud.put,
    }).flush()

    const local = createDocumentStore(createMemoryBlobStore())
    await hydrateFromRemote({
      documentId: "doc-1",
      remote: cloud.remote,
      local,
      get: cloud.get,
    })

    // Neither "newer here" nor "newer elsewhere" on the next open: a device
    // clock that runs ahead of the server's must not make an untouched copy
    // look like unsynced work.
    expect((await local.load("doc-1"))?.updatedAt).toBe(1_000)
  })

  test("a tile the local store already holds is not downloaded again", async () => {
    const cloud = createFakeCloud()
    const doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }])
    const sync = createCloudSync({
      remote: cloud.remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: cloud.put,
    })
    await sync.flush()

    const local = createDocumentStore(createMemoryBlobStore())
    // Pre-seed the local device with the tile under a different document id —
    // content addressing means it is the same bytes regardless of provenance.
    await local.save(
      {
        version: 1,
        id: "already-here",
        width: 1,
        height: 1,
        structure: STRUCTURE,
        surfaces: [{ surfaceId: "s", tiles: [{ x: 0, y: 0, hash: "hash-a" }] }],
        updatedAt: Date.now(),
      },
      async () => texelsFor("hash-a")
    )

    let gets = 0
    let presignedHashes: readonly string[] = []
    const originalPresignDownloads = cloud.remote.presignDownloads.bind(
      cloud.remote
    )
    await hydrateFromRemote({
      documentId: "doc-1",
      remote: {
        ...cloud.remote,
        presignDownloads: async (hashes) => {
          presignedHashes = hashes
          return originalPresignDownloads(hashes)
        },
      },
      local,
      get: async (url) => {
        gets++
        return cloud.get(url)
      },
    })
    expect(gets).toBe(0)
    // A tile already on this device costs no presigned URL either — not
    // just no fetch — since minting one it never uses is still a wasted call.
    expect(presignedHashes).toEqual([])
  })

  test("a document never flushed returns null rather than an empty document", async () => {
    const cloud = createFakeCloud()
    const local = createDocumentStore(createMemoryBlobStore())
    const manifest = await hydrateFromRemote({
      documentId: "doc-1",
      remote: cloud.remote,
      local,
      get: cloud.get,
    })
    expect(manifest).toBeNull()
  })
})

test("encodeTile/decodeTile still round-trip through the network bytes hydrate passes along", async () => {
  const texels = texelsFor("hash-z")
  const encoded = await encodeTile(texels)
  const decoded = await decodeTile(encoded)
  expect(decoded).toEqual(texels)
})

describe("a placed image on a second machine", () => {
  test("arrives with the original it was made from, not only its pixels", async () => {
    // Criterion: the placement survives sync. Pixels alone would give the
    // other machine a picture it could see and not move (06).
    const cloud = createFakeCloud()
    const placed: DocumentStructure = {
      layers: [
        {
          ...STRUCTURE.layers[0],
          image: true,
          placed: {
            asset: {
              id: "asset-1",
              mime: "image/jpeg",
              width: 100,
              height: 50,
            },
            placement: {
              x: 30,
              y: 20,
              width: 100,
              height: 50,
              rotation: 0.25,
              flipX: true,
              flipY: false,
            },
          },
        },
      ],
      activeLayerId: "layer-1",
      paintingMask: false,
    }
    const doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }])
    const file = new Uint8Array([255, 216, 255, 224])
    const sync = createCloudSync({
      remote: cloud.remote,
      snapshot: () => ({
        structure: placed,
        surfaces: doc,
        assets: [{ id: "asset-1", mime: "image/jpeg", width: 100, height: 50 }],
      }),
      tiles: async (hash) => texelsFor(hash),
      assets: async () => file,
      put: cloud.put,
    })
    await sync.flush()

    const local = createDocumentStore(createMemoryBlobStore())
    const manifest = await hydrateFromRemote({
      documentId: "doc-1",
      remote: cloud.remote,
      local,
      get: cloud.get,
    })

    expect(manifest?.assets).toEqual([
      { id: "asset-1", mime: "image/jpeg", width: 100, height: 50 },
    ])
    expect(await local.readAsset("asset-1")).toEqual(file)
    const reopened = await local.load("doc-1")
    expect(reopened?.structure.layers[0].placed?.placement.rotation).toBe(0.25)
  })
})
