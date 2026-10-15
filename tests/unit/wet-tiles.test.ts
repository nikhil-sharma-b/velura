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

describe("the ring of tiles about a wet one", () => {
  test("a tile's eight neighbours are given slots, and it keeps its own", () => {
    const tiles = createWetTiles(5, 5)
    const slot = tiles.touch(2, 2)
    expect(tiles.surround(2, 2)).toBe(8)
    expect(tiles.count()).toBe(9)
    expect(tiles.touch(2, 2)).toBe(slot)
    for (let y = 1; y <= 3; y++)
      for (let x = 1; x <= 3; x++)
        expect(tiles.map()[y * 5 + x]).toBeGreaterThan(0)
    // Asked again, there is nothing left to take.
    expect(tiles.surround(2, 2)).toBe(0)
  })

  test("at the grid's corner the ring is the neighbours there are", () => {
    const tiles = createWetTiles(5, 5)
    tiles.touch(0, 0)
    expect(tiles.surround(0, 0)).toBe(3)
    expect(tiles.count()).toBe(4)
  })

  test("the ring is one body with its tile: it dries with it and is freed with it", () => {
    const tiles = createWetTiles(8, 8)
    tiles.touch(1, 1)
    tiles.surround(1, 1)
    // A second body, its ring clear of the first's.
    tiles.touch(6, 6)
    tiles.surround(6, 6)
    tiles.refresh(1, 1, 40)
    tiles.refresh(6, 6, 90)
    const due = tiles.expired(40)
    expect(due).toHaveLength(9)
    for (const slot of due) tiles.release(slot)
    expect(tiles.count()).toBe(9)
    expect([...tiles.map()].filter((slot) => slot > 0)).toHaveLength(9)
    for (const slot of tiles.expired(90)) tiles.release(slot)
    expect(tiles.count()).toBe(0)
  })

  test("two tiles whose rings touch are one body", () => {
    const tiles = createWetTiles(8, 3)
    tiles.touch(1, 1)
    tiles.surround(1, 1)
    tiles.touch(4, 1)
    tiles.surround(4, 1)
    tiles.refresh(4, 1, 70)
    expect(tiles.expired(69)).toEqual([])
    expect(tiles.expired(70)).toHaveLength(18)
  })

  test("the ring takes what slots are free and no more", () => {
    const tiles = createWetTiles(WET_SLOTS, 3)
    for (let x = 0; x < WET_SLOTS - 2; x++) tiles.touch(x, 0)
    // Two slots left for a ring of five.
    expect(tiles.surround(0, 1)).toBe(2)
    expect(tiles.count()).toBe(WET_SLOTS)
    expect(tiles.surround(10, 1)).toBe(0)
  })
})

describe("finding a tile's slot", () => {
  test("answers the slot a wet tile holds, and -1 for a dry one or off the grid", () => {
    const tiles = createWetTiles(4, 4)
    const slot = tiles.touch(1, 2)
    expect(tiles.slotAt(1, 2)).toBe(slot)
    expect(tiles.slotAt(2, 2)).toBe(-1)
    expect(tiles.slotAt(-1, 0)).toBe(-1)
    expect(tiles.slotAt(4, 0)).toBe(-1)
  })

  test("never gives a dry tile a slot", () => {
    const tiles = createWetTiles(4, 4)
    tiles.slotAt(0, 0)
    expect(tiles.count()).toBe(0)
    expect(tiles.map().every((byte) => byte === 0)).toBe(true)
  })
})

describe("bodies held while drying is paused", () => {
  test("a body whose deadline has passed is held, whole, and one still due is not", () => {
    const tiles = createWetTiles(10, 10)
    // Two bodies, clear of each other: two tiles due at 50, one due at 90.
    tiles.touch(0, 0)
    tiles.touch(1, 0)
    tiles.touch(5, 5)
    tiles.refresh(0, 0, 50)
    tiles.refresh(5, 5, 90)
    const held = new Uint8Array(WET_SLOTS)

    expect(tiles.due(49, held)).toBe(0)
    expect([...held].every((byte) => byte === 0)).toBe(true)

    expect(tiles.due(50, held)).toBe(2)
    expect(held[tiles.slotAt(0, 0)]).toBe(1)
    expect(held[tiles.slotAt(1, 0)]).toBe(1)
    expect(held[tiles.slotAt(5, 5)]).toBe(0)

    // A dab into it pushes its deadline back: it moves again.
    tiles.refresh(1, 0, 120)
    expect(tiles.due(60, held)).toBe(0)
    expect(held[tiles.slotAt(0, 0)]).toBe(0)
  })
})

describe("the wet tile limit while drying is paused", () => {
  /** Every slot taken by two held bodies and a moving one, clear of each other. */
  function crowded() {
    const tiles = createWetTiles(40, 40)
    // Painted first, by a slow brush: due last of the two held.
    for (let x = 0; x < 20; x++) tiles.touch(x, 0)
    tiles.refresh(0, 0, 100)
    // Painted second, by a fast brush: due first.
    for (let x = 0; x < 20; x++) tiles.touch(x, 10)
    tiles.refresh(0, 10, 50)
    // Painted last, and still moving.
    for (let x = 0; x < WET_SLOTS - 40; x++) tiles.touch(x, 20)
    tiles.refresh(0, 20, 500)
    return tiles
  }
  const rows = (
    tiles: ReturnType<typeof createWetTiles>,
    slots: readonly number[]
  ) => new Set(slots.map((slot) => tiles.tile(slot)!.y))

  test("a held body makes room before one still moving, the one least recently painted into first", () => {
    const tiles = crowded()
    expect(rows(tiles, tiles.crowding(0, 30, undefined, 200))).toEqual(
      new Set([0])
    )
  })

  test("paused or not, a body still moving waits for every held one", () => {
    const tiles = crowded()
    // Only the fast brush's body is held at 60.
    expect(rows(tiles, tiles.crowding(0, 30, undefined, 60))).toEqual(
      new Set([10])
    )
  })

  test("unpaused, the body due first makes room, as before", () => {
    const tiles = crowded()
    expect(rows(tiles, tiles.crowding(0, 30))).toEqual(new Set([10]))
  })

  test("a held body being painted into is still the last to make room", () => {
    const tiles = crowded()
    // The tile joins the body painted first.
    expect(rows(tiles, tiles.crowding(20, 0, undefined, 200))).toEqual(
      new Set([10])
    )
  })

  test("a ring that reaches a held body's tile is not paint laid in it", () => {
    const tiles = crowded()
    // A ring about a tile beside the body painted first takes in its tile
    // (19, 0) without a dab landing there; the ring takes the last free slot.
    tiles.release(tiles.slotAt(0, 20))
    tiles.surround(20, 1)
    expect(rows(tiles, tiles.crowding(0, 30, undefined, 200))).toEqual(
      new Set([0])
    )
  })

  test("painting a held body again makes it the most recently painted", () => {
    const tiles = crowded()
    tiles.touch(3, 0)
    expect(rows(tiles, tiles.crowding(0, 30, undefined, 200))).toEqual(
      new Set([10])
    )
  })
})
