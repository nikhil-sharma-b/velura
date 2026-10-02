import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"

const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./preferences.ts": () => import("@/convex/preferences"),
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

describe("preferences", () => {
  test("an artist with no preferences reads null, not defaults", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    expect(await artist.query(api.preferences.get, {})).toBeNull()
  })

  test("signed out reads null and cannot write", async () => {
    const t = setup()
    expect(await t.query(api.preferences.get, {})).toBeNull()
    await expect(
      t.mutation(api.preferences.setKeybinds, { keybinds: {} })
    ).rejects.toThrow()
  })

  test("keybind overrides written in one session read back in another", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    await asUser(t, userId).mutation(api.preferences.setKeybinds, {
      keybinds: { "history.undo": ["Mod+U"], "tool.brush": [] },
    })
    const other = asUser(t, userId)
    expect((await other.query(api.preferences.get, {}))?.keybinds).toEqual({
      "history.undo": ["mod+u"],
      "tool.brush": [],
    })
  })

  test("a later write replaces the earlier one on the same row", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    const artist = asUser(t, userId)
    await artist.mutation(api.preferences.setKeybinds, {
      keybinds: { "history.undo": ["mod+u"] },
    })
    await artist.mutation(api.preferences.setKeybinds, { keybinds: {} })
    expect((await artist.query(api.preferences.get, {}))?.keybinds).toEqual({})
    const rows = await t.run((ctx) => ctx.db.query("preferences").collect())
    expect(rows).toHaveLength(1)
  })

  test("one artist never sees or changes another's preferences", async () => {
    const t = setup()
    const alice = asUser(t, await createUser(t, "alice@example.com"))
    const bob = asUser(t, await createUser(t, "bob@example.com"))
    await alice.mutation(api.preferences.setKeybinds, {
      keybinds: { "history.undo": ["mod+u"] },
    })
    expect(await bob.query(api.preferences.get, {})).toBeNull()
    await bob.mutation(api.preferences.setKeybinds, {
      keybinds: { "history.undo": ["mod+b"] },
    })
    expect((await alice.query(api.preferences.get, {}))?.keybinds).toEqual({
      "history.undo": ["mod+u"],
    })
  })

  test("claiming anonymous overrides fills only commands the account has not set", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await artist.mutation(api.preferences.setKeybinds, {
      keybinds: { "history.undo": ["mod+u"] },
    })
    const merged = await artist.mutation(api.preferences.claimKeybinds, {
      keybinds: { "history.undo": ["mod+x"], "tool.brush": ["q"] },
    })
    expect(merged).toEqual({ "history.undo": ["mod+u"], "tool.brush": ["q"] })
    expect((await artist.query(api.preferences.get, {}))?.keybinds).toEqual({
      "history.undo": ["mod+u"],
      "tool.brush": ["q"],
    })
  })

  test("claiming into an account with no preferences creates them", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await artist.mutation(api.preferences.claimKeybinds, {
      keybinds: { "tool.brush": ["q"] },
    })
    expect((await artist.query(api.preferences.get, {}))?.keybinds).toEqual({
      "tool.brush": ["q"],
    })
  })

  test("ruler visibility is unset until chosen, then reads back", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    const artist = asUser(t, userId)
    await artist.mutation(api.preferences.setKeybinds, { keybinds: {} })
    expect(
      (await artist.query(api.preferences.get, {}))?.rulersVisible
    ).toBeNull()
    await artist.mutation(api.preferences.setRulersVisible, { visible: true })
    expect(
      (await asUser(t, userId).query(api.preferences.get, {}))?.rulersVisible
    ).toBe(true)
  })

  test("choosing rulers first creates the preferences, keybinds untouched", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    await artist.mutation(api.preferences.setRulersVisible, { visible: true })
    expect(await artist.query(api.preferences.get, {})).toEqual({
      keybinds: {},
      rulersVisible: true,
    })
    await artist.mutation(api.preferences.setKeybinds, {
      keybinds: { "tool.brush": ["q"] },
    })
    await artist.mutation(api.preferences.setRulersVisible, { visible: false })
    expect(await artist.query(api.preferences.get, {})).toEqual({
      keybinds: { "tool.brush": ["q"] },
      rulersVisible: false,
    })
  })

  test("signed out cannot choose rulers", async () => {
    const t = setup()
    await expect(
      t.mutation(api.preferences.setRulersVisible, { visible: true })
    ).rejects.toThrow()
  })
})
