import { decodeFloat16, encodeFloat16 } from "./float16"
import {
  createDirtyRegion,
  intersectRect,
  isEmptyRect,
  type PixelRect,
  TILE_CHANNELS,
  TILE_SIZE,
  TILE_TEXELS,
  type TileCoord,
  tileBounds,
  tileIndexForPixel,
  tileKey,
  tilesCoveringRect,
} from "./tile-grid"

/** Premultiplied linear-light RGBA. No transfer curve has been applied. */
export type LinearColor = readonly [number, number, number, number]

export type Tile = TileCoord & {
  /** Raw rgba16float texels, row-major, ready to upload without conversion. */
  readonly texels: Uint16Array
}

export interface TiledLayer {
  readonly width: number
  readonly height: number
  fillRect(rect: PixelRect, color: LinearColor): void
  /** Absent tiles read as fully transparent and stay unallocated. */
  readPixel(x: number, y: number): Float32Array
  tiles(): Tile[]
  tileCount(): number
  dirtyBounds(): PixelRect | null
  clearDirty(): void
}

/**
 * A sparse tiled surface: 256x256 rgba16float tiles, premultiplied, in linear
 * light (D3, D10). A tile exists only once something is written into it, which
 * is what makes a 50-layer document at 8192 square affordable at all.
 */
export function createTiledLayer(size: {
  width: number
  height: number
}): TiledLayer {
  return createTiledLayerFromTiles(size, [])
}

/** Copies sparse pixel storage so duplicated layers can diverge safely. */
export function cloneTiledLayer(source: TiledLayer): TiledLayer {
  return createTiledLayerFromTiles(
    { width: source.width, height: source.height },
    source.tiles()
  )
}

function createTiledLayerFromTiles(
  size: { width: number; height: number },
  initialTiles: readonly Tile[]
): TiledLayer {
  const { width, height } = size
  const canvas: PixelRect = { x: 0, y: 0, width, height }
  const tiles = new Map<string, Tile>(
    initialTiles.map((tile) => [
      tileKey(tile.x, tile.y),
      { x: tile.x, y: tile.y, texels: new Uint16Array(tile.texels) },
    ])
  )
  const dirty = createDirtyRegion()

  function allocate(coord: TileCoord): Tile {
    const key = tileKey(coord.x, coord.y)
    const existing = tiles.get(key)
    if (existing) return existing
    // A zeroed tile is transparent black, which is exactly "absent".
    const tile: Tile = {
      x: coord.x,
      y: coord.y,
      texels: new Uint16Array(TILE_TEXELS * TILE_CHANNELS),
    }
    tiles.set(key, tile)
    return tile
  }

  return {
    width,
    height,
    fillRect(rect, color) {
      const clipped = intersectRect(rect, canvas)
      if (!clipped || isEmptyRect(clipped)) return
      const encoded = color.map(encodeFloat16)
      for (const coord of tilesCoveringRect(clipped)) {
        const span = intersectRect(clipped, tileBounds(coord))
        if (!span) continue
        const tile = allocate(coord)
        for (let y = span.y; y < span.y + span.height; y++) {
          const row = (y - coord.y * TILE_SIZE) * TILE_SIZE
          for (let x = span.x; x < span.x + span.width; x++) {
            const offset = (row + (x - coord.x * TILE_SIZE)) * TILE_CHANNELS
            tile.texels.set(encoded, offset)
          }
        }
      }
      dirty.include(clipped)
    },
    readPixel(x, y) {
      // Outside the layer nothing was ever written, so nothing is there.
      if (x < 0 || y < 0 || x >= width || y >= height)
        return new Float32Array(TILE_CHANNELS)
      const tile = tiles.get(
        tileKey(tileIndexForPixel(x), tileIndexForPixel(y))
      )
      if (!tile) return new Float32Array(TILE_CHANNELS)
      const offset =
        ((y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)) * TILE_CHANNELS
      return Float32Array.from(
        tile.texels.subarray(offset, offset + TILE_CHANNELS),
        decodeFloat16
      )
    },
    tiles: () => [...tiles.values()],
    tileCount: () => tiles.size,
    dirtyBounds: () => dirty.bounds(),
    clearDirty: () => dirty.clear(),
  }
}
