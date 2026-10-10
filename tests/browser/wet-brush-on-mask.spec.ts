import { expect, test, type Page } from "@playwright/test"

/**
 * Wet brushes on a layer's mask (live brushes 05), through the engine facade
 * and the pixels it presents: while a mask is being painted a drag smears the
 * mask, so what it hides and shows is pushed along the stroke, and the
 * layer's own pixels are left as they were.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and blended along. */
const ROW = 60
/** Where the painted bar starts and stops. */
const BAR = { from: 40, to: 200 }
/** The part of the bar the mask is painted over, and so hides. */
const HIDDEN = { from: 40, to: 110 }

type Origin = { x: number; y: number }

async function openCanvas(page: Page): Promise<Origin> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height]) => {
      window.remountEngine()
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.125,
      })
      await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const dispatch = (
  page: Page,
  command: Parameters<typeof window.engine.dispatch>[0]
) => page.evaluate((command) => window.engine.dispatch(command), command)

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

async function pixels(page: Page) {
  await settle(page)
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

const rgba = (image: number[], x: number, y = ROW) =>
  image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)

/** How far two pixels are apart, summed over their channels. */
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

/** A drag with the pen left down at its end. */
async function press(page: Page, origin: Origin, from: number, to: number) {
  await page.mouse.move(origin.x + from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
}

async function drag(page: Page, origin: Origin, from: number, to: number) {
  await press(page, origin, from, to)
  await page.mouse.up()
}

/** A drag that is expected to land as one undo step, waited for. */
async function stroke(page: Page, origin: Origin, from: number, to: number) {
  const before = await steps(page)
  await drag(page, origin, from, to)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/**
 * Gives the active layer a mask hiding the bar's left part, and leaves that
 * mask being painted with a wet brush in the hand.
 */
async function maskLeft(page: Page, origin: Origin) {
  const id = await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
    await window.engine.dispatch({ type: "setTool", tool: "brush" })
    return id
  })
  await stroke(page, origin, HIDDEN.from, HIDDEN.to)
  await dispatch(page, { type: "setBrush", wet: { pickup: 0.95 }, flow: 0 })
  return id
}

/**
 * A bar painted on a layer of its own, its left part hidden by a mask that is
 * being painted, a wet brush in the hand. `shown` is the picture before the mask.
 */
async function openMasked(page: Page) {
  const origin = await openCanvas(page)
  await dispatch(page, { type: "addLayer" })
  await stroke(page, origin, BAR.from, BAR.to)
  const shown = await pixels(page)
  const id = await maskLeft(page, origin)
  return { origin, id, shown, masked: await pixels(page) }
}

/** The picture with the layer's mask switched off: the layer's own pixels. */
async function unmasked(page: Page, id: string) {
  await dispatch(page, { type: "setMaskEnabled", id, enabled: false })
  return pixels(page)
}

test("a wet blender carries mask coverage without touching the layer", async ({
  page,
}) => {
  const { origin, id, shown, masked } = await openMasked(page)
  await stroke(page, origin, 90, 160)
  const blended = await pixels(page)
  expect(distance(rgba(blended, 135), rgba(masked, 135))).toBeGreaterThan(60)
  expect(await unmasked(page, id)).toEqual(shown)
})

// Full flow should lay the same mask value as dry painting, whatever RGB
// colour is in the hand: masks use alpha to hide the layer.
test("a wet brush lays the dry brush's mask paint value", async ({ page }) => {
  const { origin, id, shown, masked } = await openMasked(page)
  await dispatch(page, { type: "setBrush", wet: null, flow: 1 })
  await stroke(page, origin, 140, 180)
  const dry = await pixels(page)
  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(masked)
  await dispatch(page, { type: "setColor", hex: "#1040e0" })
  await dispatch(page, { type: "setBrush", wet: { pickup: 0.95 }, flow: 1 })
  await stroke(page, origin, 140, 180)
  const wet = await pixels(page)
  for (const x of [145, 160, 175])
    expect(distance(rgba(wet, x), rgba(dry, x))).toBeLessThan(8)
  expect(distance(rgba(wet, 160), rgba(masked, 160))).toBeGreaterThan(100)
  expect(await unmasked(page, id)).toEqual(shown)
})

test("a laying and blending mask stroke stays inside the selection", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  await dispatch(page, { type: "setBrush", flow: 0.05 })
  const edge = 100
  await dispatch(page, {
    type: "selectShape",
    shape: "rect",
    x: edge,
    y: 0,
    width: WIDTH - edge,
    height: HEIGHT,
  })
  await stroke(page, origin, 90, 170)
  const wet = await pixels(page)
  for (let y = 0; y < HEIGHT; y++)
    expect(wet.slice(y * WIDTH * 4, (y * WIDTH + edge) * 4)).toEqual(
      masked.slice(y * WIDTH * 4, (y * WIDTH + edge) * 4)
    )
  expect(distance(rgba(wet, 135), rgba(masked, 135))).toBeGreaterThan(60)
})

test("one undo restores a wet mask stroke and redo brings it back", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  await dispatch(page, { type: "setBrush", flow: 0.05 })
  const before = await steps(page)
  await stroke(page, origin, 90, 160)
  const wet = await pixels(page)
  expect(wet).not.toEqual(masked)
  expect(await steps(page)).toBe(before + 1)
  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(masked)
  await dispatch(page, { type: "redo" })
  expect(await pixels(page)).toEqual(wet)
})

test("the picture follows a wet mask stroke and cancel restores it", async ({
  page,
}) => {
  const { origin, id, shown, masked } = await openMasked(page)
  await dispatch(page, { type: "setBrush", flow: 0.05 })
  const before = await steps(page)
  await press(page, origin, 90, 160)
  expect(
    distance(rgba(await pixels(page), 135), rgba(masked, 135))
  ).toBeGreaterThan(60)
  await dispatch(page, { type: "setTool", tool: "eraser" })
  await page.mouse.up()
  expect(await pixels(page)).toEqual(masked)
  expect(await steps(page)).toBe(before)
  expect(await unmasked(page, id)).toEqual(shown)
})
