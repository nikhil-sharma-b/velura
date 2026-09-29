import { describe, expect, test } from "bun:test"

import {
  addGuide,
  guideSnapTargets,
  moveGuide,
  normaliseGuides,
  removeGuide,
  type Guide,
} from "../../engine/doc/guides"
import { snapTargets } from "../../engine/doc/snap"

describe("guides in a document", () => {
  test("a new guide gets an id no other guide has", () => {
    const one = addGuide([], "x", 10)
    const two = addGuide(one.guides, "y", 20)
    expect(two.guides).toEqual([
      { id: one.id, axis: "x", position: 10 },
      { id: two.id, axis: "y", position: 20 },
    ])
    expect(two.id).not.toBe(one.id)
  })

  test("an id stays unique after an earlier guide is removed", () => {
    const a = addGuide([], "x", 1)
    const b = addGuide(a.guides, "x", 2)
    const c = addGuide(removeGuide(b.guides, a.id), "x", 3)
    expect(c.id).not.toBe(b.id)
  })

  test("moving and removing touch only the named guide", () => {
    const a = addGuide([], "x", 1)
    const b = addGuide(a.guides, "y", 2)
    expect(moveGuide(b.guides, a.id, 5)).toEqual([
      { id: a.id, axis: "x", position: 5 },
      { id: b.id, axis: "y", position: 2 },
    ])
    expect(removeGuide(b.guides, a.id)).toEqual([
      { id: b.id, axis: "y", position: 2 },
    ])
  })

  test("a guide lives on a finite line", () => {
    expect(() => addGuide([], "x", Number.NaN)).toThrow()
    const a = addGuide([], "x", 1)
    expect(() => moveGuide(a.guides, a.id, Infinity)).toThrow()
  })
})

describe("guides from outside", () => {
  test("well-formed guides read back unchanged", () => {
    const guides: Guide[] = [
      { id: "guide-1", axis: "x", position: 12.5 },
      { id: "guide-2", axis: "y", position: -4 },
    ]
    expect(normaliseGuides(guides)).toEqual(guides)
  })

  test("anything else is dropped rather than stored", () => {
    expect(normaliseGuides(undefined)).toEqual([])
    expect(normaliseGuides("nope")).toEqual([])
    expect(
      normaliseGuides([
        { id: "guide-1", axis: "z", position: 1 },
        { id: "guide-2", axis: "x", position: "1" },
        { id: "guide-3", axis: "x", position: Number.NaN },
        { axis: "x", position: 1 },
        null,
        { id: "guide-4", axis: "x", position: 3, extra: true },
        { id: "guide-4", axis: "y", position: 9 },
      ])
    ).toEqual([{ id: "guide-4", axis: "x", position: 3 }])
  })

  test("a document holds a bounded number of guides", () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({
      id: `guide-${i}`,
      axis: "x",
      position: i,
    }))
    expect(normaliseGuides(many).length).toBeLessThan(1000)
  })
})

describe("guides as snap targets", () => {
  test("each guide adds its line to its own axis", () => {
    const base = snapTargets({ width: 100, height: 50 }, [])
    const a = addGuide([], "x", 30)
    const b = addGuide(a.guides, "y", 7)
    expect(guideSnapTargets(base, b.guides)).toEqual({
      x: [0, 50, 100, 30],
      y: [0, 25, 50, 7],
    })
  })
})
