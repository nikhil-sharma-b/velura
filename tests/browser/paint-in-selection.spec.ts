import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Painting, erasing and clearing inside the selection (08): the stroke's
 * output is multiplied by the mask, so nothing lands — or comes off — outside
 * it, and Clear empties only what is selected, as one step.
 */

const WIDTH = 200
const HEIGHT = 120
/** The selected box every test paints across. */
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

/** A horizontal stroke from x 10 to x 150: across both edges of the box. */
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

const inside = (x: number, y: number) =>
  x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height

const outside = (x: number, y: number) => !inside(x, y)

/** Every pixel of `image` the test's predicate picks, as [index, value]. */
function pixels(image: Image, pick: (x: number, y: number) => boolean) {
  const out: number[] = []
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (pick(x, y))
        for (let c = 0; c < 4; c++)
          out.push(image.data[(y * image.width + x) * 4 + c])
  return out
}

function png(image: Image): Buffer {
  const out = new PNG({ width: image.width, height: image.height })
  out.data.set(image.data)
  return PNG.sync.write(out)
}

test("a stroke across the selection's edge lands only inside it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await select(page)
  await stroke(page, origin, 50)
  const marked = await painted(page)

  expect(pixels(marked, outside)).toEqual(pixels(blank, outside))
  expect(pixels(marked, inside)).not.toEqual(pixels(blank, inside))
  expect(png(marked)).toMatchSnapshot("stroke-across-selection-edge.png")
})

test("the eraser removes ink only inside the selection", async ({ page }) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await stroke(page, origin, 50)
  const marked = await painted(page)

  await select(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  await stroke(page, origin, 50)
  const erased = await painted(page)

  expect(pixels(erased, outside)).toEqual(pixels(marked, outside))
  expect(pixels(erased, inside)).toEqual(pixels(blank, inside))
})

test("clear with a selection empties only the selected area, one undo step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await stroke(page, origin, 35)
  await stroke(page, origin, 65)
  const marked = await painted(page)

  await select(page)
  const before = await steps(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "clearLayer",
      id: window.engine.getSnapshot().activeLayerId,
    })
  )
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  const cleared = await painted(page)
  expect(await steps(page)).toBe(before + 1)

  expect(pixels(cleared, outside)).toEqual(pixels(marked, outside))
  expect(pixels(cleared, inside)).toEqual(pixels(blank, inside))
  expect(png(cleared)).toMatchSnapshot("clear-inside-selection.png")

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await painted(page)).toEqual(marked)
  // The selection is its own step; undoing the clear left it in place.
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection)
  ).toEqual({ bounds: BOX })
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await painted(page)).toEqual(cleared)
})

test("clearing a selection over nothing is not a step", async ({ page }) => {
  const origin = await openCanvas(page)
  // Ink well away from the box.
  const before = await steps(page)
  await page.mouse.move(origin.x + 150, origin.y + 100)
  await page.mouse.down()
  await page.mouse.move(origin.x + 180, origin.y + 100, { steps: 10 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  await select(page)
  const selected = await steps(page)
  const marked = await painted(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "clearLayer",
      id: window.engine.getSnapshot().activeLayerId,
    })
  )
  expect(await painted(page)).toEqual(marked)
  expect(await steps(page)).toBe(selected)
})
