import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api, internal } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"

// See tests/unit/convex-documents.test.ts for why the module map is explicit.
const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./documents.ts": () => import("@/convex/documents"),
  "./tiles.ts": () => import("@/convex/tiles"),
  "./http.ts": () => import("@/convex/http"),
}

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

describe("dedup", () => {
  test("a hash nobody has uploaded is missing", async () => {
    const t = setup()
    expect(
      await t.query(api.tiles.missingHashes, { hashes: ["abc123"] })
    ).toEqual(["abc123"])
  })

  test("a hash confirmed by any document's flush is no longer missing, for every document", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }],
      uploaded: [{ hash: "hash-a", size: 100 }],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 1, mutationCount: 1 },
    })

    expect(
      await t.query(api.tiles.missingHashes, { hashes: ["hash-a", "hash-b"] })
    ).toEqual(["hash-b"])
  })
})

describe("flush", () => {
  test("upserts the tile index and is idempotent on retry", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    const flush = {
      documentId,
      tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }],
      uploaded: [{ hash: "hash-a", size: 100 }],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 1, mutationCount: 1 },
    }
    await artist.mutation(api.tiles.commitFlush, flush)
    await artist.mutation(api.tiles.commitPreview, { documentId })
    // Retry after a dropped response: same call, must not duplicate rows.
    await artist.mutation(api.tiles.commitFlush, flush)

    const rows = await artist.query(api.tiles.forDocument, { documentId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      surfaceId: "layer-1",
      x: 0,
      y: 0,
      hash: "hash-a",
    })
    expect(
      (await artist.query(api.documents.get, { documentId })).previewVersion
    ).toBe(1)
  })

  test("a later flush overwrites the hash at the same tile coordinate", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }],
      uploaded: [{ hash: "hash-a", size: 100 }],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 1, mutationCount: 1 },
    })
    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-b" }],
      uploaded: [{ hash: "hash-b", size: 100 }],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 1, mutationCount: 1 },
    })

    const rows = await artist.query(api.tiles.forDocument, { documentId })
    expect(rows).toHaveLength(1)
    expect(rows[0].hash).toBe("hash-b")
  })

  test("a flush drops the slots it names as removed, and only those", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const structure = { layers: [], activeLayerId: "", paintingMask: false }

    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [
        { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
        { surfaceId: "layer-1", x: 1, y: 0, hash: "hash-b" },
        { surfaceId: "layer-2", x: 0, y: 0, hash: "hash-c" },
      ],
      removed: [],
      uploaded: [],
      structure,
      metrics: { putCount: 0, mutationCount: 1 },
    })
    // This device erased layer-1's second tile. layer-2's it does not
    // mention at all — as a device that never saw it would not.
    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }],
      removed: [{ surfaceId: "layer-1", x: 1, y: 0 }],
      uploaded: [],
      structure,
      metrics: { putCount: 0, mutationCount: 1 },
    })

    const rows = await artist.query(api.tiles.forDocument, { documentId })
    expect(
      rows.map(({ surfaceId, x, y }) => `${surfaceId}:${x},${y}`).sort()
    ).toEqual(["layer-1:0,0", "layer-2:0,0"])
  })

  test("removing a slot from one document leaves another that shares its tile alone", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const first = await createDocument(t, artist)
    const second = await createDocument(t, artist)
    const structure = { layers: [], activeLayerId: "", paintingMask: false }
    const tile = { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }

    for (const documentId of [first, second])
      await artist.mutation(api.tiles.commitFlush, {
        documentId,
        tiles: [tile],
        removed: [],
        uploaded: [],
        structure,
        metrics: { putCount: 0, mutationCount: 1 },
      })
    await artist.mutation(api.tiles.commitFlush, {
      documentId: first,
      tiles: [],
      removed: [{ surfaceId: "layer-1", x: 0, y: 0 }],
      uploaded: [],
      structure,
      metrics: { putCount: 0, mutationCount: 1 },
    })

    expect(
      await artist.query(api.tiles.forDocument, { documentId: first })
    ).toHaveLength(0)
    expect(
      await artist.query(api.tiles.forDocument, { documentId: second })
    ).toHaveLength(1)
  })

  test("a stranger cannot flush or read another artist's tile index", async () => {
    const t = setup()
    const owner = asUser(t, await createUser(t, "owner@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const documentId = await createDocument(t, owner)

    await expect(
      stranger.mutation(api.tiles.commitFlush, {
        documentId,
        tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" }],
        uploaded: [{ hash: "hash-a", size: 100 }],
        structure: { layers: [], activeLayerId: "", paintingMask: false },
        metrics: { putCount: 1, mutationCount: 1 },
      })
    ).rejects.toThrow(/does not exist/)
    await expect(
      stranger.query(api.tiles.forDocument, { documentId })
    ).rejects.toThrow(/does not exist/)
  })
})

