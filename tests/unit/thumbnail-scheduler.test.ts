import { describe, expect, test } from "bun:test"

import {
  createDocument,
  addGroup,
  addLayer,
  addMask,
  selectLayer,
} from "../../engine/doc/document"
import {
  createThumbnailScheduler,
  thumbnailOwners,
} from "../../engine/view/thumbnails"

function fakeClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    setTimeout(fn: () => void, ms: number) {
      const id = nextId++
      timers.set(id, { at: now + ms, fn })
      return id
    },
    clearTimeout(id: unknown) {
      timers.delete(id as number)
    },
    advance(ms: number) {
      now += ms
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id)
          timer.fn()
        }
    },
  }
}

function scheduler(busy = () => false) {
  const clock = fakeClock()
  const draws: string[][] = []
  const thumbnails = createThumbnailScheduler({
    quietMs: 200,
    busy,
    draw: (ids) => draws.push([...ids].sort()),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  })
  return { clock, draws, thumbnails }
}

describe("thumbnail scheduling", () => {
  test("nothing is drawn until the document has been quiet", () => {
    const { clock, draws, thumbnails } = scheduler()
    thumbnails.invalidate(["a"])
    clock.advance(150)
    thumbnails.invalidate(["b"])
    clock.advance(150)
    expect(draws).toEqual([])
    clock.advance(50)
    expect(draws).toEqual([["a", "b"]])
  })

  test("many changes to one layer redraw it once", () => {
    const { clock, draws, thumbnails } = scheduler()
    for (let i = 0; i < 20; i++) thumbnails.invalidate(["a"])
    clock.advance(200)
    expect(draws).toEqual([["a"]])
    clock.advance(1000)
    expect(draws).toHaveLength(1)
  })

  test("waits out a stroke rather than drawing during one", () => {
    let stroking = true
    const { clock, draws, thumbnails } = scheduler(() => stroking)
    thumbnails.invalidate(["a"])
    clock.advance(1000)
    expect(draws).toEqual([])
    stroking = false
    clock.advance(200)
    expect(draws).toEqual([["a"]])
  })

  test("drawn ids are forgotten; later changes start a new batch", () => {
    const { clock, draws, thumbnails } = scheduler()
    thumbnails.invalidate(["a"])
    clock.advance(200)
    thumbnails.invalidate(["b"])
    clock.advance(200)
    expect(draws).toEqual([["a"], ["b"]])
  })

  test("dispose drops what is pending", () => {
    const { clock, draws, thumbnails } = scheduler()
    thumbnails.invalidate(["a"])
    thumbnails.dispose()
    clock.advance(1000)
    expect(draws).toEqual([])
  })
})

describe("which thumbnails a changed surface shows up in", () => {
  test("a layer inside nested groups is also in each enclosing group", () => {
    const doc = createDocument({ width: 64, height: 64 })
    const inner = addLayer(doc)
    const innerGroup = addGroup(doc)
    selectLayer(doc, inner)
    const outerGroup = addGroup(doc, [innerGroup])
    expect(thumbnailOwners(doc.layers, inner)).toEqual([
      inner,
      innerGroup,
      outerGroup,
    ])
  })

  test("a mask's pixels are its own thumbnail and its layer's groups", () => {
    const doc = createDocument({ width: 64, height: 64 })
    const layer = addLayer(doc)
    const group = addGroup(doc)
    const mask = addMask(doc, layer)
    expect(thumbnailOwners(doc.layers, mask)).toEqual([mask, group])
  })

  test("a surface the document does not name owns nothing but itself", () => {
    const doc = createDocument({ width: 64, height: 64 })
    expect(thumbnailOwners(doc.layers, "gone")).toEqual(["gone"])
  })
})
