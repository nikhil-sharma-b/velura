import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"
import { MAX_PALETTE_COLORS, RECENT_LIMIT } from "@/convex/lib/palette"

const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./palettes.ts": () => import("@/convex/palettes"),
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

describe("palettes", () => {
  test("a saved palette comes back on the next session", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const paletteId = await artist.mutation(api.palettes.create, {
      name: "  Autumn   study ",
      colors: ["#AABBCC", "abc"],
    })

    const [palette] = await artist.query(api.palettes.list, {})
    expect(palette._id).toBe(paletteId)
    expect(palette.name).toBe("Autumn study")
    // Stored canonically, whatever shape they were typed in.
    expect(palette.colors).toEqual(["#aabbcc", "#aabbcc"])
  })

  test("colours are added, reordered and removed", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const paletteId = await artist.mutation(api.palettes.create, {
      name: "Scheme",
      colors: ["#111111", "#222222"],
    })
    await artist.mutation(api.palettes.addColor, { paletteId, hex: "#333333" })
    await artist.mutation(api.palettes.reorder, { paletteId, from: 2, to: 0 })
    expect((await artist.query(api.palettes.list, {}))[0].colors).toEqual([
      "#333333",
      "#111111",
      "#222222",
    ])
    await artist.mutation(api.palettes.removeColorAt, { paletteId, index: 1 })
    expect((await artist.query(api.palettes.list, {}))[0].colors).toEqual([
      "#333333",
      "#222222",
    ])
  })

  test("renaming and deleting", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const paletteId = await artist.mutation(api.palettes.create, {
      name: "Scheme",
      colors: [],
    })
    await artist.mutation(api.palettes.rename, { paletteId, name: "Dusk" })
    expect((await artist.query(api.palettes.list, {}))[0].name).toBe("Dusk")
    await artist.mutation(api.palettes.remove, { paletteId })
    expect(await artist.query(api.palettes.list, {})).toEqual([])
  })

  test("a palette belongs to its artist and no one else", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const paletteId = await artist.mutation(api.palettes.create, {
      name: "Scheme",
      colors: ["#111111"],
    })

    expect(await stranger.query(api.palettes.list, {})).toEqual([])
    // "Not yours" and "not there" must answer identically.
    await expect(
      stranger.mutation(api.palettes.rename, { paletteId, name: "Mine now" })
    ).rejects.toThrow("That palette does not exist.")
    await expect(
      stranger.mutation(api.palettes.remove, { paletteId })
    ).rejects.toThrow("That palette does not exist.")
  })

  test("an oversized palette is refused rather than truncated", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await expect(
      artist.mutation(api.palettes.create, {
        name: "Too many",
        colors: new Array(MAX_PALETTE_COLORS + 1).fill("#ffffff"),
      })
    ).rejects.toThrow(String(MAX_PALETTE_COLORS))
  })

  test("signing out leaves an empty list, not an error", async () => {
    const t = setup()
    expect(await t.query(api.palettes.list, {})).toEqual([])
    expect(await t.query(api.palettes.recent, {})).toEqual([])
  })
})

describe("recently used colours", () => {
  test("follow the artist between machines, newest first and bounded", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await artist.mutation(api.palettes.recordUsed, { hex: "#ff0000" })
    await artist.mutation(api.palettes.recordUsed, { hex: "#00ff00" })
    await artist.mutation(api.palettes.recordUsed, { hex: "#FF0000" })
    expect(await artist.query(api.palettes.recent, {})).toEqual([
      "#ff0000",
      "#00ff00",
    ])

    for (let index = 0; index < RECENT_LIMIT + 3; index++)
      await artist.mutation(api.palettes.recordUsed, {
        hex: `#00${index.toString(16).padStart(2, "0")}00`,
      })
    expect(await artist.query(api.palettes.recent, {})).toHaveLength(
      RECENT_LIMIT
    )
  })

  test("one artist's recents are not another's", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const other = asUser(t, await createUser(t, "other@example.com"))
    await artist.mutation(api.palettes.recordUsed, { hex: "#ff0000" })
    expect(await other.query(api.palettes.recent, {})).toEqual([])
  })

  test("something that is not a colour is refused", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await expect(
      artist.mutation(api.palettes.recordUsed, { hex: "chartreuse" })
    ).rejects.toThrow("not a colour")
  })
})
