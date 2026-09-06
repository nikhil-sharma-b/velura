import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
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
