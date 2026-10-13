import type { TileStore } from "./tile-store"
import type { DocumentStructure } from "./structure"
import type { SceneChange } from "./vector-scene"

/**
 * One tile as an operation left it: the hash it held before and the hash it
 * holds after. An absent hash means the tile held nothing, which is what a
 * layer that did not exist yet — or no longer does — looks like.
 */
export type TileChange = {
  x: number
  y: number
  before?: string
  after?: string
}

export type SurfaceChange = {
  surfaceId: string
  tiles: TileChange[]
}

/**
 * A copy of a layer's wet fields (D42) as they were at one moment, held on
 * the GPU by whoever took it. History keeps it and says when it is done with
 * it, and never looks inside: `bytes` is all it is told.
 */
export type WetCopy = { readonly bytes: number }

/** One undoable step: one stroke, or one discrete layer operation. */
export type UndoEntry = {
  label: string
  surfaces: SurfaceChange[]
  structure?: { before: DocumentStructure; after: DocumentStructure }
  /** Vector layers' edits (19), applied after the structure going either way. */
  scenes?: readonly SceneChange[]
  /** Set when the step is one a following adjustment may extend. */
  coalesceAs?: string
  /**
   * Set when the step is a fluid stroke whose paint is still wet (D42). No
   * tile changed, so it names none: it holds the wet fields as they were at
   * pen-down, and once undone, as they were at the moment of the undo.
   */
  wet?: { surfaceId: string; before: WetCopy; after?: WetCopy }
}

export interface UndoStack {
  /** Pushes a step, dropping any redo branch it supersedes. */
  push(entry: UndoEntry): void
  /**
   * Extends the step on top of the stack, if it carries `key` and is the step
   * that would be undone next. Answers whether it did. A step that edited
   * scenes takes the latest edit's commands forward and keeps its own
   * inverse, so undoing the run still lands where it started; the key is
   * what promises the edits touched the same objects.
   */
  extendTop(
    key: string,
    after: DocumentStructure,
    scenes?: readonly SceneChange[]
  ): boolean
  canUndo(): boolean
  canRedo(): boolean
  /** Moves the cursor back and returns the step to invert. */
  undo(): UndoEntry | undefined
  /** Moves the cursor forward and returns the step to reapply. */
  redo(): UndoEntry | undefined
  depth(): number
  /** How many steps are behind the cursor: what undo can still take back. */
  stepsBack(): number
  /** The step undo would take back next, by identity. */
  top(): UndoEntry | undefined
  /**
   * Gives an undone wet stroke the copy redo restores, letting go of the one
   * it had from being undone before.
   */
  keepWetAfter(entry: UndoEntry, copy: WetCopy): void
  /**
   * Takes every wet stroke out of the stack, undone or not, and lets their
   * copies go: the fields they describe no longer exist. Answers whether
   * there were any.
   */
  dropWet(): boolean
  /** How many of the steps behind the cursor are wet strokes. */
  wetSteps(): number
  /** Bytes of the wet copies the stack is holding. */
  wetBytes(): number
  /** Logical bytes of the distinct tiles the stack is holding on to. */
  bytes(): number
  clear(): void
}

/**
 * The byte-budgeted ring (D21). Steps vary by orders of magnitude — a dot is
 * one tile, a wash across the canvas is hundreds — so a fixed step count
 * either wastes memory or throws away history the artist still wants. The
 * budget counts distinct tiles, because content addressing means a tile two
 * steps share is stored once and should be charged once.
 *
 * It counts logical tiles rather than resident ones on purpose. What the tab
 * holds in memory is already bounded by the store's own hot and warm pools,
 * whatever history asks of it; this budget is what bounds the spill device,
 * since a tile leaves disk when the last step naming it is dropped.
 *
 * Wet strokes' copies are GPU memory and no tile, so they are bounded by a
 * budget of their own. Past it the oldest copy goes, and its step with it: a
 * wet stroke that cannot be restored is not a step.
 */
