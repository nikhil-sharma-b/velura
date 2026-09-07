import { expect, test, type Page } from "@playwright/test"
import {
  applyMatrix,
  DEFAULT_VIEW,
  flipView,
  MAX_ZOOM,
  MIN_ZOOM,
  rotateView,
  screenToDoc,
  zoomView,
} from "../../engine/view/view-transform"

const WIDTH = 200
const HEIGHT = 120
const SIZE = { width: WIDTH, height: HEIGHT }

async function openCanvas(page: Page) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height]) => {
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      // Smoothing pulls the mark behind the pen, and this is about where the
      // mark lands, not about how it is filtered.
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    },
    [WIDTH, HEIGHT]
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

/** Lets the frame loop run, then reads the document back. */
async function painted(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () => {
    const pixels = await window.engine.readPixels()
    return { width: pixels.width, data: Array.from(pixels.data) }
  })
}

/** Ink is much darker than the white document backdrop, so one channel decides it. */
function isInk(
  image: { width: number; data: number[] },
  x: number,
  y: number
): boolean {
  return image.data[(Math.round(y) * image.width + Math.round(x)) * 4] < 128
}

/** Drags the pen across the canvas, in screen pixels from its top-left. */
async function drag(
  page: Page,
  origin: { x: number; y: number },
  from: readonly [number, number],
  to: readonly [number, number]
) {
  await page.mouse.move(origin.x + from[0], origin.y + from[1])
  await page.mouse.down()
  await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 20 })
  await page.mouse.up()
}

test("the view is state, and every navigation reports it", async ({ page }) => {
  await openCanvas(page)
  const views = await page.evaluate(async () => {
    const engine = window.engine
    const seen: unknown[] = []
    await engine.dispatch({ type: "panView", dx: 30, dy: -12 })
    seen.push(engine.getSnapshot().view)
    await engine.dispatch({ type: "zoomView", factor: 4 })
    seen.push(engine.getSnapshot().view)
    await engine.dispatch({ type: "flipView" })
    seen.push(engine.getSnapshot().view)
    await engine.dispatch({ type: "rotateView", radians: Math.PI / 2 - 0.01 })
    seen.push(engine.getSnapshot().view)
    await engine.dispatch({ type: "fitView" })
    seen.push(engine.getSnapshot().view)
    await engine.dispatch({ type: "resetView" })
    seen.push(engine.getSnapshot().view)
    return seen as {
      panX: number
      panY: number
      zoom: number
      rotation: number
      flipped: boolean
    }[]
  })
  expect(views[0]).toMatchObject({ panX: 30, panY: -12, zoom: 1 })
  expect(views[1].zoom).toBe(4)
  expect(views[2].flipped).toBe(true)
  // A twist that lands within a degree of square is square.
  expect(views[3].rotation).toBeCloseTo(Math.PI / 2, 6)
  // Fitting is an overview: the document is centred and, turned on its side,
  // fits the shorter axis. It keeps the angle being worked at.
  expect([views[4].panX, views[4].panY]).toEqual([0, 0])
  expect(views[4].zoom).toBeLessThan(1)
  expect(views[4].flipped).toBe(true)
  expect(views[5]).toEqual(DEFAULT_VIEW)
})

test("zooming clamps rather than letting the canvas vanish or explode", async ({
  page,
}) => {
  await openCanvas(page)
  const zooms = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({ type: "zoomView", factor: 1e6 })
    const high = engine.getSnapshot().view.zoom
    await engine.dispatch({ type: "zoomView", factor: 1e-9 })
    return [high, engine.getSnapshot().view.zoom]
  })
  expect(zooms).toEqual([MAX_ZOOM, MIN_ZOOM])
})

test("a zoom anchored under the cursor holds that point still", async ({
  page,
}) => {
  await openCanvas(page)
  const held = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "zoomView",
      factor: 3,
      anchor: { x: 40, y: 90 },
    })
    return engine.getSnapshot().view
  })
  const before = applyMatrix(screenToDoc(DEFAULT_VIEW, SIZE, SIZE), 40, 90)
  const after = applyMatrix(screenToDoc(held, SIZE, SIZE), 40, 90)
  expect(after.x).toBeCloseTo(before.x, 3)
  expect(after.y).toBeCloseTo(before.y, 3)
})

