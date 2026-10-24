import { expect, test, type Page } from "@playwright/test"

/**
 * The magic wand (10), through the engine's command seam and the pen, on a
 * fixture of flat colour regions:
 *
 *   x < 100, y < 100    red
 *   x < 100, y >= 100   red lifted 20 levels on green, for tolerance
 *   x >= 100            blue, holding a green square [130,170)×[40,80)
 *                       and a red island [180,195)×[10,30) cut off from
 *                       the red half
 */

const WIDTH = 200
const HEIGHT = 120

const RED = [200, 0, 0]
const NEAR_RED = [200, 20, 0]
const BLUE = [0, 0, 200]
const GREEN = [0, 160, 0]

function fixtureColour(x: number, y: number): number[] {
  if (x >= 180 && x < 195 && y >= 10 && y < 30) return RED
  if (x >= 130 && x < 170 && y >= 40 && y < 80) return GREEN
  if (x >= 100) return BLUE
  return y < 100 ? RED : NEAR_RED
}

async function openCanvas(page: Page): Promise<{ x: number; y: number }> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const pixels: number[] = []
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) pixels.push(...fixtureColour(x, y), 255)
  await page.evaluate(
    async ([width, height, pixels]) => {
      window.remountEngine()
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({
        type: "placeImage",
        image: { width, height, pixels: new Uint8Array(pixels) },
        origin: { x: 0, y: 0 },
      })
    },
    [WIDTH, HEIGHT, pixels] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

type Mask = { width: number; height: number; data: number[] }

async function readMask(page: Page): Promise<Mask | null> {
  return page.evaluate(async () => {
    const mask = await window.engine.readSelection()
    return mask && { ...mask, data: Array.from(mask.data) }
  })
}

/** Every pixel the mask should hold wholly, and none other. */
function expectMask(
  mask: Mask | null,
  inside: (x: number, y: number) => boolean
) {
  expect(mask).not.toBeNull()
  const wrong: string[] = []
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      const expected = inside(x, y) ? 255 : 0
      if (mask!.data[y * WIDTH + x] !== expected) wrong.push(`${x},${y}`)
    }
  expect(wrong.slice(0, 10)).toEqual([])
}

const wand = (
  page: Page,
  x: number,
  y: number,
  mode?: "add" | "subtract" | "intersect"
) =>
  page.evaluate(
    ([x, y, mode]) =>
      window.engine.dispatch({ type: "selectWand", x, y, mode }),
    [x, y, mode] as const
  )

const options = (
  page: Page,
  tolerance?: number,
  sample?: "layer" | "composite"
) =>
  page.evaluate(
    ([tolerance, sample]) =>
      window.engine.dispatch({ type: "setWandOptions", tolerance, sample }),
    [tolerance, sample] as const
  )

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

const inRed = (x: number, y: number) => x < 100 && y < 100
const inGreen = (x: number, y: number) =>
  x >= 130 && x < 170 && y >= 40 && y < 80
const inIsland = (x: number, y: number) =>
  x >= 180 && x < 195 && y >= 10 && y < 30
const inBlue = (x: number, y: number) =>
  x >= 100 && !inGreen(x, y) && !inIsland(x, y)

test("selects the flat region clicked, leaving a cut-off match out", async ({
  page,
}) => {
  await openCanvas(page)
  await options(page, 0)
  await wand(page, 50, 50)
  expectMask(await readMask(page), inRed)
})

test("tolerance widens the region to colours near the clicked one", async ({
  page,
}) => {
  await openCanvas(page)
  await options(page, 32)
  await wand(page, 50, 50)
  expectMask(await readMask(page), (x) => x < 100)
})

test("a region holding another keeps it as a hole", async ({ page }) => {
  await openCanvas(page)
  await options(page, 0)
  await wand(page, 110, 10)
  expectMask(await readMask(page), inBlue)
})

test("samples the active layer or the composite, as asked", async ({
  page,
}) => {
  await openCanvas(page)
  // A fresh empty layer above the picture is what the wand reads by default:
  // transparent everywhere, so all of it.
  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  await options(page, 0, "layer")
  await wand(page, 50, 50)
  expectMask(await readMask(page), () => true)

  await options(page, 0, "composite")
  await wand(page, 50, 50)
  expectMask(await readMask(page), inRed)
  expect(await page.evaluate(() => window.engine.getSnapshot().wand)).toEqual({
    tolerance: 0,
    sample: "composite",
  })
})

test("combines with the selection there by add, subtract and intersect", async ({
  page,
}) => {
  await openCanvas(page)
  await options(page, 0)
  await wand(page, 110, 10)
  await wand(page, 150, 60, "add")
  expectMask(await readMask(page), (x, y) => inBlue(x, y) || inGreen(x, y))

  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 0,
      y: 0,
      width: 200,
      height: 120,
    })
  )
  await wand(page, 110, 10, "subtract")
  expectMask(await readMask(page), (x, y) => !inBlue(x, y))

  await wand(page, 50, 50, "intersect")
  expectMask(await readMask(page), inRed)
})

/** Waits for a click's asynchronous readback to settle into a selection. */
async function afterClick(page: Page, before: unknown) {
  await page.waitForFunction(
    (before) =>
      JSON.stringify(window.engine.getSnapshot().selection) !== before,
    JSON.stringify(before)
  )
}

const selection = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().selection)

test("a click with the wand in hand selects, shift adding, as one step each", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await options(page, 0)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "magicWand" })
  )
  await page.mouse.click(origin.x + 50, origin.y + 50)
  await afterClick(page, null)
  expectMask(await readMask(page), inRed)
  const red = await selection(page)
  const before = await steps(page)

  await page.keyboard.down("Shift")
  await page.mouse.click(origin.x + 185, origin.y + 20)
  await page.keyboard.up("Shift")
  await afterClick(page, red)
  expectMask(await readMask(page), (x, y) => inRed(x, y) || inIsland(x, y))
  expect(await steps(page)).toBe(before + 1)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expectMask(await readMask(page), inRed)
})
