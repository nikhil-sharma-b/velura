import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

const WIDTH = 160
const HEIGHT = 160

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
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 3 })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").first().boundingBox())!
  return { x: box.x, y: box.y }
}

type Image = { width: number; height: number; data: number[] }

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

/** Whether a pixel carries ink, against untouched backdrop. */
function inked(image: Image, x: number, y: number): boolean {
  const at = (px: number, py: number) =>
    image.data[(Math.round(py) * image.width + Math.round(px)) * 4]
  return at(x, y) < at(150, 5) - 30
}

/** A deliberately unsteady stroke, wandering well off the line either side. */
async function wobble(
  page: Page,
  origin: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await page.mouse.move(origin.x + from.x, origin.y + from.y)
  await page.mouse.down()
  for (let i = 1; i <= 30; i++) {
    const t = i / 30
    const off = (i % 2 === 0 ? 1 : -1) * 18
    await page.mouse.move(
      origin.x + from.x + (to.x - from.x) * t,
      origin.y + from.y + (to.y - from.y) * t + off
    )
  }
  await page.mouse.move(origin.x + to.x, origin.y + to.y)
  await page.mouse.up()
}

test("golden: a wobbly stroke against an angled straight-edge draws straight", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "setStraightEdge",
      edge: { x: 80, y: 80, angle: Math.PI / 6 },
    })
  )
  await wobble(page, origin, { x: 30, y: 50 }, { x: 130, y: 110 })
  const image = await painted(page)
  // On the edge, and nowhere the hand wandered to.
  const on = (t: number) => ({
    x: 80 + Math.cos(Math.PI / 6) * t,
    y: 80 + Math.sin(Math.PI / 6) * t,
  })
  expect(inked(image, on(0).x, on(0).y)).toBe(true)
  expect(inked(image, on(30).x, on(30).y)).toBe(true)
  expect(inked(image, on(-30).x, on(-30).y)).toBe(true)
  expect(inked(image, 80, 60)).toBe(false)
  expect(inked(image, 80, 100)).toBe(false)

  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("straight-edge-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })
})

test("Shift at pen-down rules a line on from where the last stroke lifted", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.mouse.move(origin.x + 20, origin.y + 20)
  await page.mouse.down()
  await page.mouse.move(origin.x + 30, origin.y + 20, { steps: 4 })
  await page.mouse.up()
  await page.keyboard.down("Shift")
  await page.mouse.move(origin.x + 130, origin.y + 120)
  await page.mouse.down()
  await page.mouse.up()
  await page.keyboard.up("Shift")
  const image = await painted(page)
  // The diagonal from (30, 20) to (130, 120) is inked all the way along.
  for (const t of [0.25, 0.5, 0.75])
    expect(inked(image, 30 + 100 * t, 20 + 100 * t)).toBe(true)
})

test("a stroke started near a guide runs along it", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "addGuide", axis: "y", position: 80 })
  )
  await wobble(page, origin, { x: 20, y: 84 }, { x: 140, y: 84 })
  const image = await painted(page)
  expect(inked(image, 40, 80)).toBe(true)
  expect(inked(image, 120, 80)).toBe(true)
  expect(inked(image, 80, 66)).toBe(false)
  expect(inked(image, 80, 98)).toBe(false)
})

test("a stroke started away from a guide is left alone", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "addGuide", axis: "y", position: 20 })
  )
  await wobble(page, origin, { x: 20, y: 84 }, { x: 140, y: 84 })
  const image = await painted(page)
  expect(inked(image, 20, 84)).toBe(true)
  expect(inked(image, 80, 20)).toBe(false)
})
