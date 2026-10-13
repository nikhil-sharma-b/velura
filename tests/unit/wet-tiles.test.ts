import { describe, expect, test } from "bun:test"
import { createWetTiles } from "../../engine/gpu/wet-tiles"

describe("wet tiles kept and put back", () => {
  test("restoring puts back the slots, the map and the deadlines", () => {
    const tiles = createWetTiles(4, 4)
    tiles.touch(1, 1)
    tiles.refresh(1, 1, 50)
    const kept = tiles.save()

    // A second body, the first pushed out, and then the first let go.
    tiles.touch(3, 3)
    tiles.refresh(3, 3, 80)
    tiles.refresh(1, 1, 200)
    tiles.release(0)
    expect(tiles.slots()).toEqual([1])

    tiles.restore(kept)
    expect(tiles.slots()).toEqual([0])
    expect(tiles.count()).toBe(1)
    expect(tiles.tile(0)).toEqual({ x: 1, y: 1 })
    expect([...tiles.map()].filter((slot) => slot > 0)).toEqual([1])
    expect(tiles.map()[1 * 4 + 1]).toBe(1)
    // The deadline is the one it had: not due before it, due at it.
    expect(tiles.expired(49)).toEqual([])
    expect(tiles.expired(50)).toEqual([0])
  })

  test("what was kept is not changed by what happens after", () => {
    const tiles = createWetTiles(4, 4)
    tiles.touch(0, 0)
    tiles.refresh(0, 0, 10)
    const kept = tiles.save()
    tiles.refresh(0, 0, 500)
    tiles.touch(1, 0)
    tiles.restore(kept)
    // Restored twice over, with painting in between, it is the same state.
    tiles.touch(2, 2)
    tiles.refresh(0, 0, 900)
    tiles.restore(kept)
    expect(tiles.slots()).toEqual([0])
    expect(tiles.expired(10)).toEqual([0])
  })

  test("restoring nothing wet leaves nothing wet", () => {
    const tiles = createWetTiles(2, 2)
    const dry = tiles.save()
    tiles.touch(0, 0)
    tiles.touch(1, 1)
    tiles.restore(dry)
    expect(tiles.count()).toBe(0)
    expect([...tiles.map()]).toEqual([0, 0, 0, 0])
    // And the slots are free to take again, from the first.
    expect(tiles.touch(1, 0)).toBe(0)
  })
})