test("the mark lands under the pen at any zoom, rotation and flip", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const start = [60, 40] as const
  const end = [130, 80] as const
  // A view an artist might actually be working at: turned, mirrored, zoomed
  // in, and dragged off centre.
  const view = flipView(
    rotateView(zoomView(DEFAULT_VIEW, 2), 0.6, { snap: false })
  )
  await page.evaluate(
    async ([zoom, rotation]) => {
      await window.engine.dispatch({ type: "zoomView", factor: zoom })
      await window.engine.dispatch({
        type: "rotateView",
        radians: rotation,
        snap: false,
      })
      await window.engine.dispatch({ type: "flipView" })
    },
    [view.zoom, view.rotation]
  )
  await drag(page, origin, start, end)
  const image = await painted(page)

  const inverse = screenToDoc(view, SIZE, SIZE)
  const from = applyMatrix(inverse, start[0], start[1])
  const to = applyMatrix(inverse, end[0], end[1])
  // Every point of the dragged line, mapped into the document, is inked: the
  // stroke is where the pen was, not where the screen pixels were.
  for (let step = 0; step <= 20; step++) {
    const t = step / 20
    const x = from.x + (to.x - from.x) * t
    const y = from.y + (to.y - from.y) * t
    expect(isInk(image, x, y)).toBe(true)
  }
  // And nowhere near it: a mark drawn in screen space would have landed here.
  expect(isInk(image, start[0], start[1])).toBe(false)
})

test("a middle-button drag pans, which is the mouse's own gesture", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.mouse.move(origin.x + 100, origin.y + 60)
  await page.mouse.down({ button: "middle" })
  await page.mouse.move(origin.x + 130, origin.y + 45, { steps: 5 })
  await page.mouse.up({ button: "middle" })
  const view = await page.evaluate(() => window.engine.getSnapshot().view)
  expect(view.panX).toBeCloseTo(30, 0)
  expect(view.panY).toBeCloseTo(-15, 0)
  // And it painted nothing: the middle button is nobody's brush.
  const image = await painted(page)
  expect(isInk(image, 115, 52)).toBe(false)
})

test("a second finger takes back the mark and navigates instead", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  // One finger down and moving is a stroke; the second turns the act into a
  // gesture, and the half-drawn mark is not one the artist asked for. The
  // touches are synthesised because Playwright drives one pointer at a time.
  const cancelled = await page.evaluate(
    async ([left, top]) => {
      const canvas = document.querySelector("canvas")!
      const send = (type: string, id: number, x: number, y: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: id === 1,
            clientX: left + x,
            clientY: top + y,
            pressure: 0.5,
            bubbles: true,
          })
        )
      send("pointerdown", 1, 30, 30)
      send("pointermove", 1, 90, 30)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      send("pointerdown", 2, 150, 30)
      send("pointermove", 1, 40, 40)
      send("pointermove", 2, 160, 40)
      send("pointerup", 1, 40, 40)
      send("pointerup", 2, 160, 40)
      await new Promise((resolve) => requestAnimationFrame(resolve))
      const pixels = await window.engine.readPixels()
      return {
        width: pixels.width,
        data: Array.from(pixels.data),
        view: window.engine.getSnapshot().view,
      }
    },
    [origin.x, origin.y]
  )
  // The canvas moved, and nothing was painted along the way.
  expect(cancelled.view.panX).not.toBe(0)
  for (let x = 30; x <= 90; x += 10) expect(isInk(cancelled, x, 30)).toBe(false)
})

test("what is exported is what was painted, not how it was looked at", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await drag(page, origin, [30, 30], [160, 90])
  const straight = await painted(page)
  const navigated = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({ type: "rotateView", radians: 0.8, snap: false })
    await engine.dispatch({ type: "flipView" })
    await engine.dispatch({ type: "zoomView", factor: 3 })
    await engine.dispatch({ type: "panView", dx: -25, dy: 40 })
    const pixels = await engine.readPixels()
    return {
      width: pixels.width,
      data: Array.from(pixels.data),
      view: engine.getSnapshot().view,
    }
  })
  // The view really did move, and the exported pixels did not.
  expect(navigated.view.flipped).toBe(true)
  expect(navigated.width).toBe(straight.width)
  expect(navigated.data).toEqual(straight.data)
})

test("navigation shows the artist a different canvas", async ({ page }) => {
  const origin = await openCanvas(page)
  await drag(page, origin, [95, 20], [95, 100])
  const canvas = page.locator("canvas")
  const before = await canvas.screenshot()
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "panView", dx: -40, dy: 0 })
  })
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(resolve))
  )
  const after = await canvas.screenshot()
  // Panning a vertical mark sideways has to change what is presented, even
  // though nothing about the document changed.
  expect(Buffer.compare(before, after)).not.toBe(0)
})
