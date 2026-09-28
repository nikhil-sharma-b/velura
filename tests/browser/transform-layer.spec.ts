import { expect, test, type Page } from "@playwright/test"

/**
 * Moving, scaling, turning and mirroring a painted layer (13). A painted
 * layer has no file to go back to, so it is snapshotted as it is picked up
 * and every adjustment is drawn from that snapshot: a dozen adjustments must
 * land exactly where one would.
 */

const WIDTH = 200
const HEIGHT = 120

type Image = { width: number; data: number[] }

async function openCanvas(page: Page) {
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
    },
    [WIDTH, HEIGHT] as const
  )
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

const pixel = (image: Image, at: { x: number; y: number }) =>
  image.data.slice(
    (at.y * image.width + at.x) * 4,
    (at.y * image.width + at.x) * 4 + 4
  )

/**
 * A hard red/green checker, 40 by 30, painted into an ordinary layer at
 * (20, 10): placed, then handed to the pen, so the layer is pixels only.
 */
async function paintedChecker(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const width = 40
    const height = 30
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        const on = (x + y) % 2 === 0
        pixels[at] = on ? 255 : 0
        pixels[at + 1] = on ? 0 : 255
        pixels[at + 3] = 255
      }
    await window.engine.dispatch({
      type: "placeImage",
      name: "Checker",
      image: { width, height, pixels },
    })
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({
      type: "beginImageTransform",
      id,
    })
    const start = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start, x: 40, y: 25 },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
    await window.engine.dispatch({ type: "makeLayerPaintable", id })
    return id
  })
}

const END = { x: 110, y: 70, width: 60, height: 45, rotation: 0.4 }

test("picking a layer up finds the tight box round its pixels", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await paintedChecker(page)
  const placement = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    return window.engine.getSnapshot().layerTransform!.placement
  }, id)
  expect(placement).toEqual({
    x: 40,
    y: 25,
    width: 40,
    height: 30,
    rotation: 0,
    flipX: false,
    flipY: false,
  })
})

test("adjusting a layer over and over does not soften it", async ({ page }) => {
  await openCanvas(page)
  const id = await paintedChecker(page)
  await page.evaluate(
    async ([layerId, end]) => {
      await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
      const start = window.engine.getSnapshot().layerTransform!.placement
      for (let step = 1; step <= 12; step++)
        await window.engine.dispatch({
          type: "adjustLayerTransform",
          placement: {
            ...start,
            x: start.x + step * 5,
            y: start.y + step,
            width: start.width * (1 + step / 15),
            height: start.height * (1 - step / 30),
            rotation: -step / 7,
          },
        })
      await window.engine.dispatch({
        type: "adjustLayerTransform",
        placement: { ...start, ...end },
      })
      await window.engine.dispatch({ type: "commitLayerTransform" })
    },
    [id, END] as const
  )
  const worked = await painted(page)

  await openCanvas(page)
  const fresh = await paintedChecker(page)
  await page.evaluate(
    async ([layerId, end]) => {
      await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
      const start = window.engine.getSnapshot().layerTransform!.placement
      await window.engine.dispatch({
        type: "adjustLayerTransform",
        placement: { ...start, ...end },
      })
      await window.engine.dispatch({ type: "commitLayerTransform" })
    },
    [fresh, END] as const
  )
  const once = await painted(page)

  expect(worked.data).toEqual(once.data)
})

test("a layer transform is one step, and undo puts every pixel back", async ({
  page,
}) => {
  await openCanvas(page)
  // What is under the layer, from the harness's own starting artwork.
  const under = await painted(page)
  const id = await paintedChecker(page)
  const before = await painted(page)
  const steps = await page.evaluate(() => window.engine.historyUsage().steps)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    const start = window.engine.getSnapshot().layerTransform!.placement
    for (let step = 1; step <= 5; step++)
      await window.engine.dispatch({
        type: "adjustLayerTransform",
        placement: { ...start, x: start.x + step * 20 },
      })
    await window.engine.dispatch({ type: "commitLayerTransform" })
  }, id)
  const moved = await painted(page)
  expect(moved.data).not.toEqual(before.data)
  // Where it was shows what is under it; where it went is the checker.
  expect(pixel(moved, { x: 45, y: 15 })).toEqual(pixel(under, { x: 45, y: 15 }))
  expect(pixel(moved, { x: 145, y: 15 })).toEqual(
    pixel(before, { x: 45, y: 15 })
  )
  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    steps + 1
  )

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect((await painted(page)).data).toEqual(before.data)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect((await painted(page)).data).toEqual(moved.data)
})

test("a cancelled layer transform leaves the layer exactly as it was", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await paintedChecker(page)
  const before = await painted(page)
  const steps = await page.evaluate(() => window.engine.historyUsage().steps)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    const start = window.engine.getSnapshot().layerTransform!.placement
    await window.engine.dispatch({
      type: "adjustLayerTransform",
      placement: { ...start, x: 150, rotation: 1.1, width: 12 },
    })
    await window.engine.dispatch({ type: "cancelLayerTransform" })
  }, id)

  expect((await painted(page)).data).toEqual(before.data)
  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    steps
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layerTransform)
  ).toBeNull()
})

test("flipping a layer mirrors it in place, and flipping back restores it", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await paintedChecker(page)
  const before = await painted(page)

  await page.evaluate(
    (layerId) =>
      window.engine.dispatch({
        type: "flipLayer",
        id: layerId,
        axis: "horizontal",
      }),
    id
  )
  const flipped = await painted(page)
  // Column 20 and column 59 swap: the checker's box is 20..59.
  expect(pixel(flipped, { x: 20, y: 10 })).toEqual(
    pixel(before, { x: 59, y: 10 })
  )
  expect(pixel(flipped, { x: 20, y: 10 })).not.toEqual(
    pixel(before, { x: 20, y: 10 })
  )

  await page.evaluate(
    (layerId) =>
      window.engine.dispatch({
        type: "flipLayer",
        id: layerId,
        axis: "horizontal",
      }),
    id
  )
  expect((await painted(page)).data).toEqual(before.data)
})

test("an empty layer has nothing to transform", async ({ page }) => {
  await openCanvas(page)
  const outcome = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    const id = window.engine.getSnapshot().activeLayerId
    let thrown: string | null = null
    try {
      await window.engine.dispatch({ type: "beginLayerTransform", id })
    } catch (caught) {
      thrown = (caught as Error).message
    }
    return {
      thrown,
      layerTransform: window.engine.getSnapshot().layerTransform,
    }
  })
  expect(outcome.thrown).toContain("nothing on this layer")
  expect(outcome.layerTransform).toBeNull()
})
