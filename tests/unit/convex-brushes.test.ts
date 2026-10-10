import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"
import { DEFAULT_BRUSH_SET, MAX_TEXTURE_DIMENSION } from "@/convex/lib/brush"
import { BUILTIN_BRUSHES } from "@/engine/brush/presets"

const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./brushes.ts": () => import("@/convex/brushes"),
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

const pencil = BUILTIN_BRUSHES[0]

describe("brushes on the account", () => {
  test("a saved brush comes back on the next session, on any machine", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const brushId = await artist.mutation(api.brushes.save, {
      name: "  Soft   pencil ",
      definition: pencil,
    })

    const [saved] = await artist.query(api.brushes.list, {})
    expect(saved._id).toBe(brushId)
    expect(saved.name).toBe("Soft pencil")
    expect(saved.set).toBe(DEFAULT_BRUSH_SET)
    expect(saved.definition.dynamics).toEqual(pencil.dynamics)
  })

  test("is renamed, redefined and deleted by its owner", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const brushId = await artist.mutation(api.brushes.save, {
      name: "Pencil",
      definition: pencil,
    })
    await artist.mutation(api.brushes.rename, { brushId, name: "Sketching" })
    await artist.mutation(api.brushes.update, {
      brushId,
      definition: { ...pencil, shape: { ...pencil.shape, radius: 22 } },
    })
    const [saved] = await artist.query(api.brushes.list, {})
    expect(saved.name).toBe("Sketching")
    expect(saved.definition.shape.radius).toBe(22)

    await artist.mutation(api.brushes.remove, { brushId })
    expect(await artist.query(api.brushes.list, {})).toEqual([])
  })

  test("belongs to one artist: another's is neither readable nor removable", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const brushId = await artist.mutation(api.brushes.save, {
      name: "Pencil",
      definition: pencil,
    })
    expect(await stranger.query(api.brushes.list, {})).toEqual([])
    // "Not yours" and "not there" answer the same way, so an id cannot be
    // probed for existence.
    expect(stranger.mutation(api.brushes.remove, { brushId })).rejects.toThrow(
      "That brush does not exist."
    )
  })

  test("a definition that is not a brush is refused rather than stored", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    expect(
      artist.mutation(api.brushes.save, {
        name: "Bad",
        definition: { ...pencil, shape: { ...pencil.shape, radius: -1 } },
      })
    ).rejects.toThrow()
    expect(
      artist.mutation(api.brushes.save, { name: "Bad", definition: "code" })
    ).rejects.toThrow()
    expect(await artist.query(api.brushes.list, {})).toEqual([])
  })

  test("signing out leaves the shelf empty rather than throwing", async () => {
    const t = setup()
    expect(await t.query(api.brushes.list, {})).toEqual([])
    expect(await t.query(api.brushes.listTextures, {})).toEqual([])
    expect(
      t.mutation(api.brushes.save, { name: "Pencil", definition: pencil })
    ).rejects.toThrow("Sign in to keep your brushes.")
  })
})

describe("organising a growing library", () => {
  async function threeBrushes() {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const ids: Id<"brushes">[] = []
    for (const name of ["First", "Second", "Third"])
      ids.push(
        await artist.mutation(api.brushes.save, {
          name,
          set: "Inks",
          definition: pencil,
        })
      )
    return { artist, ids }
  }

  test("brushes are reordered within a set", async () => {
    const { artist, ids } = await threeBrushes()
    await artist.mutation(api.brushes.move, {
      brushId: ids[2],
      set: "Inks",
      index: 0,
    })
    expect(
      (await artist.query(api.brushes.list, {})).map((b) => b.name)
    ).toEqual(["Third", "First", "Second"])
  })

  test("a brush moves into another set, and the set it left closes up", async () => {
    const { artist, ids } = await threeBrushes()
    await artist.mutation(api.brushes.move, {
      brushId: ids[0],
      set: "Washes",
      index: 0,
    })
    const brushes = await artist.query(api.brushes.list, {})
    const moved = brushes.find((brush) => brush._id === ids[0])!
    expect(moved.set).toBe("Washes")
    expect(moved.order).toBe(0)
    const inks = brushes
      .filter((brush) => brush.set === "Inks")
      .sort((a, b) => a.order - b.order)
    expect(inks.map((brush) => [brush.name, brush.order])).toEqual([
      ["Second", 0],
      ["Third", 1],
    ])
  })
})

