import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import { decodeTransfer } from "../../engine/color/display-transform"

const WIDTH = 160
const HEIGHT = 160
/** Low enough that a second pass over a pixel is plainly visible. */
const FLOW = 0.1

type Brush = {
  accumulation?: "coverage" | "buildup"
  opacity?: number
  flow?: number
}

async function openCanvas(page: Page, brush: Brush = {}) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([size, settings]) => {
      const { width, height } = size as { width: number; height: number }
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", ...(settings as Brush) })
    },
    [{ width: WIDTH, height: HEIGHT }, brush] as const
  )
  const box = (await page.locator("canvas").first().boundingBox())!
  return { x: box.x, y: box.y }
}

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

type Image = { width: number; data: number[] }

/** Red channel at a pixel. Ink is much darker than the document backdrop. */
function level(image: Image, x: number, y: number): number {
  return image.data[(Math.round(y) * image.width + Math.round(x)) * 4]
}

/**
 * A stroke that crosses itself once, at the centre: down the left arm of an X,
 * back up the right. The crossing is the pixel both arms cover.
 */
const CROSSING = { x: 80, y: 80 }
const ON_ONE_ARM = { x: 40, y: 40 }

async function drawCross(page: Page, origin: { x: number; y: number }) {
  await page.mouse.move(origin.x + 20, origin.y + 20)
  await page.mouse.down()
  await page.mouse.move(origin.x + 140, origin.y + 140, { steps: 40 })
  await page.mouse.move(origin.x + 140, origin.y + 20, { steps: 40 })
  await page.mouse.move(origin.x + 20, origin.y + 140, { steps: 40 })
  await page.mouse.up()
}

test("a coverage stroke does not darken where it crosses itself", async ({
  page,
}) => {
  const origin = await openCanvas(page, {
    accumulation: "coverage",
    flow: FLOW,
  })
  await drawCross(page, origin)
  const image = await painted(page)
  // Both arms are inked, and the crossing is no darker than either: coverage
  // takes the maximum, so the mark reads as one flat pass of the marker.
  expect(level(image, ON_ONE_ARM.x, ON_ONE_ARM.y)).toBeLessThan(
    level(image, 5, 5)
  )
  expect(level(image, CROSSING.x, CROSSING.y)).toBeCloseTo(
    level(image, ON_ONE_ARM.x, ON_ONE_ARM.y),
    -0.5
  )
})

test("a buildup stroke darkens where it crosses itself", async ({ page }) => {
  const origin = await openCanvas(page, { accumulation: "buildup", flow: FLOW })
  await drawCross(page, origin)
  const image = await painted(page)
  expect(level(image, CROSSING.x, CROSSING.y)).toBeLessThan(
    level(image, ON_ONE_ARM.x, ON_ONE_ARM.y) - 10
  )
})

/**
 * How much ink covers a pixel, recovered from what was presented. The mark is
 * ink over backdrop in linear light, so coverage is where the pixel sits
 * between the two — which is the quantity stroke opacity is supposed to scale.
 */
function coverage(image: Image, x: number, y: number): number {
  const backdrop = decodeTransfer(level(image, 5, 5) / 255)
  const ink = decodeTransfer(36 / 255)
  const pixel = decodeTransfer(level(image, x, y) / 255)
  return (backdrop - pixel) / (backdrop - ink)
}

test("stroke opacity fades the whole mark, not each dab", async ({ page }) => {
  // Buildup, because under coverage's maximum a per-dab opacity and a
  // whole-stroke one produce identical pixels: the mode cannot tell them
  // apart, so it cannot test this.
  const settings = { accumulation: "buildup", flow: 0.2 } as const
  const origin = await openCanvas(page, { ...settings, opacity: 1 })
  await drawCross(page, origin)
  const full = await painted(page)

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
      await window.engine.dispatch({
        type: "setBrush",
        accumulation: "buildup",
        flow: 0.2,
        opacity: 0.5,
      })
    },
    [WIDTH, HEIGHT]
  )
  await drawCross(page, origin)
  const half = await painted(page)

  // Half opacity halves the finished mark. Applying the same 0.5 per dab
  // instead would have changed the shape of the accumulation, not scaled it:
  // the crossing, where the most dabs stack, is where the two diverge.
  for (const point of [ON_ONE_ARM, CROSSING])
    expect(coverage(half, point.x, point.y)).toBeCloseTo(
      coverage(full, point.x, point.y) / 2,
      1
    )
  expect(coverage(full, CROSSING.x, CROSSING.y)).toBeGreaterThan(0.5)
})

test("the layer is untouched until the pen lifts", async ({ page }) => {
  const origin = await openCanvas(page, {
    accumulation: "buildup",
    flow: 0.2,
    opacity: 0.5,
  })
  await page.mouse.move(origin.x + 20, origin.y + 80)
  await page.mouse.down()
  await page.mouse.move(origin.x + 140, origin.y + 80, { steps: 40 })
  const inFlight = await painted(page)
  await page.mouse.up()
  const lifted = await painted(page)
  // The mark in flight is already shown at the stroke's opacity, and lifting
  // the pen does not change it. Dabs that had gone straight into the layer
  // would be composited a second time here, and the mark would jump.
  expect(coverage(inFlight, 80, 80)).toBeGreaterThan(0.2)
  expect(coverage(lifted, 80, 80)).toBeCloseTo(coverage(inFlight, 80, 80), 1)
})

