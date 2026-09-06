import { describe, expect, test } from "bun:test"

import { BUILTIN_BRUSHES } from "@/engine/brush/presets"
import { migrateLocalBrushes } from "@/features/studio/lib/brush-migration"
import type {
  StoredBrush,
  StoredTexture,
} from "@/features/studio/lib/brush-store"

const pencil = BUILTIN_BRUSHES[0]

function brush(over: Partial<StoredBrush> = {}): StoredBrush {
  return {
    id: "b1",
    name: "Mine",
    set: "Inks",
    order: 0,
    brush: pencil,
    ...over,
  }
}

const paper: StoredTexture = {
  id: "t1",
  name: "Paper",
  texture: { width: 1, height: 1, data: new Uint8Array([128]) },
}

function local(brushes: StoredBrush[], textures: StoredTexture[] = []) {
  const kept = { brushes }
  return {
    read: () => ({ brushes: kept.brushes, textures }),
    keepOnly(remaining: readonly StoredBrush[]) {
      kept.brushes = [...remaining]
    },
    kept,
  }
}

describe("carrying brushes into a new account", () => {
  test("uploads each brush and drops what made it up", async () => {
    const store = local([brush(), brush({ id: "b2", name: "Other" })])
    const saved: string[] = []
    const result = await migrateLocalBrushes({
      local: store,
      remote: {
        save: async (name) => {
          saved.push(name)
          return "remote"
        },
        saveTexture: async () => "remote-texture",
      },
    })
    expect(saved).toEqual(["Mine", "Other"])
    expect(result).toEqual({ migrated: 2, remaining: 0 })
    expect(store.kept.brushes).toEqual([])
  })

  test("a texture goes up first, and the brushes that named it follow it", async () => {
    const store = local(
      [
        brush({
          brush: {
            ...pencil,
            grain: { textureId: paper.id, scale: 1, depth: 0.5, movement: 0 },
          },
        }),
      ],
      [paper]
    )
    let uploaded: string | undefined
    await migrateLocalBrushes({
      local: store,
      remote: {
        save: async (_name, _set, definition) => {
          uploaded = definition.grain?.textureId
          return "remote"
        },
        saveTexture: async () => "remote-texture",
      },
    })
    // The local id means nothing on the account: the definition has to point
    // at the row the texture landed in, or the brush arrives untextured.
    expect(uploaded).toBe("remote-texture")
  })

  test("a brush that fails stays on this device to be retried", async () => {
    const store = local([brush(), brush({ id: "b2", name: "Other" })])
    const result = await migrateLocalBrushes({
      local: store,
      remote: {
        save: async (name) => {
          if (name === "Other") throw new Error("offline")
          return "remote"
        },
        saveTexture: async () => "remote-texture",
      },
    })
    expect(result).toEqual({ migrated: 1, remaining: 1 })
    expect(store.kept.brushes.map((entry) => entry.name)).toEqual(["Other"])
  })

  test("a brush whose texture failed is held back whole, not sent untextured", async () => {
    const store = local(
      [
        brush({
          brush: {
            ...pencil,
            grain: { textureId: paper.id, scale: 1, depth: 0.5, movement: 0 },
          },
        }),
      ],
      [paper]
    )
    const result = await migrateLocalBrushes({
      local: store,
      remote: {
        save: async () => "remote",
        saveTexture: async () => {
          throw new Error("offline")
        },
      },
    })
    expect(result).toEqual({ migrated: 0, remaining: 1 })
    expect(store.kept.brushes.length).toBe(1)
  })

  test("nothing to carry is not a failure", async () => {
    const store = local([])
    expect(
      await migrateLocalBrushes({
        local: store,
        remote: {
          save: async () => "remote",
          saveTexture: async () => "remote-texture",
        },
      })
    ).toEqual({ migrated: 0, remaining: 0 })
  })
})
