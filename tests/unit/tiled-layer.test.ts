import { describe, expect, test } from "bun:test"
import { decodeFloat16, encodeFloat16 } from "../../engine/doc/float16"
import { createTiledLayer } from "../../engine/doc/tiled-layer"

const transparent = [0, 0, 0, 0]

describe("half-float storage", () => {
  test("round-trips values a painted tile actually holds", () => {
    for (const value of [0, 1, 0.5, 0.25, 0.0625, 2, 1024]) {
      expect(decodeFloat16(encodeFloat16(value))).toBe(value)
    }
  })

  test("keeps sign and survives subnormal and overflowing magnitudes", () => {
    expect(decodeFloat16(encodeFloat16(-0.5))).toBe(-0.5)
    expect(decodeFloat16(encodeFloat16(1e-8))).toBe(0)
    expect(decodeFloat16(encodeFloat16(1e6))).toBe(Infinity)
  })

  test("holds a linear-light value to better than 8-bit precision", () => {
    const value = 0.2140411
    expect(Math.abs(decodeFloat16(encodeFloat16(value)) - value)).toBeLessThan(
      1 / 2048
    )
  })
})

describe("sparse tile allocation", () => {
  test("a fresh layer holds no tiles", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    expect(layer.tileCount()).toBe(0)
  })

  test("absent tiles read as fully transparent", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    expect(Array.from(layer.readPixel(700, 900))).toEqual(transparent)
    expect(layer.tileCount()).toBe(0)
  })

  test("writing allocates only the tile written into", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    layer.fillRect({ x: 300, y: 4, width: 2, height: 2 }, [1, 0.5, 0.25, 1])
    expect(layer.tileCount()).toBe(1)
    expect(layer.tiles().map((tile) => [tile.x, tile.y])).toEqual([[1, 0]])
  })

  test("a fill spanning tiles allocates each tile it reaches", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    layer.fillRect({ x: 250, y: 250, width: 12, height: 12 }, [1, 1, 1, 1])
    expect(layer.tileCount()).toBe(4)
  })

  test("a fill reads back as what was written", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    layer.fillRect({ x: 10, y: 10, width: 4, height: 4 }, [0.5, 0.25, 0.125, 1])
    expect(Array.from(layer.readPixel(11, 12))).toEqual([0.5, 0.25, 0.125, 1])
    expect(Array.from(layer.readPixel(14, 12))).toEqual(transparent)
  })

  test("fills are clipped to the layer and never allocate outside it", () => {
    const layer = createTiledLayer({ width: 300, height: 64 })
    layer.fillRect({ x: -50, y: -50, width: 1000, height: 1000 }, [1, 1, 1, 1])
    expect(layer.tiles().map((tile) => [tile.x, tile.y])).toEqual([
      [0, 0],
      [1, 0],
    ])
    expect(Array.from(layer.readPixel(299, 63))).toEqual([1, 1, 1, 1])
  })

  test("pixels outside the layer read as transparent", () => {
    const layer = createTiledLayer({ width: 64, height: 64 })
    layer.fillRect({ x: 0, y: 0, width: 64, height: 64 }, [1, 1, 1, 1])
    expect(Array.from(layer.readPixel(-1, 10))).toEqual(transparent)
    expect(Array.from(layer.readPixel(10, -1))).toEqual(transparent)
    expect(Array.from(layer.readPixel(64, 10))).toEqual(transparent)
  })

  test("a fill with no area allocates nothing", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    layer.fillRect({ x: 10, y: 10, width: 0, height: 10 }, [1, 1, 1, 1])
    expect(layer.tileCount()).toBe(0)
  })
})

describe("layer dirty tracking", () => {
  test("a fill marks exactly the region it covered", () => {
    const layer = createTiledLayer({ width: 1024, height: 1024 })
    layer.fillRect({ x: 8, y: 6, width: 4, height: 4 }, [1, 1, 1, 1])
    expect(layer.dirtyBounds()).toEqual({ x: 8, y: 6, width: 4, height: 4 })
    layer.clearDirty()
    expect(layer.dirtyBounds()).toBeNull()
  })

  test("dirty bounds are clipped, so an off-canvas fill dirties nothing", () => {
    const layer = createTiledLayer({ width: 64, height: 64 })
    layer.fillRect({ x: 500, y: 500, width: 4, height: 4 }, [1, 1, 1, 1])
    expect(layer.dirtyBounds()).toBeNull()
  })
})
