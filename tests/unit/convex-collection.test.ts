import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api, internal } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"
import {
  GRACE_WINDOW_MS,
  planPage,
  runSweep,
  type StoredTileObject,
} from "@/convex/lib/collection"
import { fakeStore } from "./helpers/orphan-collection-fixtures"

// See tests/unit/convex-documents.test.ts for why the module map is explicit.
const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./collection.ts": () => import("@/convex/collection"),
  "./documents.ts": () => import("@/convex/documents"),
  "./tiles.ts": () => import("@/convex/tiles"),
  "./versions.ts": () => import("@/convex/versions"),
  "./http.ts": () => import("@/convex/http"),
}

const STRUCTURE = { layers: [], activeLayerId: "", paintingMask: false }
const NOW = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function setup() {
  return convexTest(schema, modules)
}

async function createUser(t: ReturnType<typeof setup>, email: string) {
  return await t.run(async (ctx) => await ctx.db.insert("users", { email }))
}

function asUser(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.withIdentity({ subject: userId })
}

async function createDocument(
  t: ReturnType<typeof setup>,
  artist: ReturnType<typeof asUser>
) {
  return await artist.mutation(api.documents.create, {
    name: "Sea study",
    width: 512,
    height: 512,
  })
}

/** A flush that paints one tile slot, replacing whatever hash held it. */
async function flush(
  artist: ReturnType<typeof asUser>,
  documentId: Id<"documents">,
  hash: string
) {
  await artist.mutation(api.tiles.commitFlush, {
    documentId,
    tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash }],
    uploaded: [{ hash, size: 100 }],
    structure: STRUCTURE,
    metrics: { putCount: 1, mutationCount: 1 },
  })
}

/** Backdates restore points, standing in for time passing between flushes. */
async function ageVersions(t: ReturnType<typeof setup>, by: number) {
  await t.run(async (ctx) => {
    for (const version of await ctx.db.query("versions").collect())
      await ctx.db.patch(version._id, { createdAt: version.createdAt - by })
  })
}

/** The whole mark, drained through the paged queries the sweep uses. */
async function markedHashes(t: ReturnType<typeof setup>): Promise<string[]> {
  const hashes: string[] = []
  for (const page of [
    internal.collection.markedTileHashes,
    internal.collection.markedVersionHashes,
  ] as const) {
    let cursor: string | null = null
    do {
      const result: { hashes: string[]; cursor: string | null } = await t.query(
        page,
        { cursor }
      )
      hashes.push(...result.hashes)
      cursor = result.cursor
    } while (cursor !== null)
  }
  return hashes
}

/** The real database wired up as the sweep's ledger, for end-to-end runs. */
function ledgerFor(t: ReturnType<typeof setup>, runId: Id<"collectionRuns">) {
  return {
    markedHashes: async () => new Set(await markedHashes(t)),
    forgetCollected: async (hashes: readonly string[]) => {
      await t.mutation(internal.collection.forgetCollected, {
        hashes: [...hashes],
      })
    },
    recordCollected: async (batch: {
      collected: readonly StoredTileObject[]
      scanned: number
      retainedInGrace: number
    }) => {
      await t.mutation(internal.collection.recordCollected, {
        runId,
        collected: batch.collected.map((object) => ({
          hash: object.hash,
          size: object.size,
        })),
        scanned: batch.scanned,
        retainedInGrace: batch.retainedInGrace,
      })
    },
  }
}

function collectableObjects(
  objects: readonly StoredTileObject[],
  referenced: ReadonlySet<string>,
  now: number
): StoredTileObject[] {
  return planPage(objects, referenced, now).collect
}

/** What R2 would list for a long-settled object with this hash. */
function stored(hash: string, age = GRACE_WINDOW_MS + DAY, size = 100) {
  return { hash, size, uploadedAt: NOW - age }
}