describe("brush textures", () => {
  test("sync alongside the brushes that name them", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const data = new Uint8Array([0, 64, 128, 255])
    const textureId = await artist.mutation(api.brushes.saveTexture, {
      name: "Scanned paper",
      width: 2,
      height: 2,
      data: data.buffer as ArrayBuffer,
    })
    // The brush names the texture by the id the row was stored under, so a
    // machine that has never seen the file can still resolve it.
    await artist.mutation(api.brushes.save, {
      name: "On my paper",
      definition: {
        ...pencil,
        grain: { textureId, scale: 1, depth: 0.5, movement: 0 },
      },
    })

    const [texture] = await artist.query(api.brushes.listTextures, {})
    expect(texture._id).toBe(textureId)
    expect(new Uint8Array(texture.data)).toEqual(data)
    const [brush] = await artist.query(api.brushes.list, {})
    expect(brush.definition.grain.textureId).toBe(textureId)
  })

  test("a texture that is not one byte per texel is refused", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    expect(
      artist.mutation(api.brushes.saveTexture, {
        name: "Bad",
        width: 4,
        height: 4,
        data: new Uint8Array(3).buffer as ArrayBuffer,
      })
    ).rejects.toThrow()
    expect(
      artist.mutation(api.brushes.saveTexture, {
        name: "Huge",
        width: MAX_TEXTURE_DIMENSION * 2,
        height: 1,
        data: new Uint8Array(MAX_TEXTURE_DIMENSION * 2).buffer as ArrayBuffer,
      })
    ).rejects.toThrow()
  })
})

describe("the brush a document was left with", () => {
  async function document(t: ReturnType<typeof setup>, ownerId: Id<"users">) {
    return await t.run(
      async (ctx) =>
        await ctx.db.insert("documents", {
          ownerId,
          name: "Study",
          width: 1024,
          height: 1024,
          createdAt: 0,
          updatedAt: 0,
        })
    )
  }

  test("is restored on reopening, with the size it was left at", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    const artist = asUser(t, userId)
    const documentId = await document(t, userId)
    expect(await artist.query(api.brushes.lastUsed, { documentId })).toBeNull()

    await artist.mutation(api.brushes.recordLastUsed, {
      documentId,
      brushId: pencil.id,
      radius: 18,
    })
    await artist.mutation(api.brushes.recordLastUsed, {
      documentId,
      brushId: pencil.id,
      radius: 24,
    })
    expect(await artist.query(api.brushes.lastUsed, { documentId })).toEqual({
      brushId: pencil.id,
      radius: 24,
    })
    // One row per document, however many strokes were painted in it.
    const rows = await t.run(
      async (ctx) => await ctx.db.query("brushUse").collect()
    )
    expect(rows.length).toBe(1)
  })

  test("carries the smudge's size and strength, and keeps them when a write names none", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    const artist = asUser(t, userId)
    const documentId = await document(t, userId)
    await artist.mutation(api.brushes.recordLastUsed, {
      documentId,
      brushId: pencil.id,
      radius: 18,
      smudge: { radius: 40, strength: 0.35 },
    })
    expect(await artist.query(api.brushes.lastUsed, { documentId })).toEqual({
      brushId: pencil.id,
      radius: 18,
      smudge: { radius: 40, strength: 0.35 },
    })
    // A client from before smudge had settings names none, and takes none away.
    await artist.mutation(api.brushes.recordLastUsed, {
      documentId,
      brushId: pencil.id,
      radius: 20,
    })
    expect(await artist.query(api.brushes.lastUsed, { documentId })).toEqual({
      brushId: pencil.id,
      radius: 20,
      smudge: { radius: 40, strength: 0.35 },
    })
    await expect(
      artist.mutation(api.brushes.recordLastUsed, {
        documentId,
        brushId: pencil.id,
        radius: 20,
        smudge: { radius: 40, strength: 1.5 },
      })
    ).rejects.toThrow()
  })
})