test("a second stroke does build over the first, because each composites on lift", async ({
  page,
}) => {
  const origin = await openCanvas(page, {
    accumulation: "buildup",
    flow: FLOW,
    opacity: 0.5,
  })
  const armStroke = async (from: [number, number], to: [number, number]) => {
    await page.mouse.move(origin.x + from[0], origin.y + from[1])
    await page.mouse.down()
    await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 40 })
    await page.mouse.up()
    // Each stroke must reach the layer before the next begins, or the second
    // would find the first still sitting in the stroke buffer.
    await painted(page)
  }
  await armStroke([20, 20], [140, 140])
  const single = await painted(page)
  await armStroke([140, 20], [20, 140])
  const crossed = await painted(page)
  expect(level(crossed, CROSSING.x, CROSSING.y)).toBeLessThan(
    level(single, CROSSING.x, CROSSING.y) - 10
  )
  // The first stroke survived the second: it is in the layer, not the buffer.
  expect(level(crossed, ON_ONE_ARM.x, ON_ONE_ARM.y)).toBeCloseTo(
    level(single, ON_ONE_ARM.x, ON_ONE_ARM.y),
    -0.5
  )
})

test("discarding the newest stamps leaves the stroke as if they were never drawn", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    ([width, height]) => window.openStrokeBufferProbe(width, height),
    [64, 64]
  )
  const probe = page.locator("#probe")

  /** Draws `drawn` dabs along a row, takes `discarded` of them back. */
  const strokeThen = (drawn: number, discarded: number) =>
    page.evaluate(
      ([all, drop]) => {
        window.probe.beginStroke("coverage", 1)
        window.probe.stamp(
          Array.from({ length: all }, (_, i) => ({
            x: 8 + i * 6,
            y: 32,
            radius: 6,
            opacity: 0.4,
          }))
        )
        const accepted = window.probe.discardStamps(drop)
        window.probe.present()
        return accepted
      },
      [drawn, discarded] as const
    )

  await strokeThen(4, 0)
  const four = PNG.sync.read(await probe.screenshot())
  const accepted = await strokeThen(7, 3)
  const sevenLessThree = PNG.sync.read(await probe.screenshot())
  expect(accepted).toBe(true)
  // Coverage blending cannot be undone in place, so this passing means the
  // buffer was cleared and the surviving dabs replayed.
  expect(Buffer.from(sevenLessThree.data)).toEqual(Buffer.from(four.data))
})

test("golden: a self-crossing stroke in each accumulation mode", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const probe = page.locator("#probe")
  const cross = () => {
    const dabs: { x: number; y: number; radius: number; opacity: number }[] = []
    for (let i = 0; i <= 60; i++) {
      dabs.push({ x: 18 + i, y: 18 + i, radius: 7, opacity: 0.15 })
      dabs.push({ x: 78 - i, y: 18 + i, radius: 7, opacity: 0.15 })
    }
    return dabs
  }

  for (const accumulation of ["coverage", "buildup"] as const) {
    // A fresh probe each time: `endStroke` composites into the layer, and a
    // layer carried over from the previous mode would put both marks in the
    // second golden.
    await page.evaluate(
      ([width, height]) => window.openStrokeBufferProbe(width, height),
      [96, 96]
    )
    await page.evaluate(
      ([mode, dabs]) => {
        window.probe.beginStroke(mode as "coverage" | "buildup", 1)
        window.probe.stamp(
          dabs as { x: number; y: number; radius: number; opacity: number }[]
        )
        window.probe.endStroke()
        window.probe.present()
      },
      [accumulation, cross()] as const
    )
    expect(await probe.screenshot()).toMatchSnapshot(
      `self-crossing-${accumulation}.png`,
      { maxDiffPixelRatio: 0.01 }
    )
  }
})

test("a stroke clears only where it painted, and the next stroke starts clean", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.openStrokeBufferProbe)
  await page.evaluate(() => window.openStrokeBufferProbe(64, 64))
  const alphaAfter = (opacity: number) =>
    page.evaluate(async (dabOpacity) => {
      window.probe.beginStroke("coverage", 1)
      window.probe.stamp([{ x: 32, y: 32, radius: 12, opacity: dabOpacity }])
      window.probe.endStroke()
      return (await window.probe.readLayerPixel(32, 32))[3]
    }, opacity)
  const first = await alphaAfter(0.6)
  // Weaker than the first: coverage depth left over from the last stroke
  // would reject it, and ink left in the buffer would composite twice.
  const second = await alphaAfter(0.2)
  const expected = first + 0.2 * (1 - first)
  expect(second).toBeGreaterThan(first)
  expect(second).toBeCloseTo(expected, 2)
})
