import { describe, expect, test } from "bun:test"
import { createTileStore } from "../../engine/doc/tile-store"
import { TILE_CHANNELS, TILE_TEXELS } from "../../engine/doc/tile-grid"
import {
  createUndoStack,
  type UndoEntry,
  type WetCopy,
} from "../../engine/doc/undo-stack"
import type { DocumentStructure } from "../../engine/doc/structure"
import type { SceneChange } from "../../engine/doc/vector-scene"

const TILE_BYTES = TILE_TEXELS * TILE_CHANNELS * 2

function tile(seed: number): Uint16Array {
  const texels = new Uint16Array(TILE_TEXELS * TILE_CHANNELS)
  texels[0] = seed
  texels[1] = seed >> 16
  return texels
}

function setup(budgetBytes = 1 << 30) {
  const store = createTileStore({ hotBytes: 1 << 30, warmBytes: 1 << 30 })
  return { store, stack: createUndoStack({ store, budgetBytes }) }
}

/** One step that turns one tile from `before` into `after`. */
function step(
  store: ReturnType<typeof setup>["store"],
  label: string,
  before: number | undefined,
  after: number | undefined
): UndoEntry {
  const put = (seed: number | undefined) =>
    seed === undefined ? undefined : store.put(tile(seed))
  return {
    label,
    surfaces: [
      {
        surfaceId: "layer",
        tiles: [{ x: 0, y: 0, before: put(before), after: put(after) }],
      },
    ],
  }
}

describe("the undo stack", () => {
  test("a fresh stack has nothing to undo or redo", () => {
    const { stack } = setup()
    expect(stack.canUndo()).toBe(false)
    expect(stack.canRedo()).toBe(false)
    expect(stack.undo()).toBeUndefined()
    expect(stack.redo()).toBeUndefined()
  })

  test("steps come back newest first and then go forward again", () => {
    const { store, stack } = setup()
    stack.push(step(store, "first", undefined, 1))
    stack.push(step(store, "second", 1, 2))
    expect(stack.undo()?.label).toBe("second")
    expect(stack.undo()?.label).toBe("first")
    expect(stack.canUndo()).toBe(false)
    expect(stack.redo()?.label).toBe("first")
    expect(stack.redo()?.label).toBe("second")
    expect(stack.canRedo()).toBe(false)
  })

  test("painting after undoing drops the branch that was undone", () => {
    const { store, stack } = setup()
    stack.push(step(store, "first", undefined, 1))
    stack.push(step(store, "second", 1, 2))
    stack.undo()
    stack.push(step(store, "third", 1, 3))
    expect(stack.canRedo()).toBe(false)
    expect(stack.depth()).toBe(2)
    expect(stack.undo()?.label).toBe("third")
  })

  test("a dropped branch stops holding its tiles", () => {
    const { store, stack } = setup()
    stack.push(step(store, "first", undefined, 1))
    const branch = step(store, "second", 1, 2)
    stack.push(branch)
    const abandoned = branch.surfaces[0].tiles[0].after!
    store.release(abandoned)
    stack.undo()
    stack.push(step(store, "third", 1, 3))
    expect(store.tier(abandoned)).toBe("absent")
  })
})

describe("the byte budget", () => {
  test("history is bounded by bytes, not by a step count", () => {
    const { store, stack } = setup(TILE_BYTES * 3)
    for (let seed = 0; seed < 20; seed++) {
      const entry = step(store, `step ${seed}`, seed, seed + 1)
      stack.push(entry)
      for (const change of entry.surfaces[0].tiles)
        for (const hash of [change.before, change.after])
          if (hash) store.release(hash)
    }
    expect(stack.bytes()).toBeLessThanOrEqual(TILE_BYTES * 3)
    // Steps survived, so the bound came off the oldest and not off everything.
    expect(stack.depth()).toBeGreaterThan(1)
    expect(stack.canUndo()).toBe(true)
  })

  test("dropping the oldest step frees its pixels", () => {
    const { store, stack } = setup(TILE_BYTES * 2)
    const oldest = step(store, "oldest", undefined, 100)
    stack.push(oldest)
    const hash = oldest.surfaces[0].tiles[0].after!
    store.release(hash)
    for (let seed = 0; seed < 6; seed++) {
      const entry = step(store, `step ${seed}`, seed, seed + 1)
      stack.push(entry)
      for (const change of entry.surfaces[0].tiles)
        for (const value of [change.before, change.after])
          if (value) store.release(value)
    }
    expect(store.tier(hash)).toBe("absent")
  })

  test("clearing releases everything the stack was holding", () => {
    const { store, stack } = setup()
    const entry = step(store, "only", undefined, 42)
    stack.push(entry)
    const hash = entry.surfaces[0].tiles[0].after!
    store.release(hash)
    stack.clear()
    expect(stack.canUndo()).toBe(false)
    expect(store.tier(hash)).toBe("absent")
  })

  test("a run of scene edits under one key is one step, undoing to the start", () => {
    const { stack } = setup()
    const structure = {} as DocumentStructure
    const recolour = (from: string, to: string): SceneChange =>
      ({
        layerId: "v",
        forward: [{ type: "update", id: "o", patch: { name: to } }],
        inverse: [{ type: "update", id: "o", patch: { name: from } }],
      }) as unknown as SceneChange
    stack.push({
      label: "style objects",
      surfaces: [],
      structure: { before: structure, after: structure },
      scenes: [recolour("red", "green")],
      coalesceAs: "style:v:o:fillColor",
    })
    expect(
      stack.extendTop("style:v:o:fillColor", structure, [
        recolour("green", "blue"),
      ])
    ).toBe(true)
    expect(stack.depth()).toBe(1)
    const [scene] = stack.top()!.scenes!
    expect(scene.forward).toEqual(recolour("green", "blue").forward)
    expect(scene.inverse).toEqual(recolour("red", "green").inverse)
    // Another layer's edit is another step.
    expect(
      stack.extendTop("style:v:o:fillColor", structure, [
        { ...recolour("blue", "pink"), layerId: "w" },
      ])
    ).toBe(false)
  })
})

