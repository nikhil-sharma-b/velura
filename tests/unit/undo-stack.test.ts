import { describe, expect, test } from "bun:test"
import { createTileStore } from "../../engine/doc/tile-store"
import { TILE_CHANNELS, TILE_TEXELS } from "../../engine/doc/tile-grid"
import { createUndoStack, type UndoEntry } from "../../engine/doc/undo-stack"
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