describe("marking", () => {
  test("a tile a live document still points at is marked", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")

    const marked = await markedHashes(t)

    expect(marked).toContain("hash-a")
  })

  test("a tile only a restore point names is marked", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    // Two flushes an hour apart: the second replaces the tile row, so
    // `hash-a` survives only inside the first restore point.
    await flush(artist, documentId, "hash-a")
    await ageVersions(t, 60 * 60 * 1000)
    await flush(artist, documentId, "hash-b")

    const marked = await markedHashes(t)
    const tiles = await t.run(
      async (ctx) => await ctx.db.query("tiles").collect()
    )

    expect(tiles.map((tile) => tile.hash)).toEqual(["hash-b"])
    expect(marked).toContain("hash-a")
    expect(
      collectableObjects([stored("hash-a")], new Set(marked), NOW)
    ).toEqual([])
  })

  test("a tile shared by the document and a restore point survives", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "shared")

    const marked = await markedHashes(t)

    // Both sources name it; the sweep unions them, so it is marked either way.
    expect(marked.filter((hash) => hash === "shared").length).toBeGreaterThan(1)
    expect(
      collectableObjects([stored("shared")], new Set(marked), NOW)
    ).toEqual([])
  })

  test("a tile a decayed-away restore point was the last to name is collectable", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    // The first restore point ages out of the 7-day window entirely, so
    // `recordVersion` prunes it and nothing names `hash-a` any more.
    await flush(artist, documentId, "hash-a")
    await ageVersions(t, 30 * DAY)
    await flush(artist, documentId, "hash-b")

    const marked = await markedHashes(t)

    expect(marked).not.toContain("hash-a")
    expect(
      collectableObjects([stored("hash-a")], new Set(marked), NOW).map(
        (object) => object.hash
      )
    ).toEqual(["hash-a"])
  })

  test("hashes from every owner's documents are marked, not just one's", async () => {
    const t = setup()
    const first = asUser(t, await createUser(t, "first@example.com"))
    const second = asUser(t, await createUser(t, "second@example.com"))
    await flush(first, await createDocument(t, first), "first-hash")
    await flush(second, await createDocument(t, second), "second-hash")

    const marked = await markedHashes(t)

    expect([...marked].sort()).toContain("first-hash")
    expect([...marked].sort()).toContain("second-hash")
  })
})

describe("sweeping", () => {
  test("forgetting collected hashes drops their ledger rows and reports the volume", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")
    await flush(artist, documentId, "hash-b")

    const runId = await t.mutation(internal.collection.beginRun, {})
    await t.mutation(internal.collection.forgetCollected, {
      hashes: ["hash-a"],
    })
    await t.mutation(internal.collection.recordCollected, {
      runId,
      collected: [{ hash: "hash-a", size: 100 }],
      scanned: 2,
      retainedInGrace: 0,
    })
    await t.mutation(internal.collection.finishRun, { runId })

    const blobs = await t.run(
      async (ctx) => await ctx.db.query("blobs").collect()
    )
    expect(blobs.map((blob) => blob.hash)).toEqual(["hash-b"])

    const [run] = await artist.query(api.collection.recentRuns, {})
    expect(run).toMatchObject({
      scannedCount: 2,
      collectedCount: 1,
      reclaimedBytes: 100,
      retainedInGraceCount: 0,
    })
    expect(run!.finishedAt).not.toBeNull()
  })

  test("a run interrupted before it finishes still reports what it reclaimed", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await createDocument(t, artist)

    const runId = await t.mutation(internal.collection.beginRun, {})
    await t.mutation(internal.collection.recordCollected, {
      runId,
      collected: [{ hash: "gone", size: 40 }],
      scanned: 1,
      retainedInGrace: 1,
    })
    // No `finishRun`: the action died between batches.

    const [run] = await artist.query(api.collection.recentRuns, {})
    expect(run).toMatchObject({ collectedCount: 1, reclaimedBytes: 40 })
    expect(run!.finishedAt).toBeNull()
  })

  test("forgetting a hash twice is not an error", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")

    const forget = async () =>
      await t.mutation(internal.collection.forgetCollected, {
        hashes: ["hash-a"],
      })
    // A batch replayed after the action died mid-run must land, not throw:
    // the next sweep will not even see the object, since R2 no longer lists
    // it, so re-deleting is the normal interrupted-run path.
    await forget()
    await forget()

    const blobs = await t.run(
      async (ctx) => await ctx.db.query("blobs").collect()
    )
    expect(blobs).toEqual([])
  })

  test("run reports are only visible to a signed-in caller", async () => {
    const t = setup()
    await expect(t.query(api.collection.recentRuns, {})).rejects.toThrow()
  })
})

