import { describe, expect, test } from "bun:test"

import { migrateLocalPalettes } from "@/features/color/lib/palette-migration"

function recorder() {
  const created: { name: string; colors: readonly string[] }[] = []
  const used: string[] = []
  return {
    created,
    used,
    remote: {
      create: async (name: string, colors: readonly string[]) => {
        created.push({ name, colors })
        return `remote-${created.length}`
      },
      recordUsed: async (hex: string) => void used.push(hex),
    },
  }
}

function local(state: {
  palettes?: { id: string; name: string; colors: string[] }[]
  recent?: string[]
}) {
  let held: {
    palettes: readonly { id: string; name: string; colors: string[] }[]
    recent: readonly string[]
  } = { palettes: state.palettes ?? [], recent: state.recent ?? [] }
  return {
    read: () => held,
    keepOnly: (
      palettes: readonly { id: string; name: string; colors: string[] }[]
    ) => void (held = { ...held, palettes }),
  }
}

describe("carrying palettes into a new account", () => {
  test("every local palette and recent colour is uploaded, oldest recent first", async () => {
    const { remote, created, used } = recorder()
    const store = local({
      palettes: [{ id: "a", name: "Autumn", colors: ["#aabbcc"] }],
      recent: ["#ff0000", "#00ff00"],
    })

    const result = await migrateLocalPalettes({ local: store, remote })

    expect(created).toEqual([{ name: "Autumn", colors: ["#aabbcc"] }])
    // Recents are newest-first locally; replaying them oldest-first leaves the
    // account's list in the same order the artist had it.
    expect(used).toEqual(["#00ff00", "#ff0000"])
    expect(result).toEqual({ migrated: 1, remaining: 0 })
    expect(store.read().palettes).toEqual([])
  })

  test("nothing local means nothing done", async () => {
    const { remote, created } = recorder()
    expect(await migrateLocalPalettes({ local: local({}), remote })).toEqual({
      migrated: 0,
      remaining: 0,
    })
    expect(created).toEqual([])
  })

  test("a palette the server refuses stays on this device to be retried", async () => {
    const store = local({
      palettes: [
        { id: "a", name: "Kept", colors: ["#aabbcc"] },
        { id: "b", name: "Refused", colors: ["#ddeeff"] },
      ],
    })
    const result = await migrateLocalPalettes({
      local: store,
      remote: {
        create: async (name) => {
          if (name === "Refused") throw new Error("nope")
          return "remote-1"
        },
        recordUsed: async () => {},
      },
    })

    expect(result).toEqual({ migrated: 1, remaining: 1 })
    // Only the palette that did not make it is still here, so a retry cannot
    // duplicate the one that did.
    expect(store.read().palettes.map((palette) => palette.name)).toEqual([
      "Refused",
    ])
  })

  test("recents that fail do not hold back the palettes", async () => {
    const store = local({
      palettes: [{ id: "a", name: "Autumn", colors: ["#aabbcc"] }],
      recent: ["#ff0000"],
    })
    const result = await migrateLocalPalettes({
      local: store,
      remote: {
        create: async () => "remote-1",
        recordUsed: async () => {
          throw new Error("offline")
        },
      },
    })
    expect(result.migrated).toBe(1)
    expect(store.read().palettes).toEqual([])
  })
})
