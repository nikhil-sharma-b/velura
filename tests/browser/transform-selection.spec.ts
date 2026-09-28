import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Transforming selected pixels (14): with a selection, the transform lifts
 * only what it covers — a feathered edge's share of it — into a floating
 * buffer, leaves the vacated area empty, resamples once on commit and takes
 * the outline along, all as one step.
 */

const WIDTH = 200
const HEIGHT = 120
const BOX = { x: 20, y: 20, width: 40, height: 40 }

type Image = { width: number; height: number; data: number[] }

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
    return {
      width: pixels.width,
      height: pixels.height,
      data: Array.from(pixels.data),
    }
  })
}

const pixel = (image: Image, x: number, y: number) =>
  image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)

function png(image: Image): Buffer {
  const out = new PNG({ width: image.width, height: image.height })
  out.data.set(image.data)
  return PNG.sync.write(out)
}

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

/**
 * A solid red layer, 100 by 60 at (10, 10): placed, then handed to the pen,
 * so the layer is pixels only.
 */
async function paintedBlock(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const width = 100
    const height = 60
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let at = 0; at < pixels.length; at += 4) {
      pixels[at] = 255
      pixels[at + 3] = 255
    }
    await window.engine.dispatch({
      type: "placeImage",
      name: "Block",
      image: { width, height, pixels },
    })
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "beginImageTransform", id })
    const start = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start, x: 60, y: 40 },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
    await window.engine.dispatch({ type: "makeLayerPaintable", id })
    return id
  })
}

async function select(page: Page, feather = 0) {
  await page.evaluate(
    async ([box, radius]) => {
      await window.engine.dispatch({
        type: "selectShape",
        shape: "rect",
        ...box,
      })
      if (radius)
        await window.engine.dispatch({ type: "featherSelection", radius })
    },
    [BOX, feather] as const
  )
}

/** Picks the selection up and puts it down 110 pixels to the right. */
async function moveSelected(page: Page, id: string) {
  const before = await steps(page)
  const placement = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    const start = window.engine.getSnapshot().layerTransform!.placement
    await window.engine.dispatch({
      type: "adjustLayerTransform",
      placement: { ...start, x: start.x + 50 },
    })
    await window.engine.dispatch({
      type: "adjustLayerTransform",
      placement: { ...start, x: start.x + 110 },
    })
    await window.engine.dispatch({ type: "commitLayerTransform" })
    return start
  }, id)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  return { placement, before }
}

test("the handles sit on the selection's bounds", async ({ page }) => {
  await openCanvas(page)
  const id = await paintedBlock(page)
  await select(page)
  const transform = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    return window.engine.getSnapshot().layerTransform
  }, id)
  expect(transform!.lifted).toBe(true)
  expect(transform!.placement).toMatchObject({
    x: BOX.x + BOX.width / 2,
    y: BOX.y + BOX.height / 2,
    width: BOX.width,
    height: BOX.height,
  })
})

test("moving selected pixels empties where they were, carries the outline, one step", async ({
  page,
}) => {
  await openCanvas(page)
  const blank = await painted(page)
  const id = await paintedBlock(page)
  const red = pixel(await painted(page), 80, 40)
  await select(page)
  const { before } = await moveSelected(page, id)
  expect(await steps(page)).toBe(before + 1)

  const moved = await painted(page)
  // Vacated: paper where the selection was.
  expect(pixel(moved, 40, 40)).toEqual(pixel(blank, 40, 40))
  // Unselected pixels stay.
  expect(pixel(moved, 80, 40)).toEqual(red)
  // Landed: red at the new place, beyond the block.
  expect(pixel(moved, 150, 40)).toEqual(red)
  expect(png(moved)).toMatchSnapshot("moved-selection.png")

  const bounds = await page.evaluate(
    () => window.engine.getSnapshot().selection!.bounds
  )
  expect(bounds).toEqual({ ...BOX, x: BOX.x + 110 })

  // One undo puts both pixels and outline back.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  const undone = await painted(page)
  expect(pixel(undone, 40, 40)).toEqual(red)
  expect(pixel(undone, 150, 40)).toEqual(pixel(blank, 150, 40))
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection!.bounds)
  ).toEqual(BOX)
})

test("a feathered selection lifts its soft edge and leaves the rest behind", async ({
  page,
}) => {
  await openCanvas(page)
  const blank = await painted(page)
  const id = await paintedBlock(page)
  const red = pixel(await painted(page), 80, 40)
  await select(page, 8)
  await moveSelected(page, id)
  const moved = await painted(page)
  // On the old edge, part of the red stayed; deep inside none did.
  const leftBehind = pixel(moved, BOX.x + BOX.width, 40)
  expect(leftBehind).not.toEqual(red)
  expect(leftBehind).not.toEqual(pixel(blank, BOX.x + BOX.width, 40))
  expect(pixel(moved, 40, 40)).toEqual(pixel(blank, 40, 40))
  // On the new edge, part of the red arrived; well outside the block, the
  // moved centre is red.
  expect(pixel(moved, 150, 40)).toEqual(red)
  const arrived = pixel(moved, BOX.x + 110 + BOX.width + 4, 40)
  expect(arrived).not.toEqual(red)
  expect(arrived).not.toEqual(pixel(blank, BOX.x + 110 + BOX.width + 4, 40))
  expect(png(moved)).toMatchSnapshot("moved-feathered-selection.png")
})

test("cancelling puts the layer and the outline back", async ({ page }) => {
  await openCanvas(page)
  const id = await paintedBlock(page)
  await select(page, 8)
  const start = await painted(page)
  const before = await steps(page)
  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    const placement = window.engine.getSnapshot().layerTransform!.placement
    await window.engine.dispatch({
      type: "adjustLayerTransform",
      placement: { ...placement, x: placement.x + 90, rotation: 0.3 },
    })
    await window.engine.dispatch({ type: "cancelLayerTransform" })
  }, id)
  expect(await painted(page)).toEqual(start)
  expect(await steps(page)).toBe(before)
  const mask = await page.evaluate(async () => {
    const read = await window.engine.readSelection()
    return read && read.data[40 * read.width + 40]
  })
  expect(mask).toBe(255)
})