describe("a sweep over the real database", () => {
  test("keeps an upload still in flight, and reclaims a genuine orphan", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")

    const now = Date.now()
    // `in-flight` is the case the ledger cannot see at all: the presigned PUT
    // landed, and the flush that would name it has not committed, so there is
    // no `blobs` row and no `tiles` row — only bytes and their age.
    const store = fakeStore([
      { hash: "hash-a", size: 100, uploadedAt: now - 90 * DAY },
      { hash: "orphan", size: 100, uploadedAt: now - 90 * DAY },
      { hash: "in-flight", size: 100, uploadedAt: now - 5000 },
    ])
    const runId = await t.mutation(internal.collection.beginRun, {})

    await runSweep(store.store, ledgerFor(t, runId), { now: () => now })
    await t.mutation(internal.collection.finishRun, { runId })

    expect(store.deleted).toEqual(["orphan"])
    expect([...store.remaining.keys()].sort()).toEqual(["hash-a", "in-flight"])

    const [run] = await artist.query(api.collection.recentRuns, {})
    expect(run).toMatchObject({
      scannedCount: 3,
      collectedCount: 1,
      reclaimedBytes: 100,
      retainedInGraceCount: 1,
    })
  })

  test("keeps a tile only a restore point still names", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")
    await ageVersions(t, 60 * 60 * 1000)
    await flush(artist, documentId, "hash-b")

    const now = Date.now()
    const store = fakeStore([
      { hash: "hash-a", size: 100, uploadedAt: now - 90 * DAY },
      { hash: "hash-b", size: 100, uploadedAt: now - 90 * DAY },
    ])
    const runId = await t.mutation(internal.collection.beginRun, {})

    await runSweep(store.store, ledgerFor(t, runId), { now: () => now })

    expect(store.deleted).toEqual([])
    const blobs = await t.run(
      async (ctx) => await ctx.db.query("blobs").collect()
    )
    expect(blobs.map((blob) => blob.hash).sort()).toEqual(["hash-a", "hash-b"])
  })

  test("forgets the ledger row of every tile it reclaims", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    // Two flushes in the same hour: the first tile is replaced and, once the
    // older restore point is pruned, nothing names `hash-a`.
    await flush(artist, documentId, "hash-a")
    await ageVersions(t, 30 * DAY)
    await flush(artist, documentId, "hash-b")

    const now = Date.now()
    const store = fakeStore([
      { hash: "hash-a", size: 100, uploadedAt: now - 90 * DAY },
      { hash: "hash-b", size: 100, uploadedAt: now - 90 * DAY },
    ])
    const runId = await t.mutation(internal.collection.beginRun, {})

    await runSweep(store.store, ledgerFor(t, runId), { now: () => now })

    expect(store.deleted).toEqual(["hash-a"])
    const blobs = await t.run(
      async (ctx) => await ctx.db.query("blobs").collect()
    )
    // The row goes with the bytes, so the next flush re-uploads rather than
    // trusting the dedup check and pointing at an object that is gone.
    expect(blobs.map((blob) => blob.hash)).toEqual(["hash-b"])
  })
})
