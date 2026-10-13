import { TILE_SIZE, type TileCoord } from "../doc/tile-grid"

/**
 * Sim cells along one side of a wet tile: the wet fields are held at half the
 * document's resolution (D42), so a cell is two document pixels.
 */
export const WET_CELLS = TILE_SIZE / 2

/** Document pixels along one side of a cell. */
export const WET_CELL_SIZE = TILE_SIZE / WET_CELLS

/**
 * How many tiles may be wet at once (D42): a slot each in the field
 * textures, which are allocated for this many and never grow. The one place
 * the limit is said; a dab that needs a slot past it settles a body early.
 */
export const WET_SLOTS = 64

/** Which tiles were wet at one moment, each one's slot, and its deadline. */
export type WetTilesState = {
  readonly held: readonly (TileCoord | undefined)[]
  readonly deadline: Float64Array
}

export interface WetTiles {
  /**
   * A dab reached this tile: gives it a slot if it has none. Answers the
   * slot, or -1 off the grid or with every slot taken.
   */
  touch(x: number, y: number): number
  /**
   * Gives each of this tile's eight neighbours a slot, where one is on the
   * grid, has none and there is one free: a bloom may cross into a tile no
   * dab reached (D42). They join the tile's body, and are freed with it.
   * Answers how many slots that took.
   */
  surround(x: number, y: number): number
  /**
   * The slots of the body to settle so that this tile can take one, in slot
   * order: the body due first, and the lower slot of two due together. A
   * body the tile would join, or one holding a slot of `painted`, is being
   * painted into, and is answered only when there is no other. Nothing off
   * the grid, for a tile that holds a slot, or with a slot free.
   */
  crowding(
    x: number,
    y: number,
    painted?: ReadonlySet<number>
  ): readonly number[]
  /**
   * Pushes the drying deadline of every tile in the same body as this one
   * out to the step `until`. A deadline is never pulled in.
   */
  refresh(x: number, y: number, until: number): void
  /**
   * The slots of every body whose deadline has passed by `step`, a whole
   * body at a time: one is never settled beside a neighbour still wet.
   */
  expired(step: number): readonly number[]
  /** Frees a slot. */
  release(slot: number): void
  /** The tile holding a slot, if one does. */
  tile(slot: number): TileCoord | undefined
  /** Every slot a tile holds, in slot order. */
  slots(): number[]
  /** How many tiles hold a slot. */
  count(): number
  /**
   * One byte per tile of the grid, along the rows: its slot and one, or zero
   * for a tile that is dry. What a shader finds a wet tile's slot through.
   */
  map(): Uint8Array
  /** What is wet now, to be put back later: undo is what wants it (D42). */
  save(): WetTilesState
  /** Puts back what `save` kept: the same tiles in the same slots. */
  restore(state: WetTilesState): void
}

/**
 * Which tiles of the document's grid are wet, the slot each holds in the
 * field textures, and when each dries. Wet tiles that touch, corners
 * included, are one body of water, and a body dries together. Pure
 * bookkeeping: no GPU, no pixels.
 */
export function createWetTiles(columns: number, rows: number): WetTiles {
  const map = new Uint8Array(columns * rows)
  const held: (TileCoord | undefined)[] = Array.from({ length: WET_SLOTS })
  const deadline = new Float64Array(WET_SLOTS)
  let count = 0

  const slotAt = (x: number, y: number) =>
    x < 0 || y < 0 || x >= columns || y >= rows ? -1 : map[y * columns + x] - 1

  // Kept, so that finding a body allocates nothing: it is done for every
  // dab's tile, with the pen down (D30).
  const found = new Int32Array(WET_SLOTS)
  const stack = new Int32Array(WET_SLOTS)
  const inBody = new Uint8Array(WET_SLOTS)
  const sorted = new Uint8Array(WET_SLOTS)
  const none: readonly number[] = []

  /** Fills `found` with the slots of the body a slot is in; answers how many. */
  function body(from: number): number {
    inBody.fill(0)
    let count = 0
    let top = 0
    stack[top++] = from
    inBody[from] = 1
    while (top > 0) {
      const slot = stack[--top]
      found[count++] = slot
      const tile = held[slot]!
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const next = slotAt(tile.x + dx, tile.y + dy)
          if (next < 0 || inBody[next]) continue
          inBody[next] = 1
          stack[top++] = next
        }
    }
    return count
  }

  function touch(x: number, y: number) {
    if (x < 0 || y < 0 || x >= columns || y >= rows) return -1
    const have = map[y * columns + x]
    if (have > 0) return have - 1
    const slot = held.indexOf(undefined)
    if (slot < 0) return -1
    held[slot] = { x, y }
    deadline[slot] = 0
    map[y * columns + x] = slot + 1
    count++
    return slot
  }

  return {
    touch,
    surround(x, y) {
      const before = count
      for (let dy = -1; dy <= 1 && count < WET_SLOTS; dy++)
        for (let dx = -1; dx <= 1 && count < WET_SLOTS; dx++)
          touch(x + dx, y + dy)
      return count - before
    },
    crowding(x, y, painted) {
      if (count < WET_SLOTS || x < 0 || y < 0 || x >= columns || y >= rows)
        return none
      if (map[y * columns + x] > 0) return none
      let first = -1
      let firstDue = Infinity
      let firstJoined = true
      sorted.fill(0)
      for (let slot = 0; slot < WET_SLOTS; slot++) {
        if (sorted[slot]) continue
        const size = body(slot)
        let due = 0
        let joined = false
        for (let i = 0; i < size; i++) {
          const tile = held[found[i]]!
          sorted[found[i]] = 1
          due = Math.max(due, deadline[found[i]])
          if (
            painted?.has(found[i]) ||
            (Math.abs(tile.x - x) <= 1 && Math.abs(tile.y - y) <= 1)
          )
            joined = true
        }
        // Any body before the one painted into; then the one due first.
        const sooner = joined === firstJoined ? due < firstDue : firstJoined
        if (first >= 0 && !sooner) continue
        first = slot
        firstDue = due
        firstJoined = joined
      }
      const size = body(first)
      return Array.from(found.subarray(0, size)).sort((a, b) => a - b)
    },
    refresh(x, y, until) {
      const from = slotAt(x, y)
      if (from < 0) return
      const size = body(from)
      for (let i = 0; i < size; i++)
        deadline[found[i]] = Math.max(deadline[found[i]], until)
    },
    expired(step) {
      let out: number[] | undefined
      sorted.fill(0)
      for (let slot = 0; slot < WET_SLOTS; slot++) {
        if (!held[slot] || sorted[slot]) continue
        const size = body(slot)
        let due = true
        for (let i = 0; i < size; i++) {
          sorted[found[i]] = 1
          if (deadline[found[i]] > step) due = false
        }
        if (!due) continue
        out ??= []
        for (let i = 0; i < size; i++) out.push(found[i])
      }
      return out ?? none
    },
    release(slot) {
      const tile = held[slot]
      if (!tile) return
      held[slot] = undefined
      map[tile.y * columns + tile.x] = 0
      count--
    },
    tile: (slot) => held[slot],
    slots: () =>
      held.flatMap((tile, slot) => (tile === undefined ? [] : [slot])),
    count: () => count,
    map: () => map,
    save: () => ({ held: [...held], deadline: deadline.slice() }),
    restore(state) {
      map.fill(0)
      count = 0
      for (let slot = 0; slot < WET_SLOTS; slot++) {
        const tile = state.held[slot]
        held[slot] = tile
        if (!tile) continue
        map[tile.y * columns + tile.x] = slot + 1
        count++
      }
      deadline.set(state.deadline)
    },
  }
}
