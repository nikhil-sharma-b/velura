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
 * textures, which are allocated for this many and never grow.
 */
export const WET_SLOTS = 64

export interface WetTiles {
  /**
   * A dab reached this tile: gives it a slot if it has none. Answers the
   * slot, or -1 off the grid or with every slot taken.
   */
  touch(x: number, y: number): number
  /** The tiles holding a slot, in slot order. */
  tiles(): TileCoord[]
  /** How many tiles hold a slot. */
  count(): number
  /**
   * One byte per tile of the grid, along the rows: its slot and one, or zero
   * for a tile that is dry. What a shader finds a wet tile's slot through.
   */
  map(): Uint8Array
  /** Frees every slot. */
  clear(): void
}

/**
 * Which tiles of the document's grid are wet, and the slot each holds in the
 * field textures. Pure bookkeeping: no GPU, no pixels.
 */
export function createWetTiles(columns: number, rows: number): WetTiles {
  const map = new Uint8Array(columns * rows)
  const held: (TileCoord | undefined)[] = Array.from({ length: WET_SLOTS })
  let count = 0
  return {
    touch(x, y) {
      if (x < 0 || y < 0 || x >= columns || y >= rows) return -1
      const have = map[y * columns + x]
      if (have > 0) return have - 1
      const slot = held.indexOf(undefined)
      if (slot < 0) return -1
      held[slot] = { x, y }
      map[y * columns + x] = slot + 1
      count++
      return slot
    },
    tiles: () => held.filter((tile) => tile !== undefined),
    count: () => count,
    map: () => map,
    clear() {
      map.fill(0)
      held.fill(undefined)
      count = 0
    },
  }
}