describe("duplicate", () => {
  test("a committed preview is tied to the flush that made its tiles", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const updatedAt = await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [],
      removed: [],
      uploaded: [],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 0, mutationCount: 1 },
    })
    await artist.mutation(api.tiles.commitPreview, {
      documentId,
      key: "previews/objects/captured.png",
      flushUpdatedAt: updatedAt,
    })

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy.previewObjectKey).toBe("previews/objects/captured.png")
  })

  test("a legacy client switches the document back to its legacy preview key", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await artist.mutation(api.tiles.commitPreview, {
      documentId,
      key: "previews/objects/immutable.png",
    })
    await artist.mutation(api.tiles.commitPreview, { documentId })

    const document = await artist.query(api.documents.get, { documentId })
    expect(document.previewVersion).toBe(2)
    expect(document.previewObjectKey).toBeUndefined()
  })

  test("a copy pins the source preview object even if the source later changes", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const originalKey = "previews/objects/original.png"
    const source = await artist.query(api.documents.get, { documentId })
    await t.run(async (ctx) => {
      await ctx.db.patch(documentId, {
        previewVersion: 1,
        previewObjectKey: originalKey,
        previewForUpdatedAt: source.updatedAt,
      })
    })

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    await t.run(async (ctx) => {
      await ctx.db.patch(documentId, {
        previewVersion: 2,
        previewObjectKey: "previews/objects/newer.png",
      })
    })

    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy.previewVersion).toBe(1)
    expect(copy.previewObjectKey).toBe(originalKey)
  })

  test("a copy does not pair a previous preview with tiles from a newer flush", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const source = await artist.query(api.documents.get, { documentId })
    await t.run(async (ctx) => {
      await ctx.db.patch(documentId, {
        previewVersion: 1,
        previewObjectKey: "previews/objects/old.png",
        previewForUpdatedAt: source.updatedAt,
      })
    })
    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [],
      removed: [],
      uploaded: [],
      structure: { layers: [], activeLayerId: "", paintingMask: false },
      metrics: { putCount: 0, mutationCount: 1 },
    })

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy.previewObjectKey).toBeUndefined()
    expect(copy.previewVersion).toBeUndefined()
  })

  test("a delayed legacy preview copy is ignored after the source changes", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    await artist.mutation(api.tiles.commitPreview, { documentId })
    const source = await artist.query(api.documents.get, { documentId })
    await artist.mutation(api.tiles.commitPreview, { documentId })

    await t.mutation(internal.tiles.commitCopiedPreview, {
      from: documentId,
      documentId: copyId,
      sourceVersion: source.previewVersion!,
      sourceUpdatedAt: source.updatedAt,
      key: "previews/objects/stale.png",
    })

    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy.previewVersion).toBeUndefined()
    expect(copy.previewObjectKey).toBeUndefined()
  })

  test("a copy names the same pixels and layer tree as its source", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const structure = {
      layers: [{ id: "layer-1", name: "Ink" }],
      activeLayerId: "layer-1",
      paintingMask: false,
    }
    await artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [
        { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
        { surfaceId: "layer-1", x: 1, y: 0, hash: "hash-b" },
      ],
      uploaded: [
        { hash: "hash-a", size: 100 },
        { hash: "hash-b", size: 100 },
      ],
      structure,
      metrics: { putCount: 2, mutationCount: 1 },
    })

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })

    const tilesOf = async (id: Id<"documents">) =>
      (await artist.query(api.tiles.forDocument, { documentId: id }))
        .map(({ surfaceId, x, y, hash }) => ({ surfaceId, x, y, hash }))
        .sort((a, b) => a.x - b.x)
    expect(await tilesOf(copyId)).toEqual(await tilesOf(documentId))
    expect(
      (await artist.query(api.documents.get, { documentId: copyId })).structure
    ).toEqual(structure)
  })
})

describe("guides (16)", () => {
  const flush = (
    artist: ReturnType<typeof asUser>,
    documentId: Id<"documents">,
    structure: unknown
  ) =>
    artist.mutation(api.tiles.commitFlush, {
      documentId,
      tiles: [],
      uploaded: [],
      structure,
      metrics: { putCount: 0, mutationCount: 1 },
    })

  test("are saved with the document and read back by the next session", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const guides = [
      { id: "guide-1", axis: "x", position: 128 },
      { id: "guide-2", axis: "y", position: 64.5 },
    ]
    await flush(artist, documentId, {
      layers: [],
      activeLayerId: "",
      paintingMask: false,
      guides,
    })
    const saved = await artist.query(api.documents.get, { documentId })
    expect((saved.structure as { guides: unknown }).guides).toEqual(guides)
  })

  test("that are malformed are dropped at the boundary, in the restore point too", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, {
      layers: [],
      activeLayerId: "",
      paintingMask: false,
      guides: [
        { id: "guide-1", axis: "x", position: 1 },
        { id: "guide-2", axis: "diagonal", position: 2 },
        { id: "guide-3", axis: "y", position: "3" },
      ],
    })
    const saved = await artist.query(api.documents.get, { documentId })
    expect((saved.structure as { guides: unknown }).guides).toEqual([
      { id: "guide-1", axis: "x", position: 1 },
    ])
    const versions = await t.run((ctx) => ctx.db.query("versions").collect())
    expect((versions[0].structure as { guides: unknown }).guides).toEqual([
      { id: "guide-1", axis: "x", position: 1 },
    ])
  })

  test("a structure without guides is stored as it came", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const structure = { layers: [], activeLayerId: "", paintingMask: false }
    await flush(artist, documentId, structure)
    expect(
      (await artist.query(api.documents.get, { documentId })).structure
    ).toEqual(structure)
  })
})