export function createUndoStack(options: {
  store: TileStore
  budgetBytes: number
  wetBudgetBytes?: number
  /** Told of each wet copy the stack is done with. */
  releaseWet?: (copy: WetCopy) => void
}): UndoStack {
  const { store, budgetBytes } = options
  const wetBudgetBytes = options.wetBudgetBytes ?? Infinity
  const entries: UndoEntry[] = []
  /** How many entries are applied; everything past it is the redo branch. */
  let cursor = 0
  /** References this stack holds, per hash, so trimming releases exactly its own. */
  const held = new Map<string, number>()

  function retain(hash: string | undefined) {
    if (!hash) return
    held.set(hash, (held.get(hash) ?? 0) + 1)
    store.retain(hash)
  }

  function release(hash: string | undefined) {
    if (!hash) return
    const count = held.get(hash)
    if (!count) return
    if (count === 1) held.delete(hash)
    else held.set(hash, count - 1)
    store.release(hash)
  }

  function hashes(entry: UndoEntry): (string | undefined)[] {
    return entry.surfaces.flatMap((surface) =>
      surface.tiles.flatMap((tile) => [tile.before, tile.after])
    )
  }

  function forget(entry: UndoEntry) {
    for (const hash of hashes(entry)) release(hash)
    if (!entry.wet) return
    options.releaseWet?.(entry.wet.before)
    if (entry.wet.after) options.releaseWet?.(entry.wet.after)
  }

  /** Takes a step out from wherever it is, keeping the cursor on its step. */
  function remove(index: number) {
    forget(entries.splice(index, 1)[0])
    if (index < cursor) cursor--
  }

  function wetBytes() {
    let bytes = 0
    for (const { wet } of entries)
      if (wet) bytes += wet.before.bytes + (wet.after?.bytes ?? 0)
    return bytes
  }

  function trimWet() {
    while (wetBytes() > wetBudgetBytes)
      remove(entries.findIndex((entry) => entry.wet))
  }

  function trim() {
    // The oldest step is the one furthest from what the artist is doing now,
    // and it is dropped whole: half a step is not a state anything can reach.
    while (entries.length > 1 && bytes() > budgetBytes && cursor > 0) {
      forget(entries.shift()!)
      cursor--
    }
  }

  function bytes() {
    return held.size * store.tileBytes
  }

  return {
    push(entry) {
      for (const dropped of entries.splice(cursor)) forget(dropped)
      entries.push(entry)
      cursor = entries.length
      for (const hash of hashes(entry)) retain(hash)
      trim()
      trimWet()
    },
    extendTop(key, after, scenes) {
      const top = entries[cursor - 1]
      if (
        cursor !== entries.length ||
        top?.coalesceAs !== key ||
        !top.structure ||
        (scenes?.length ?? 0) !== (top.scenes?.length ?? 0) ||
        scenes?.some((change, i) => change.layerId !== top.scenes![i].layerId)
      )
        return false
      top.structure.after = after
      if (scenes)
        top.scenes = scenes.map((change, i) => ({
          ...change,
          inverse: top.scenes![i].inverse,
        }))
      return true
    },
    canUndo: () => cursor > 0,
    canRedo: () => cursor < entries.length,
    undo() {
      if (cursor === 0) return undefined
      return entries[--cursor]
    },
    redo() {
      if (cursor === entries.length) return undefined
      return entries[cursor++]
    },
    depth: () => entries.length,
    stepsBack: () => cursor,
    top: () => entries[cursor - 1],
    keepWetAfter(entry, copy) {
      if (!entry.wet || !entries.includes(entry)) {
        options.releaseWet?.(copy)
        return
      }
      if (entry.wet.after) options.releaseWet?.(entry.wet.after)
      entry.wet.after = copy
      trimWet()
    },
    dropWet() {
      let dropped = false
      for (let index = entries.length - 1; index >= 0; index--)
        if (entries[index].wet) {
          remove(index)
          dropped = true
        }
      return dropped
    },
    wetSteps: () =>
      entries.slice(0, cursor).filter((entry) => entry.wet).length,
    wetBytes,
    bytes,
    clear() {
      for (const entry of entries) forget(entry)
      entries.length = 0
      cursor = 0
    },
  }
}
