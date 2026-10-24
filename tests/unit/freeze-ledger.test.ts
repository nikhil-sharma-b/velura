import { describe, expect, test } from "bun:test"
import { createFreezeLedger } from "../../engine/gpu/freeze-ledger"

describe("freeze ledger", () => {
  test("a rectangle takes every chunk it touches, once", () => {
    const ledger = createFreezeLedger(4096, 4096, 1024)
    expect(ledger.take(1000, 10, 1030, 40)).toEqual([
      { x: 0, y: 0, width: 1024, height: 1024 },
      { x: 1024, y: 0, width: 1024, height: 1024 },
    ])
    // Read again, and written since: what is frozen stays as it was.
    expect(ledger.take(1000, 10, 1030, 40)).toEqual([])
    expect(ledger.take(1020, 1000, 1030, 1030)).toEqual([
      { x: 0, y: 1024, width: 1024, height: 1024 },
      { x: 1024, y: 1024, width: 1024, height: 1024 },
    ])
  })

  test("a rectangle ending on a chunk's edge does not take the next", () => {
    const ledger = createFreezeLedger(4096, 4096, 1024)
    expect(ledger.take(0, 0, 1024, 1024)).toEqual([
      { x: 0, y: 0, width: 1024, height: 1024 },
    ])
  })

  test("chunks at the document's edge stop at it", () => {
    const ledger = createFreezeLedger(1500, 300, 1024)
    expect(ledger.take(1000, 0, 1500, 300)).toEqual([
      { x: 0, y: 0, width: 1024, height: 300 },
      { x: 1024, y: 0, width: 476, height: 300 },
    ])
  })

  test("a rectangle reaching past the document takes only what is in it", () => {
    const ledger = createFreezeLedger(1500, 300, 1024)
    expect(ledger.take(-50, -50, 20, 4000)).toEqual([
      { x: 0, y: 0, width: 1024, height: 300 },
    ])
    expect(ledger.take(2000, 0, 2100, 100)).toEqual([])
    expect(ledger.take(30, 30, 30, 60)).toEqual([])
  })
})
