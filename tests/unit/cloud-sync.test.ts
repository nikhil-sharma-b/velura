import { describe, expect, test } from "bun:test"

import {
  createCloudSync,
  type RemoteIndex,
} from "../../engine/store/cloud-sync"
import type { DocumentStructure } from "../../engine/doc/structure"
import { surfaces } from "./helpers/cloud-sync-fixtures"

const STRUCTURE: DocumentStructure = {
  layers: [],
  activeLayerId: "",
  paintingMask: false,
}

/** A fake backend: an in-memory hash ledger plus a call log for assertions. */
function createFakeRemote() {
  const knownHashes = new Set<string>()
  const puts: string[] = []
  const commits: Parameters<RemoteIndex["commitFlush"]>[0][] = []
  const uploaded = new Map<string, Uint8Array>()

  const remote: RemoteIndex = {
    async missingHashes(hashes) {
      return hashes.filter((hash) => !knownHashes.has(hash))
    },
    async presignUploads(hashes) {
      return hashes.map((hash) => ({ hash, url: `https://r2.test/${hash}` }))
    },
    async presignPreviewUpload() {
      return "https://r2.test/preview.png"
    },
    async commitPreview() {},
    async commitFlush(payload) {
      commits.push(payload)
      for (const blob of payload.uploaded) knownHashes.add(blob.hash)
    },
    async documentMeta() {
      return { width: 512, height: 512, structure: STRUCTURE }
    },
    async tileIndex() {
      return []
    },
    async presignDownloads(hashes) {
      return hashes.map((hash) => ({ hash, url: `https://r2.test/${hash}` }))
    },
  }

  return { remote, knownHashes, puts, commits, uploaded }
}

function fakePut(puts: string[], uploaded: Map<string, Uint8Array>) {
  return async (url: string, bytes: Uint8Array) => {
    puts.push(url)
    uploaded.set(url, bytes)
  }
}

function texelsFor(hash: string) {
  return new Uint16Array(4).fill(hash.length)
}

describe("flush", () => {
  test("every flush uploads a fresh flattened preview, including an empty document", async () => {
    const { remote, puts, commits } = createFakeRemote()
    let preview = 0
    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: [] }),
      tiles: async (hash) => texelsFor(hash),
      preview: async () => new Uint8Array([137, 80, 78, 71, ++preview]),
      put: fakePut(puts, new Map()),
    })

    await sync.flush()
    await sync.flush()

    expect(puts).toEqual([
      "https://r2.test/preview.png",
      "https://r2.test/preview.png",
    ])
    expect(commits).toHaveLength(2)
    expect(sync.metrics()).toEqual({ putCount: 2, mutationCount: 4 })
  })

  test("uploads a new hash once, then never again once the server knows it", async () => {
    const { remote, puts, commits } = createFakeRemote()
    const uploaded = new Map<string, Uint8Array>()
    const doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }])

    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: fakePut(puts, uploaded),
    })

    await sync.flush()
    expect(puts).toEqual(["https://r2.test/hash-a"])
    expect(commits).toHaveLength(1)
    expect(commits[0].uploaded.map((b) => b.hash)).toEqual(["hash-a"])

    // Same document, no new tiles: dedup means no PUT and no wasted upload.
    await sync.flush()
    expect(puts).toEqual(["https://r2.test/hash-a"])
    expect(commits).toHaveLength(2)
    expect(commits[1].uploaded).toEqual([])

    expect(sync.metrics()).toEqual({ putCount: 1, mutationCount: 2 })
  })

  test("a duplicate tile elsewhere in the same document costs one upload, not two", async () => {
    const { remote, puts } = createFakeRemote()
    const uploaded = new Map<string, Uint8Array>()
    const doc = surfaces([
      { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
      { surfaceId: "layer-1", x: 1, y: 0, hash: "hash-a" },
      { surfaceId: "layer-2", x: 0, y: 0, hash: "hash-a" },
    ])

    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: fakePut(puts, uploaded),
    })

    await sync.flush()
    expect(puts).toEqual(["https://r2.test/hash-a"])
  })

  test("overlapping flushes coalesce into one run, and a commit mid-flush is picked up by the retry loop", async () => {
    const { remote, commits } = createFakeRemote()
    let doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }])
    let flushCalls = 0
    const originalCommit = remote.commitFlush.bind(remote)
    remote.commitFlush = async (payload) => {
      flushCalls++
      if (flushCalls === 1) {
        // A stroke lands while the first flush is still in flight.
        doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-b" }])
      }
      await originalCommit(payload)
    }

    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: fakePut([], new Map()),
    })

    const first = sync.flush()
    const second = sync.flush()
    await Promise.all([first, second])

    expect(commits.map((c) => c.uploaded.map((b) => b.hash))).toEqual([
      ["hash-a"],
      ["hash-b"],
    ])
  })

  test("retrying a flush after a dropped commit does not duplicate the upload", async () => {
    const { remote, puts, commits } = createFakeRemote()
    const uploaded = new Map<string, Uint8Array>()
    const doc = surfaces([{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }])

    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: doc }),
      tiles: async (hash) => texelsFor(hash),
      put: fakePut(puts, uploaded),
    })

    await sync.flush()
    // Simulate the client retrying because it never saw the commit response.
    await sync.flush()

    expect(puts).toEqual(["https://r2.test/hash-a"])
    expect(commits[1].uploaded).toEqual([])
  })

  test("an empty document still commits its structure", async () => {
    const { remote, puts, commits } = createFakeRemote()
    const sync = createCloudSync({
      remote,
      snapshot: () => ({ structure: STRUCTURE, surfaces: [] }),
      tiles: async (hash) => texelsFor(hash),
      put: fakePut(puts, new Map()),
    })

    await sync.flush()
    expect(puts).toEqual([])
    expect(commits).toHaveLength(1)
  })
})
