import { expect, test, type Page } from "@playwright/test"

/**
 * Clearing a layer, through the engine's command seam and the pixels it
 * presents: the layer's marks go, the layer stays, and one undo brings the
 * marks back exactly.
 */

const WIDTH = 200
const HEIGHT = 120

type Image = { width: number; data: number[] }

async function openCanvas(page: Page): Promise<{ x: number; y: number }> {
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
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function painted(page: Page): Promise<Image> {
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

async function paint(page: Page, origin: { x: number; y: number }, y: number) {
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(origin.x + 10, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 60, origin.y + y, { steps: 20 })
  await page.mouse.up()
  await page.waitForFunction(
    (steps) => window.engine.historyUsage().steps > steps,
    before
  )
}

const activeLayer = (page: Page) =>
  page.evaluate(() => {
    const snapshot = window.engine.getSnapshot()
    const index = snapshot.layers.findIndex(
      (layer) => layer.id === snapshot.activeLayerId
    )
    return { index, layer: snapshot.layers[index] }
  })

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

test("clear empties the active layer and keeps it; undo and redo round-trip the pixels", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({
      type: "setLayer",
      id,
      name: "Ink",
      blend: "multiply",
    })
    // Back to the layer's own pixels; the mask stays on it.
    await window.engine.dispatch({ type: "selectLayer", id })
  })
  const blank = await painted(page)
  await paint(page, origin, 40)
  const marked = await painted(page)
  expect(marked).not.toEqual(blank)
  const layerBefore = await activeLayer(page)

  const stepsBefore = await steps(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "clearLayer", id }),
    layerBefore.layer.id
  )
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    stepsBefore
  )
  // Every pixel: the layer's marks are gone and nothing else moved.
  expect(await painted(page)).toEqual(blank)
  expect(await activeLayer(page)).toEqual(layerBefore)
  expect(await steps(page)).toBe(stepsBefore + 1)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await painted(page)).toEqual(marked)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await painted(page)).toEqual(blank)
  expect(await activeLayer(page)).toEqual(layerBefore)
})

test("clearing an empty or locked layer is not a step", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  const id = await page.evaluate(
    () => window.engine.getSnapshot().activeLayerId
  )
  const before = await steps(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "clearLayer", id }),
    id
  )
  expect(await steps(page)).toBe(before)

  await paint(page, origin, 40)
  const marked = await painted(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, locked: true }),
    id
  )
  const locked = await steps(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "clearLayer", id }),
    id
  )
  expect(await steps(page)).toBe(locked)
  expect(await painted(page)).toEqual(marked)
})
