import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { SCENE_CHUNK_CHARS } from "@/convex/lib/scenes"
import schema from "@/convex/schema"

// See tests/unit/convex-documents.test.ts for why the module map is explicit.
const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./documents.ts": () => import("@/convex/documents"),
  "./tiles.ts": () => import("@/convex/tiles"),
  "./versions.ts": () => import("@/convex/versions"),
  "./http.ts": () => import("@/convex/http"),
}

const DAY = 24 * 60 * 60 * 1000

function setup() {
  return convexTest(schema, modules)
}

async function signIn(t: ReturnType<typeof setup>, email: string) {
  const userId = await t.run(
    async (ctx) => await ctx.db.insert("users", { email })
  )
  return t.withIdentity({ subject: userId })
}

type Artist = Awaited<ReturnType<typeof signIn>>

function rect(id: string, x = 0) {
  return {
    id,
    geometry: { kind: "rect", x, y: 0, width: 10, height: 10 },
    transform: [1, 0, 0, 1, 0, 0],
    style: {
      fill: { color: "#ff0000", opacity: 1, rule: "nonzero" },
      stroke: null,
    },
  }
}

/** A polygon whose JSON alone is bigger than one chunk row may hold. */
function hugePolygon(id: string) {
  const count = Math.ceil(SCENE_CHUNK_CHARS / 20) + 1000
  return {
    id,
    geometry: {
      kind: "polygon",
      closed: true,
      points: Array.from({ length: count }, (_, i) => ({
        x: i + 0.123456,
        y: i * 2 + 0.654321,
      })),
    },
    transform: [1, 0, 0, 1, 0, 0],
    style: {
      fill: { color: "#00ff00", opacity: 1, rule: "evenodd" },
      stroke: null,
    },
  }
}

function structureWith(objects: unknown[]) {
  return {
    layers: [
      {
        id: "layer-1",
        kind: "raster",
        name: "Paint",
        opacity: 1,
        visible: true,
        blend: "normal",
        clip: false,
        locked: false,
      },
      {
        id: "vector-2",
        kind: "vector",
        name: "Shapes",
        opacity: 1,
        visible: true,
        blend: "normal",
        clip: false,
        locked: false,
        scene: { objects },
      },
    ],
    activeLayerId: "vector-2",
    paintingMask: false,
  }
}

async function flush(
  artist: Artist,
  documentId: Id<"documents">,
  structure: unknown
) {
  await artist.mutation(api.tiles.commitFlush, {
    documentId,
    tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash: "tile-a" }],
    uploaded: [],
    structure,
    metrics: { putCount: 0, mutationCount: 1 },
  })
}

async function newDocument(artist: Artist) {
  return await artist.mutation(api.documents.create, {
    name: "Shapes",
    width: 512,
    height: 512,
  })
}

async function storedRows(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => {
    const document = (await ctx.db.query("documents").first())!
    const chunks = await ctx.db.query("sceneChunks").collect()
    return { structure: document.structure, chunks }
  })
}

describe("vector scenes in the cloud", () => {
  test("a flushed scene is stored as chunk rows and read back whole", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const structure = structureWith([rect("shape-1"), rect("shape-2", 20)])

    await flush(artist, documentId, structure)

    const { structure: stored, chunks } = await storedRows(t)
    // The document row names the chunks rather than holding the objects.
    expect(JSON.stringify(stored)).not.toContain("shape-1")
    expect(chunks.length).toBeGreaterThan(0)

    const document = await artist.query(api.documents.get, { documentId })
    expect(document.structure).toEqual(structure)
  })

  test("a scene bigger than one row is split across several and joined back", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const structure = structureWith([rect("shape-1"), hugePolygon("shape-2")])

    await flush(artist, documentId, structure)

    const { chunks } = await storedRows(t)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks)
      expect(chunk.data.length).toBeLessThanOrEqual(SCENE_CHUNK_CHARS)
    const document = await artist.query(api.documents.get, { documentId })
    expect(document.structure).toEqual(structure)
  })

  test("an unchanged scene flushed again writes no new chunks", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const structure = structureWith([rect("shape-1")])

    await flush(artist, documentId, structure)
    const first = (await storedRows(t)).chunks.map((chunk) => chunk._id)
    await flush(artist, documentId, structure)
    const second = (await storedRows(t)).chunks.map((chunk) => chunk._id)

    expect(second).toEqual(first)
  })

  test("restore points keep the scene they were flushed with", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const before = structureWith([rect("shape-1")])
    const after = structureWith([rect("shape-1"), rect("shape-2", 20)])

    await flush(artist, documentId, before)
    await flush(artist, documentId, after)

    const points = await artist.query(api.versions.list, { documentId })
    const oldest = await artist.query(api.versions.get, {
      versionId: points.at(-1)!.id,
    })
    const newest = await artist.query(api.versions.get, {
      versionId: points[0]!.id,
    })
    expect(oldest.structure).toEqual(before)
    expect(newest.structure).toEqual(after)
  })

  test("chunks nothing names any more are dropped as restore points thin", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)

    await flush(artist, documentId, structureWith([rect("old")]))
    const oldChunks = (await storedRows(t)).chunks.map((chunk) => chunk.hash)
    // Every restore point naming the old scene ages out of the ladder.
    await t.run(async (ctx) => {
      for (const version of await ctx.db.query("versions").collect())
        await ctx.db.patch(version._id, {
          createdAt: version.createdAt - 60 * DAY,
        })
    })
    await flush(artist, documentId, structureWith([rect("new")]))
    await flush(artist, documentId, structureWith([rect("newer")]))

    const { chunks } = await storedRows(t)
    const left = new Set(chunks.map((chunk) => chunk.hash))
    for (const hash of oldChunks) expect(left.has(hash)).toBe(false)
    // What the retained points still name is still there to read.
    for (const point of await artist.query(api.versions.list, {
      documentId,
    })) {
      const version = await artist.query(api.versions.get, {
        versionId: point.id,
      })
      expect(version.structure.layers[1].scene.objects).toHaveLength(1)
    }
  })

  test("an empty vector layer reads back with an empty scene", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const structure = structureWith([])
    await flush(artist, documentId, structure)

    const document = await artist.query(api.documents.get, { documentId })
    expect(document.structure).toEqual(structure)
  })

  test("a structure from before scenes had records reads back unchanged", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const legacy = structureWith([rect("shape-1")])
    await t.run(async (ctx) => {
      await ctx.db.patch(documentId, { structure: legacy })
    })

    const document = await artist.query(api.documents.get, { documentId })
    expect(document.structure).toEqual(legacy)
  })

  test("a duplicate reads its scenes from rows of its own", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const structure = structureWith([rect("shape-1")])
    await flush(artist, documentId, structure)

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    await artist.mutation(api.documents.remove, { documentId })

    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy.structure).toEqual(structure)
  })

  test("removing a document drops its scene rows", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    await flush(artist, documentId, structureWith([rect("shape-1")]))

    await artist.mutation(api.documents.remove, { documentId })

    const chunks = await t.run(
      async (ctx) => await ctx.db.query("sceneChunks").collect()
    )
    expect(chunks).toEqual([])
  })

  test("a flush with an unreadable scene is refused", async () => {
    const t = setup()
    const artist = await signIn(t, "artist@example.com")
    const documentId = await newDocument(artist)
    const broken = structureWith([])
    ;(broken.layers[1] as { scene: unknown }).scene = { objects: "nope" }

    await expect(flush(artist, documentId, broken)).rejects.toThrow()
  })
})
