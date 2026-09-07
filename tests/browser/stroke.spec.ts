import { expect, test, type Page } from "@playwright/test"
import { BRUSH_RADIUS } from "../../engine/brush/round-brush"

const WIDTH = 200
const HEIGHT = 120

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
    },
    [WIDTH, HEIGHT]
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

/** Lets the engine's frame loop run, then reads what it presented. */
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

test("a stroke paints a continuous mark under the pen", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.mouse.move(origin.x + 20, origin.y + 60)
  await page.mouse.down()
  await page.mouse.move(origin.x + 170, origin.y + 60, { steps: 30 })
  await page.mouse.up()
  const image = await painted(page)

  // The whole span is inked: gaps would mean stamps placed per event rather
  // than per unit of arc length.
  for (let x = 24; x <= 166; x += 1) expect(isInk(image, x, 60)).toBe(true)
  // And the mark is a stroke, not a flood: it has an edge either side.
  expect(isInk(image, 90, 60 - BRUSH_RADIUS - 3)).toBe(false)
  expect(isInk(image, 90, 60 + BRUSH_RADIUS + 3)).toBe(false)
  expect(isInk(image, 5, 5)).toBe(false)
})

test("a flicked stroke does not gap where a slow one does not blob", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  // Three long jumps: the pen reports a handful of samples for the whole
  // stroke, and everything between them comes from the resampled spline.
  await page.mouse.move(origin.x + 20, origin.y + 30)
  await page.mouse.down()
  await page.mouse.move(origin.x + 70, origin.y + 30)
  await page.mouse.move(origin.x + 120, origin.y + 30)
  await page.mouse.move(origin.x + 170, origin.y + 30)
  await page.mouse.up()
  const image = await painted(page)
  for (let x = 24; x <= 166; x += 1) expect(isInk(image, x, 30)).toBe(true)
})

test("drawing never notifies React", async ({ page }) => {
  const origin = await openCanvas(page)
  const draw = async (y: number) => {
    await page.mouse.move(origin.x + 30, origin.y + y)
    await page.mouse.down()
    await page.mouse.move(origin.x + 160, origin.y + y + 50, { steps: 40 })
    await page.mouse.up()
    await painted(page)
  }
  // The first mark makes undo possible, which the interface has to hear about
  // once; it is counted separately so what follows is measured against a
  // document whose reported state a stroke can no longer change.
  await draw(40)
  await page.waitForFunction(() => window.engine.getSnapshot().canUndo)
  await page.evaluate(() => {
    window.strokeNotifications = 0
    window.engine.subscribe(() => {
      window.strokeNotifications++
    })
  })
  await draw(20)
  await page.waitForFunction(() => window.engine.historyUsage().steps === 2)
  // Snapshots are emitted on structural change only; a stroke is not one.
  expect(await page.evaluate(() => window.strokeNotifications)).toBe(0)
})

test("the smoothing control trades directness for a steadier line", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const shake = async () => {
    await page.mouse.move(origin.x + 20, origin.y + 60)
    await page.mouse.down()
    for (let i = 1; i <= 30; i++)
      await page.mouse.move(
        origin.x + 20 + i * 4,
        origin.y + 60 + Math.sin(i * 1.7) * 5
      )
    await page.mouse.up()
  }

  await page.evaluate(() =>
    window.engine.dispatch({ type: "setStabilization", strength: 0 })
  )
  await shake()
  const raw = await painted(page)

  await page.evaluate(async () => {
    window.remountEngine()
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 1 })
  })
  await shake()
  const smoothed = await painted(page)

  // Height of the inked band at mid-stroke: the tremor widens it, and
  // stabilization pulls it back towards a clean line.
  const bandHeight = (image: { width: number; data: number[] }) => {
    let count = 0
    for (let y = 0; y < HEIGHT; y++) if (isInk(image, 90, y)) count++
    return count
  }
  expect(bandHeight(smoothed)).toBeLessThan(bandHeight(raw))
  expect(bandHeight(smoothed)).toBeGreaterThan(0)
})

test("a smoothed stroke still ends where the pen lifted", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setStabilization", strength: 1 })
  )
  await page.mouse.move(origin.x + 20, origin.y + 60)
  await page.mouse.down()
  await page.mouse.move(origin.x + 170, origin.y + 60, { steps: 30 })
  await page.mouse.up()
  const image = await painted(page)
  // Without releasing the string the mark would stop a full pull radius short.
  expect(isInk(image, 168, 60)).toBe(true)
})

test("stabilization is reported back and clamped to the usable range", async ({
  page,
}) => {
  await openCanvas(page)
  const reported = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setStabilization", strength: 0.4 })
    const set = window.engine.getSnapshot().stabilization
    await window.engine.dispatch({ type: "setStabilization", strength: 9 })
    return { set, clamped: window.engine.getSnapshot().stabilization }
  })
  expect(reported).toEqual({ set: 0.4, clamped: 1 })
})

test("hardness sets how sharply the mark ends at its rim", async ({ page }) => {
  // The brush's own feather, reaching the shader through `setBrush` — the path
  // the editor's hardness control uses. A hard brush is ink then backdrop in a
  // pixel or two; a soft one falls off over the width of the falloff.
  const edgeOf = async (feather: number) => {
    const origin = await openCanvas(page)
    await page.evaluate(
      (width) =>
        window.engine.dispatch({
          type: "setBrush",
          radius: 16,
          feather: width,
        }),
      feather
    )
    await page.mouse.move(origin.x + 40, origin.y + 60)
    await page.mouse.down()
    await page.mouse.move(origin.x + 160, origin.y + 60, { steps: 20 })
    await page.mouse.up()
    const image = await painted(page)
    // How many rows on the way out of the mark are neither ink nor backdrop.
    let falling = 0
    for (let y = 60; y < 60 + 24; y++) {
      const level = image.data[(y * image.width + 100) * 4]
      if (level > 50 && level < 240) falling++
    }
    return falling
  }

  const hard = await edgeOf(0)
  const soft = await edgeOf(8)
  expect(soft).toBeGreaterThan(hard + 2)
})