describe("wet stroke steps", () => {
  /** A stack whose wet copies are counted as they are let go. */
  function wetSetup(wetBudgetBytes = 1 << 30) {
    const store = createTileStore({ hotBytes: 1 << 30, warmBytes: 1 << 30 })
    const released: WetCopy[] = []
    const stack = createUndoStack({
      store,
      budgetBytes: 1 << 30,
      wetBudgetBytes,
      releaseWet: (copy) => released.push(copy),
    })
    return { store, stack, released }
  }

  const wet = (label: string, bytes = 100): UndoEntry => ({
    label,
    surfaces: [],
    wet: { surfaceId: "layer", before: { bytes } },
  })

  test("a wet stroke is a step like any other", () => {
    const { stack } = wetSetup()
    const first = wet("one")
    stack.push(first)
    stack.push(wet("two"))
    expect(stack.stepsBack()).toBe(2)
    expect(stack.wetSteps()).toBe(2)
    expect(stack.undo()?.label).toBe("two")
    expect(stack.wetSteps()).toBe(1)
    expect(stack.top()).toBe(first)
  })

  test("dropping the wet strokes leaves the other steps where they were", () => {
    const { store, stack, released } = wetSetup()
    stack.push(step(store, "dry", undefined, 1))
    const one = wet("one")
    stack.push(one)
    stack.push(step(store, "between", 1, 2))
    const two = wet("two")
    stack.push(two)
    stack.undo()
    stack.keepWetAfter(two, { bytes: 7 })

    stack.dropWet()
    expect(stack.depth()).toBe(2)
    expect(stack.stepsBack()).toBe(2)
    expect(stack.wetSteps()).toBe(0)
    expect(stack.top()?.label).toBe("between")
    expect(stack.canRedo()).toBe(false)
    expect(released.length).toBe(3)
    expect(released).toContain(one.wet!.before)
    expect(released).toContain(two.wet!.before)
    expect(released).toContainEqual({ bytes: 7 })
  })

  test("a step pushed over an undone wet stroke lets its copies go", () => {
    const { stack, released } = wetSetup()
    const one = wet("one")
    stack.push(one)
    stack.undo()
    stack.keepWetAfter(one, { bytes: 5 })
    stack.push(wet("two"))
    expect(released).toEqual([one.wet!.before, { bytes: 5 }])
  })

  test("keeping a second redo copy lets the first go", () => {
    const { stack, released } = wetSetup()
    const one = wet("one")
    stack.push(one)
    stack.undo()
    const first = { bytes: 5 }
    stack.keepWetAfter(one, first)
    stack.redo()
    stack.undo()
    stack.keepWetAfter(one, { bytes: 6 })
    expect(released).toEqual([first])
    expect(one.wet!.after).toEqual({ bytes: 6 })
  })

  test("copies past the budget go oldest first, each with its step", () => {
    const { store, stack, released } = wetSetup(250)
    stack.push(step(store, "dry", undefined, 1))
    const one = wet("one")
    const two = wet("two")
    const three = wet("three")
    stack.push(one)
    stack.push(two)
    expect(stack.wetBytes()).toBe(200)
    stack.push(three)
    // The oldest copy went, and the step that held it: the dry one stays.
    expect(released).toEqual([one.wet!.before])
    expect(stack.wetBytes()).toBe(200)
    expect(stack.depth()).toBe(3)
    expect(stack.stepsBack()).toBe(3)
    expect(stack.undo()).toBe(three)
    expect(stack.undo()).toBe(two)
    expect(stack.undo()?.label).toBe("dry")
  })

  test("a redo copy counts against the budget", () => {
    const { stack, released } = wetSetup(250)
    const one = wet("one")
    const two = wet("two")
    stack.push(one)
    stack.push(two)
    stack.undo()
    stack.keepWetAfter(two, { bytes: 100 })
    expect(released).toEqual([one.wet!.before])
    expect(stack.stepsBack()).toBe(0)
    expect(stack.redo()).toBe(two)
  })

  test("clearing lets every copy go", () => {
    const { stack, released } = wetSetup()
    stack.push(wet("one"))
    stack.push(wet("two"))
    stack.clear()
    expect(released.length).toBe(2)
    expect(stack.wetBytes()).toBe(0)
  })
})
