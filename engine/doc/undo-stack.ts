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

/** One undoable step: one stroke, or one discrete layer operation. */
export type UndoEntry = {
  label: string
  surfaces: SurfaceChange[]
  structure?: { before: DocumentStructure; after: DocumentStructure }
  /** Vector layers' edits (19), applied after the structure going either way. */
  scenes?: readonly SceneChange[]
  /** Set when the step is one a following adjustment may extend. */
  coalesceAs?: string
}

export interface UndoStack {
  /** Pushes a step, dropping any redo branch it supersedes. */
  push(entry: UndoEntry): void
  /**
   * Extends the step on top of the stack, if it carries `key` and is the step
   * that would be undone next. Answers whether it did.
   */
  extendTop(key: string, after: DocumentStructure): boolean
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
 */
export function createUndoStack(options: {
  store: TileStore
  budgetBytes: number
}): UndoStack {
  const { store, budgetBytes } = options
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
    },
    extendTop(key, after) {
      const top = entries[cursor - 1]
      if (
        cursor !== entries.length ||
        top?.coalesceAs !== key ||
        !top.structure
      )
        return false
      top.structure.after = after
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
    bytes,
    clear() {
      for (const entry of entries) forget(entry)
      entries.length = 0
      cursor = 0
    },
  }
}
