import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import type { Modulator } from "../../engine/brush/dynamics"
import type { BrushScatter } from "../../engine/brush/scatter"

/**
 * Scatter, drawn through the engine: placement happens where a resampled
 * point becomes dabs, so the probe — which takes dabs already placed — cannot
 * stand in for it.
 */

const WIDTH = 160
const HEIGHT = 160
const Y = 80
const RADIUS = 3
const FROM = 30
const TO = 130

type Settings = {
  scatter?: BrushScatter | null
  accumulation?: "coverage" | "buildup"
  flow?: number
  dynamics?: Modulator[]
}

async function openCanvas(page: Page, settings: Settings = {}) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, radius, brush]) => {
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({
        type: "setBrush",
        radius: radius as number,
        ...(brush as Settings),
      })
    },
    [WIDTH, HEIGHT, RADIUS, settings] as const
  )
  const box = (await page.locator("canvas").first().boundingBox())!
  return { x: box.x, y: box.y }
}

/** One straight stroke across the canvas, left to right. */
async function stroke(page: Page, origin: { x: number; y: number }) {
  await page.mouse.move(origin.x + FROM, origin.y + Y)
  await page.mouse.down()
  await page.mouse.move(origin.x + TO, origin.y + Y, { steps: 40 })
  await page.mouse.up()
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

async function draw(page: Page, settings: Settings = {}): Promise<Image> {
  const origin = await openCanvas(page, settings)
  await stroke(page, origin)
  return painted(page)
}

function level(image: Image, x: number, y: number): number {
  return image.data[(Math.round(y) * image.width + Math.round(x)) * 4]
}

/** Every inked pixel, against the untouched backdrop in the corner. */
function ink(image: Image): { x: number; y: number }[] {
  const backdrop = level(image, 150, 150)
  const found: { x: number; y: number }[] = []
  // The document opens with colour swatches along its top edge; the stroke
  // is drawn well below them.
  for (let y = 30; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (level(image, x, y) < backdrop - 30) found.push({ x, y })
  return found
}

/** The band the stroke occupies inside the canvas, away from the swatches. */
function region(image: Image): number[] {
  const values: number[] = []
  for (let y = 30; y < image.height; y++)
    for (let x = 0; x < image.width; x++) values.push(level(image, x, y))
  return values
}

test("a brush without scatter draws exactly as it did before", async ({
  page,
}) => {
  const plain = await draw(page)
  // A scatter section at rest, and a scatter mapping with no amount to
  // scale, are both the stroke a brush made before scatter existed.
  const resting = await draw(page, {
    scatter: { amount: 0, count: 1, axes: "both" },
  })
  const mapped = await draw(page, {
    dynamics: [
      { source: "random", target: "scatter", range: [0, 8], mix: "multiply" },
    ],
  })
  expect(region(resting)).toEqual(region(plain))
  expect(region(mapped)).toEqual(region(plain))
})

test("across scatter widens the stroke without lengthening it", async ({
  page,
}) => {
  const amount = 4
  const image = await draw(page, {
    scatter: { amount, count: 2, axes: "across" },
  })
  const pixels = ink(image)
  const reach = RADIUS + amount * RADIUS
  const spread = Math.max(...pixels.map(({ y }) => Math.abs(y - Y)))
  // Thrown well past a plain stroke's half-width, and no further than the
  // amount allows (plus a pixel of the dab's soft rim).
  expect(spread).toBeGreaterThan(RADIUS * 2)
  expect(spread).toBeLessThanOrEqual(reach + 2)
  // Across travel only: nothing lands before the start or after the end.
  for (const { x } of pixels) {
    expect(x).toBeGreaterThanOrEqual(FROM - RADIUS - 2)
    expect(x).toBeLessThanOrEqual(TO + RADIUS + 2)
  }
})

test("coverage takes dabs stacked by count as one pass (D27)", async ({
  page,
}) => {
  const settings = { accumulation: "coverage", flow: 0.2 } as const
  const once = await draw(page, settings)
  const stacked = await draw(page, {
    ...settings,
    scatter: { amount: 0, count: 4, axes: "across" },
  })
  // The maximum of a dab with itself is that dab.
  expect(region(stacked)).toEqual(region(once))
})

test("buildup accumulates dabs stacked by count (D27)", async ({ page }) => {
  const settings = { accumulation: "buildup", flow: 0.1 } as const
  const once = await draw(page, settings)
  const stacked = await draw(page, {
    ...settings,
    scatter: { amount: 0, count: 4, axes: "across" },
  })
  expect(level(stacked, 80, Y)).toBeLessThan(level(once, 80, Y) - 10)
})

test("golden: a scattered stroke", async ({ page }) => {
  const image = await draw(page, {
    scatter: { amount: 3, count: 3, axes: "both" },
  })
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("scattered-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })
})
