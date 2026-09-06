import { describe, expect, test } from "bun:test"

import { createLocalPalettes } from "@/features/color/lib/local-palette-store"
import { RECENT_LIMIT } from "@/convex/lib/palette"

/** Enough of the Storage interface to stand in for `localStorage`. */
function fakeStorage(seed: Record<string, string> = {}) {
  const entries = new Map(Object.entries(seed))
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    entries,
  }
}

describe("palettes kept in this browser", () => {
  test("a palette survives a reload of the same storage", async () => {
    const storage = fakeStorage()
    const first = createLocalPalettes(storage)
    await first.create("Autumn", ["#AABBCC"])

    const reopened = createLocalPalettes(storage)
    expect(reopened.read().palettes).toEqual([
      { id: expect.any(String), name: "Autumn", colors: ["#aabbcc"] },
    ])
  })

  test("colours are added, reordered and removed", async () => {
    const store = createLocalPalettes(fakeStorage())
    await store.create("Scheme", ["#111111", "#222222"])
    const { id } = store.read().palettes[0]
    await store.addColor(id, "#333333")
    await store.reorder(id, 2, 0)
    expect(store.read().palettes[0].colors).toEqual([
      "#333333",
      "#111111",
      "#222222",
    ])
    await store.removeColorAt(id, 1)
    expect(store.read().palettes[0].colors).toEqual(["#333333", "#222222"])
  })

  test("renaming and deleting", async () => {
    const store = createLocalPalettes(fakeStorage())
    await store.create("Scheme", [])
    const { id } = store.read().palettes[0]
    await store.rename(id, "  Dusk  ")
    expect(store.read().palettes[0].name).toBe("Dusk")
    await store.remove(id)
    expect(store.read().palettes).toEqual([])
  })

  test("recents are newest-first, deduplicated and bounded", async () => {
    const store = createLocalPalettes(fakeStorage())
    await store.recordUsed("#ff0000")
    await store.recordUsed("#00ff00")
    await store.recordUsed("#FF0000")
    expect(store.read().recent).toEqual(["#ff0000", "#00ff00"])
    for (let index = 0; index < RECENT_LIMIT + 3; index++)
      await store.recordUsed(`#00${index.toString(16).padStart(2, "0")}00`)
    expect(store.read().recent).toHaveLength(RECENT_LIMIT)
  })

  test("subscribers are told when anything changes", async () => {
    const store = createLocalPalettes(fakeStorage())
    let changes = 0
    const unsubscribe = store.subscribe(() => changes++)
    await store.recordUsed("#ff0000")
    expect(changes).toBe(1)
    unsubscribe()
    await store.recordUsed("#00ff00")
    expect(changes).toBe(1)
  })

  test("the snapshot is stable between changes, so React need not re-render", async () => {
    const store = createLocalPalettes(fakeStorage())
    const before = store.read()
    expect(store.read()).toBe(before)
    await store.recordUsed("#ff0000")
    expect(store.read()).not.toBe(before)
  })

  test("corrupt or foreign storage reads as empty rather than throwing", () => {
    expect(
      createLocalPalettes(fakeStorage({ "velura.palettes": "{" })).read()
    ).toEqual({ palettes: [], recent: [], loaded: true })
    expect(
      createLocalPalettes(
        fakeStorage({ "velura.palettes": '{"palettes":7}' })
      ).read().palettes
    ).toEqual([])
  })

  test("storage that refuses to write does not break the session", async () => {
    const store = createLocalPalettes({
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError")
      },
    })
    await store.recordUsed("#ff0000")
    // The colour is still to hand for this session, it just did not persist.
    expect(store.read().recent).toEqual(["#ff0000"])
  })
})
