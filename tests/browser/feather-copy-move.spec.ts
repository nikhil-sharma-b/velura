import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Feathering, copying to a new layer and moving the outline (11): a feathered
 * selection lets a stroke fade out across its edge, the selection's pixels
 * lift into a layer of their own where they were, and the outline moves
 * without the pixels under it.
 */

const WIDTH = 200
const HEIGHT = 120
const BOX = { x: 40, y: 20, width: 60, height: 60 }

type Image = { width: number; height: number; data: number[] }

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
      await window.engine.dispatch({ type: "addLayer" })
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
    return {
      width: pixels.width,
      height: pixels.height,
      data: Array.from(pixels.data),
    }
  })
}

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

async function stroke(page: Page, origin: { x: number; y: number }, y: number) {
  const before = await steps(page)
  await page.mouse.move(origin.x + 10, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 150, origin.y + y, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

const select = (page: Page) =>
  page.evaluate(
    (box) =>
      window.engine.dispatch({ type: "selectShape", shape: "rect", ...box }),
    BOX
  )

const readMask = (page: Page) =>
  page.evaluate(async () => {
    const mask = await window.engine.readSelection()
    return mask && { ...mask, data: Array.from(mask.data) }
  })

const pixel = (image: Image, x: number, y: number) =>
  image.data.slice((y * image.width + x) * 4, (y * image.width + x) * 4 + 4)

function png(image: Image): Buffer {
  const out = new PNG({ width: image.width, height: image.height })
  out.data.set(image.data)
  return PNG.sync.write(out)
}

test("feathering softens the mask's edge by the radius", async ({ page }) => {
  await openCanvas(page)
  await select(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "featherSelection", radius: 8 })
  )
  const mask = (await readMask(page))!
  const at = (x: number, y: number) => mask.data[y * mask.width + x]
  expect(at(70, 50)).toBe(255)
  expect(at(10, 50)).toBe(0)
  expect(at(38, 50)).toBeGreaterThan(0)
  expect(at(38, 50)).toBeLessThan(255)
  expect(at(42, 50)).toBeLessThan(255)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection!.bounds.x)
  ).toBeLessThan(BOX.x)
})

test("a stroke across a feathered edge fades out rather than stopping", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await select(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "featherSelection", radius: 10 })
  )
  await stroke(page, origin, 50)
  const marked = await painted(page)

  // Far outside, untouched; deep inside, painted in full; on the edge, part.
  expect(pixel(marked, 15, 50)).toEqual(pixel(blank, 15, 50))
  const inside = pixel(marked, 70, 50)
  const edge = pixel(marked, BOX.x, 50)
  const paper = pixel(blank, BOX.x, 50)
  expect(edge).not.toEqual(paper)
  expect(edge).not.toEqual(inside)
  // The mark is darker than the paper, and the edge sits between the two.
  expect(edge[0]).toBeGreaterThan(inside[0])
  expect(edge[0]).toBeLessThan(paper[0])
  expect(png(marked)).toMatchSnapshot("feathered-stroke.png")
})

test("copy to a new layer keeps the selected pixels where they were, one undo step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await stroke(page, origin, 35)
  await stroke(page, origin, 65)
  const source = await page.evaluate(
    () => window.engine.getSnapshot().activeLayerId
  )
  await select(page)
  const layers = await page.evaluate(
    () => window.engine.getSnapshot().layers.length
  )
  const before = await steps(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "copySelectionToLayer" })
  )
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  expect(await steps(page)).toBe(before + 1)
  const copy = await page.evaluate(() => window.engine.getSnapshot())
  expect(copy.layers.length).toBe(layers + 1)
  expect(copy.activeLayerId).not.toBe(source)

  // With the source hidden, only the copy shows: the strokes inside the box,
  // at the same place, and nothing of them outside it.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, visible: false }),
    source
  )
  const pasted = await painted(page)
  expect(pixel(pasted, 15, 35)).toEqual(pixel(blank, 15, 35))
  expect(pixel(pasted, 120, 65)).toEqual(pixel(blank, 120, 65))
  expect(pixel(pasted, 70, 35)).not.toEqual(pixel(blank, 70, 35))
  expect(pixel(pasted, 70, 65)).not.toEqual(pixel(blank, 70, 65))
  expect(png(pasted)).toMatchSnapshot("pasted-layer.png")

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layers.length)
  ).toBe(layers)
})

test("the move-outline tool shifts the mask and leaves the pixels", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await stroke(page, origin, 50)
  const marked = await painted(page)
  await select(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "moveSelection" })
  )
  const before = await steps(page)
  await page.mouse.move(origin.x + 60, origin.y + 40)
  await page.mouse.down()
  await page.mouse.move(origin.x + 90, origin.y + 50, { steps: 10 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection)
  ).toEqual({ bounds: { ...BOX, x: BOX.x + 30, y: BOX.y + 10 } })
  expect(await painted(page)).toEqual(marked)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection)
  ).toEqual({ bounds: BOX })
})
