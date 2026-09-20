import { describe, expect, test } from "bun:test"

import { createMemoryBlobStore } from "../../engine/store/blob-store"
import { createDocumentStore } from "../../engine/store/document-store"
import {
  migrateAnonymousDocuments,
  type AnonymousMigrationRemote,
} from "../../features/studio/lib/anonymous-migration"
import type { RemoteIndex } from "../../engine/store/cloud-sync"
import { emptyStructure } from "./helpers/anonymous-migration-fixtures"

const manifest = (id: string, hash: string) => ({
  version: 1 as const,
  id,
  name: `Drawing ${id}`,
  width: 256,
  height: 256,
  structure: emptyStructure(id),
  surfaces: [{ surfaceId: `layer-${id}`, tiles: [{ x: 0, y: 0, hash }] }],
  updatedAt: 10,
})

function remoteThat(records: {
  claims: string[]
  commits: { id: string; hash: string }[]
}): AnonymousMigrationRemote {
  return {
    async claimDocument(source) {
      records.claims.push(source.id)
      return `cloud-${source.id}`
    },
    forDocument(documentId): RemoteIndex {
      return {
        async missingHashes(hashes) {
          return hashes
        },
        async presignUploads(hashes) {
          return hashes.map((hash) => ({ hash, url: `put:${hash}` }))
        },
        async presignAssetUploads(ids) {
          return ids.map((id) => ({ id, url: `put:${id}` }))
        },
        async presignAssetDownloads(ids) {
          return ids.map((id) => ({ id, url: `get:${id}` }))
        },
        async commitFlush(payload) {
          records.commits.push({
            id: documentId,
            hash: payload.tiles[0]!.hash,
          })
        },
        async documentMeta() {
          throw new Error("unused")
        },
        async tileIndex() {
          throw new Error("unused")
        },
        async presignDownloads() {
          throw new Error("unused")
        },
        async listVersions() {
          return []
        },
        async versionSnapshot() {
          throw new Error("unused")
        },
      }
    },
  }
}

describe("anonymous account migration", () => {
  test("merges every local anonymous document and clears only its confirmed manifest", async () => {
    const blobs = createMemoryBlobStore()
    const local = createDocumentStore(blobs)
    await local.save(
      manifest("local-one", "hash-1"),
      async () => new Uint16Array([1])
    )
    await local.save(
      manifest("local-two", "hash-2"),
      async () => new Uint16Array([2])
    )
    await local.save(
      manifest("owned-document", "hash-3"),
      async () => new Uint16Array([3])
    )
    const records = {
      claims: [] as string[],
      commits: [] as { id: string; hash: string }[],
    }

    const result = await migrateAnonymousDocuments({
      blobs,
      remote: remoteThat(records),
      put: async () => {},
    })

    expect(result).toEqual({ migrated: 2, remaining: 0 })
    expect(records.claims).toEqual(["local-one", "local-two"])
    expect(records.commits).toEqual([
      { id: "cloud-local-one", hash: "hash-1" },
      { id: "cloud-local-two", hash: "hash-2" },
    ])
    expect(await local.load("local-one")).toBeNull()
    expect(await local.load("local-two")).toBeNull()
    expect(await local.load("owned-document")).not.toBeNull()
  })

  test("retains failed work and retries safely", async () => {
    const blobs = createMemoryBlobStore()
    const local = createDocumentStore(blobs)
    await local.save(
      manifest("local-one", "hash-1"),
      async () => new Uint16Array([1])
    )
    let attempts = 0
    const records = {
      claims: [] as string[],
      commits: [] as { id: string; hash: string }[],
    }
    const remote = remoteThat(records)
    const first = await migrateAnonymousDocuments({
      blobs,
      remote,
      put: async () => {
        attempts++
        throw new Error("offline")
      },
      retry: { sleep: async () => {} },
    })

    expect(first).toEqual({ migrated: 0, remaining: 1 })
    expect(await local.load("local-one")).not.toBeNull()

    const second = await migrateAnonymousDocuments({
      blobs,
      remote,
      put: async () => {
        attempts++
      },
    })
    expect(second).toEqual({ migrated: 1, remaining: 0 })
    expect(attempts).toBe(5)
    expect(await local.load("local-one")).toBeNull()
  })

  test("does not clear a manifest advanced by another tab during upload", async () => {
    const blobs = createMemoryBlobStore()
    const local = createDocumentStore(blobs)
    await local.save(
      manifest("local-one", "hash-1"),
      async () => new Uint16Array([1])
    )
    const records = {
      claims: [] as string[],
      commits: [] as { id: string; hash: string }[],
    }
    const remote = remoteThat(records)
    const commit = remote.forDocument("cloud-local-one").commitFlush
    remote.forDocument = (documentId) => ({
      ...remoteThat(records).forDocument(documentId),
      async commitFlush(payload) {
        await local.save(
          { ...manifest("local-one", "hash-2"), updatedAt: 11 },
          async () => new Uint16Array([2])
        )
        await commit(payload)
      },
    })

    expect(
      await migrateAnonymousDocuments({
        blobs,
        remote,
        put: async () => {},
      })
    ).toEqual({ migrated: 0, remaining: 1 })
    expect((await local.load("local-one"))?.surfaces[0]?.tiles[0]?.hash).toBe(
      "hash-2"
    )
  })
})
