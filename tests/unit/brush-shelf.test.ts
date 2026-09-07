import { describe, expect, test } from "bun:test"

import {
  BUILTIN_BRUSHES,
  DEFAULT_LIBRARY_BRUSH_ID,
} from "@/engine/brush/presets"
import {
  BUILTIN_SET,
  brushShelf,
  copyName,
  duplicateOf,
  resolveLibraryBrush,
} from "@/features/studio/lib/brush-shelf"
import type { StoredBrush } from "@/features/studio/lib/brush-store"

const pencil = BUILTIN_BRUSHES[0]

function stored(over: Partial<StoredBrush> = {}): StoredBrush {
  return {
    id: "s1",
    name: "Mine",
    set: "Inks",
    order: 0,
    brush: { ...pencil, id: "s1", name: "Mine" },
    ...over,
  }
}

describe("the shelf", () => {
  test("opens on the built-ins, so there is something to paint with at once", () => {
    const shelf = brushShelf([])
    expect(shelf[0].name).toBe(BUILTIN_SET)
    expect(shelf[0].brushes.length).toBe(BUILTIN_BRUSHES.length)
    expect(shelf[0].brushes.every((entry) => entry.builtin)).toBe(true)
  })

  test("groups saved brushes into their sets, in the order they were placed", () => {
    const shelf = brushShelf([
      stored({ id: "b", name: "Second", set: "Inks", order: 1 }),
      stored({ id: "a", name: "First", set: "Inks", order: 0 }),
      stored({ id: "c", name: "Other", set: "Washes", order: 0 }),
    ])
    const inks = shelf.find((set) => set.name === "Inks")!
    expect(inks.brushes.map((entry) => entry.name)).toEqual(["First", "Second"])
    expect(shelf.map((set) => set.name)).toEqual([
      BUILTIN_SET,
      "Inks",
      "Washes",
    ])
    expect(inks.brushes.every((entry) => entry.builtin)).toBe(false)
  })
})

describe("a built-in", () => {
  test("cannot be destroyed", () => {
    const shelf = brushShelf([])
    expect(shelf[0].brushes.every((entry) => entry.deletable)).toBe(false)
    expect(brushShelf([stored()])[1].brushes[0].deletable).toBe(true)
  })

  test("duplicates into a set of the artist's own", () => {
    const copy = duplicateOf(
      {
        id: pencil.id,
        name: pencil.name,
        set: BUILTIN_SET,
        brush: pencil,
        builtin: true,
        deletable: false,
      },
      []
    )
    expect(copy.set).not.toBe(BUILTIN_SET)
    expect(copy.name).toBe(`${pencil.name} copy`)
    // The copy is a brush in its own right, not a reference back to the
    // original: editing it must not be able to reach the built-in.
    expect(copy.brush).toEqual(pencil)
    expect(copy.brush).not.toBe(pencil)
  })
})

describe("copy names", () => {
  test("say what they came from and do not collide", () => {
    expect(copyName("Pencil", [])).toBe("Pencil copy")
    expect(copyName("Pencil", ["Pencil copy"])).toBe("Pencil copy 2")
    expect(copyName("Pencil", ["Pencil copy", "Pencil copy 2"])).toBe(
      "Pencil copy 3"
    )
  })
})

describe("resolving a brush by id", () => {
  test("finds built-ins and saved brushes, and nothing else", () => {
    const saved = stored()
    expect(resolveLibraryBrush(DEFAULT_LIBRARY_BRUSH_ID, [saved])?.name).toBe(
      "Round brush"
    )
    expect(resolveLibraryBrush("s1", [saved])?.name).toBe("Mine")
    expect(resolveLibraryBrush("gone", [saved])).toBeUndefined()
  })

  test("gives a saved brush the row's name and id, not the definition's", () => {
    // A definition saved under one name and renamed later must answer to the
    // row: the row is what the artist can see and change.
    const saved = stored({ name: "Renamed" })
    expect(resolveLibraryBrush("s1", [saved])).toMatchObject({
      id: "s1",
      name: "Renamed",
    })
  })
})
