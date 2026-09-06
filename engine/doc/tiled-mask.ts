import { decodeFloat16, encodeFloat16 } from "./float16"
import {
  createDirtyRegion,
  intersectRect,
  isEmptyRect,
  type PixelRect,
  TILE_SIZE,
  TILE_TEXELS,
  type TileCoord,
  tileBounds,
  tileIndexForPixel,
  tileKey,
  tilesCoveringRect,
} from "./tile-grid"

export type MaskTile = TileCoord & {
  /** One half-float hidden-coverage value per texel. */
  readonly texels: Uint16Array
}

export interface TiledMask {
  readonly width: number
  readonly height: number
  fillRect(rect: PixelRect, coverage: number): void
  readPixel(x: number, y: number): number
  tiles(): MaskTile[]
  tileCount(): number
  dirtyBounds(): PixelRect | null
  clearDirty(): void
}

export function createTiledMask(size: {
  width: number
  height: number
}): TiledMask {
  return createTiledMaskFromTiles(size, [])
}

export function cloneTiledMask(source: TiledMask): TiledMask {
  return createTiledMaskFromTiles(
    { width: source.width, height: source.height },
    source.tiles()
  )
}

function createTiledMaskFromTiles(
  size: { width: number; height: number },
  initialTiles: readonly MaskTile[]
): TiledMask {
  const { width, height } = size
  const canvas: PixelRect = { x: 0, y: 0, width, height }
  const tiles = new Map<string, MaskTile>(
    initialTiles.map((tile) => [
      tileKey(tile.x, tile.y),
      { x: tile.x, y: tile.y, texels: new Uint16Array(tile.texels) },
    ])
  )
  const dirty = createDirtyRegion()

  function allocate(coord: TileCoord): MaskTile {
    const key = tileKey(coord.x, coord.y)
    const existing = tiles.get(key)
    if (existing) return existing
    const tile = {
      ...coord,
      texels: new Uint16Array(TILE_TEXELS),
    }
    tiles.set(key, tile)
    return tile
  }

  return {
    width,
    height,
    fillRect(rect, coverage) {
      if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1)
        throw new Error("Mask coverage must be a finite value in [0, 1].")
      const clipped = intersectRect(rect, canvas)
      if (!clipped || isEmptyRect(clipped)) return
      const encoded = encodeFloat16(coverage)
      for (const coord of tilesCoveringRect(clipped)) {
        const span = intersectRect(clipped, tileBounds(coord))
        if (!span) continue
        const tile = allocate(coord)
        for (let y = span.y; y < span.y + span.height; y++) {
          const row = (y - coord.y * TILE_SIZE) * TILE_SIZE
          for (let x = span.x; x < span.x + span.width; x++)
            tile.texels[row + x - coord.x * TILE_SIZE] = encoded
        }
      }
      dirty.include(clipped)
    },
    readPixel(x, y) {
      if (x < 0 || y < 0 || x >= width || y >= height) return 0
      const tile = tiles.get(
        tileKey(tileIndexForPixel(x), tileIndexForPixel(y))
      )
      if (!tile) return 0
      return decodeFloat16(
        tile.texels[(y % TILE_SIZE) * TILE_SIZE + (x % TILE_SIZE)]
      )
    },
    tiles: () => [...tiles.values()],
    tileCount: () => tiles.size,
    dirtyBounds: () => dirty.bounds(),
    clearDirty: () => dirty.clear(),
  }
}
