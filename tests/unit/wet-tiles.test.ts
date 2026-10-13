import { describe, expect, test } from "bun:test"
import { createWetTiles, WET_SLOTS } from "../../engine/gpu/wet-tiles"

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

describe("the wet tile limit", () => {
  /** Takes every slot: a row of tiles from the left, on row `y`. */
  function fillRow(tiles: ReturnType<typeof createWetTiles>, y: number) {
    for (let x = 0; x < WET_SLOTS; x++) tiles.touch(x, y)
  }

  test("with a slot free, or off the grid, nothing has to make room", () => {
    const tiles = createWetTiles(8, 8)
    tiles.touch(0, 0)
    expect(tiles.crowding(4, 4)).toEqual([])
    const full = createWetTiles(WET_SLOTS, 4)
    fillRow(full, 0)
    expect(full.crowding(-1, 0)).toEqual([])
    expect(full.crowding(0, 4)).toEqual([])
    // A tile that already holds a slot needs none.
    expect(full.crowding(3, 0)).toEqual([])
  })

  test("with every slot taken, the body with the earliest deadline makes room, whole", () => {
    const tiles = createWetTiles(40, 40)
    // Three bodies, clear of each other: 30 tiles, 4 and 30.
    for (let x = 0; x < 30; x++) tiles.touch(x, 0)
    for (let x = 0; x < 4; x++) tiles.touch(x, 10)
    for (let x = 0; x < 30; x++) tiles.touch(x, 20)
    tiles.refresh(0, 0, 300)
    tiles.refresh(0, 10, 100)
    tiles.refresh(0, 20, 200)
    expect(tiles.count()).toBe(WET_SLOTS)
    expect(tiles.touch(0, 30)).toBe(-1)

    const room = tiles.crowding(0, 30)
    expect(room.map((slot) => tiles.tile(slot))).toEqual([
      { x: 0, y: 10 },
      { x: 1, y: 10 },
      { x: 2, y: 10 },
      { x: 3, y: 10 },
    ])
    for (const slot of room) tiles.release(slot)
    expect(tiles.touch(0, 30)).toBeGreaterThanOrEqual(0)
  })

  test("the body the tile would join is the last to make room", () => {
    const tiles = createWetTiles(WET_SLOTS, 40)
    for (let x = 0; x < 60; x++) tiles.touch(x, 0)
    for (let x = 0; x < 4; x++) tiles.touch(x, 10)
    // The long one is due first, and is the one being painted into.
    tiles.refresh(0, 0, 100)
    tiles.refresh(0, 10, 900)
    const room = tiles.crowding(60, 0)
    expect(room.map((slot) => tiles.tile(slot)!.y)).toEqual([10, 10, 10, 10])
    // A corner is enough to be the same body.
    expect(tiles.crowding(60, 1)).toEqual(room)
  })

  test("a body painted this frame is spared too, wherever the tile is", () => {
    const tiles = createWetTiles(40, 40)
    for (let x = 0; x < 32; x++) tiles.touch(x, 0)
    for (let x = 0; x < 32; x++) tiles.touch(x, 10)
    // Due together, so the first would go: but a dab has just landed in it.
    tiles.refresh(0, 0, 100)
    tiles.refresh(0, 10, 100)
    const room = tiles.crowding(0, 30, new Set([5]))
    expect(room.map((slot) => tiles.tile(slot)!.y)).toEqual(
      Array.from({ length: 32 }, () => 10)
    )
    // With a dab in each, it is back to the one due first.
    expect(tiles.crowding(0, 30, new Set([5, 40]))[0]).toBe(0)
  })

  test("a body that is the only one makes room for its own next tile", () => {
    const tiles = createWetTiles(WET_SLOTS + 1, 2)
    fillRow(tiles, 0)
    tiles.refresh(0, 0, 100)
    expect(tiles.crowding(WET_SLOTS, 0)).toHaveLength(WET_SLOTS)
  })

  test("bodies due together make room in slot order", () => {
    const tiles = createWetTiles(40, 40)
    for (let x = 0; x < 32; x++) tiles.touch(x, 0)
    for (let x = 0; x < 32; x++) tiles.touch(x, 10)
    tiles.refresh(0, 0, 100)
    tiles.refresh(0, 10, 100)
    expect(tiles.crowding(0, 30)[0]).toBe(0)
  })

  test("a wash far past the limit never holds more slots than there are", () => {
    const tiles = createWetTiles(20, 20)
    let most = 0
    let laid = 0
    for (let y = 0; y < 20; y++)
      for (let x = 0; x < 20; x++) {
        let slot = tiles.touch(x, y)
        if (slot < 0) {
          for (const freed of tiles.crowding(x, y)) tiles.release(freed)
          slot = tiles.touch(x, y)
        }
        if (slot >= 0) laid++
        tiles.refresh(x, y, y * 20 + x)
        most = Math.max(most, tiles.count())
      }
    // Every tile took a slot, and no more were ever held than exist.
    expect(laid).toBe(400)
    expect(most).toBe(WET_SLOTS)
    expect(Math.max(...tiles.map())).toBeLessThanOrEqual(WET_SLOTS)
  })
})
