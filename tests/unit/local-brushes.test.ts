import { describe, expect, test } from "bun:test"

import { createLocalBrushes } from "@/features/studio/lib/local-brush-store"
import { BUILTIN_BRUSHES } from "@/engine/brush/presets"
import { DEFAULT_BRUSH_SET } from "@/convex/lib/brush"

/** Enough of the Storage interface to stand in for `localStorage`. */
function fakeStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    entries,
  }
}

const pencil = BUILTIN_BRUSHES[0]

describe("brushes kept in this browser", () => {
  test("a saved brush survives a reload of the same storage", async () => {
    const storage = fakeStorage()
    await createLocalBrushes(storage).save("Sketching", "", pencil)

    const reopened = createLocalBrushes(storage)
    expect(reopened.read().brushes).toEqual([
      {
        id: expect.any(String),
        name: "Sketching",
        set: DEFAULT_BRUSH_SET,
        order: 0,
        brush: pencil,
      },
    ])
  })

  test("is renamed, redefined, reordered and removed", async () => {
    const store = createLocalBrushes(fakeStorage())
    const first = await store.save("First", "Inks", pencil)
    const second = await store.save("Second", "Inks", pencil)
    await store.rename(first, "Renamed")
    await store.update(second, {
      ...pencil,
      shape: { ...pencil.shape, radius: 30 },
    })
    await store.move(second, "Inks", 0)

    expect(store.read().brushes.map((brush) => brush.name)).toEqual([
      "Second",
      "Renamed",
    ])
    expect(store.read().brushes[0].brush.shape.radius).toBe(30)
    await store.remove(first)
    expect(store.read().brushes.length).toBe(1)
  })

  test("refuses a definition the engine would throw on", async () => {
    const store = createLocalBrushes(fakeStorage())
    expect(
      store.save("Bad", "", {
        ...pencil,
        shape: { ...pencil.shape, radius: 0 },
      })
    ).rejects.toThrow()
    expect(store.read().brushes).toEqual([])
  })

  test("a texture is kept beside the brushes that name it", async () => {
    const storage = fakeStorage()
    const store = createLocalBrushes(storage)
    const texture = {
      width: 2,
      height: 2,
      data: new Uint8Array([0, 9, 200, 255]),
    }
    const id = await store.saveTexture("Scanned paper", texture)
    await store.save("On my paper", "", {
      ...pencil,
      grain: { textureId: id, scale: 1, depth: 0.5, movement: 0 },
    })

    // Bytes survive the round trip through storage, which is what makes the
    // brush resolvable on the next visit rather than pointing at nothing.
    const reopened = createLocalBrushes(storage).read()
    expect(reopened.textures).toEqual([{ id, name: "Scanned paper", texture }])
    expect(reopened.brushes[0].brush.grain?.textureId).toBe(id)
  })

  test("remembers the brush and size each document was left with", async () => {
    const storage = fakeStorage()
    const store = createLocalBrushes(storage)
    await store.recordLastUsed("doc-a", pencil.id, 12)
    await store.recordLastUsed("doc-b", "other", 40)
    await store.recordLastUsed("doc-a", pencil.id, 18)

    const reopened = createLocalBrushes(storage)
    expect(reopened.lastUsed("doc-a")).toEqual({
      brushId: pencil.id,
      radius: 18,
    })
    expect(reopened.lastUsed("doc-b")).toEqual({ brushId: "other", radius: 40 })
    expect(reopened.lastUsed("never-opened")).toBeNull()
  })

  test("remembers the smudge's size and strength beside the brush", async () => {
    const storage = fakeStorage()
    const store = createLocalBrushes(storage)
    await store.recordLastUsed("doc-a", pencil.id, 12, {
      radius: 40,
      strength: 0.35,
    })

    const reopened = createLocalBrushes(storage)
    expect(reopened.lastUsed("doc-a")).toEqual({
      brushId: pencil.id,
      radius: 12,
      smudge: { radius: 40, strength: 0.35 },
    })
  })

  test("a stored smudge that is not one is dropped, and the brush kept", () => {
    const storage = fakeStorage()
    const store = createLocalBrushes(storage)
    void store.recordLastUsed("doc-a", pencil.id, 12, {
      radius: -3,
      strength: 7,
    })
    expect(createLocalBrushes(storage).lastUsed("doc-a")).toEqual({
      brushId: pencil.id,
      radius: 12,
    })
  })

  test("unreadable storage is an empty library, never a crash into the studio", () => {
    const store = createLocalBrushes(fakeStorage({ "velura.brushes": "{" }))
    expect(store.read().brushes).toEqual([])
    expect(store.read().loaded).toBe(true)
  })

  test("drops what has been carried into an account, keeping what has not", async () => {
    const store = createLocalBrushes(fakeStorage())
    const stranded = await store.save("Stranded", "Inks", pencil)
    await store.save("Migrated", "Inks", pencil)
    store.keepOnly(
      store.read().brushes.filter((brush) => brush.id === stranded)
    )
    expect(store.read().brushes.map((brush) => brush.name)).toEqual([
      "Stranded",
    ])
  })
})
