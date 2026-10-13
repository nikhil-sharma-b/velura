import { expect, test, type Page } from "@playwright/test"

import { PAPER_SIZE, paperHeights } from "../../engine/gpu/paper"

/**
 * Paper and granulation (fluid brushes 07), through the engine's command
 * seam and the pixels it presents: every fluid brush paints on one paper,
 * pigment settles into its valleys by the brush's `granulation`, and the
 * paint the paper has taken shows the paper's grain at the document's
 * resolution, wet and dry alike.
 *
 * The simulation's clock is stopped here and stepped by command, as in the
 * fluid brush's own spec.
 */

const WIDTH = 240
const HEIGHT = 120
const ROW = 60
const BLUE = "#1040e0"
const SEPIA = "#704214"
/** No rim: a wash that dries flat, so what varies across it is the paper. */
const FLUID = { water: 0.5, drying: 0.5, bleed: 0.5, edge: 0, granulation: 0 }
const WASH = { from: 70, to: 170, radius: 30, flow: 0.1 }

type Origin = { x: number; y: number }
type Box = { left: number; top: number; right: number; bottom: number }

/**
 * Well inside the wash, where it is laid evenly: a radius in from each end
 * of the stroke, since paper nearer an end lies under fewer of its dabs.
 */
const INSIDE: Box = {
  left: WASH.from + WASH.radius,
  top: ROW - 14,
  right: WASH.to - WASH.radius,
  bottom: ROW + 14,
}

const PAPER = paperHeights()
/** The paper's height at a document pixel, in [0, 1]. */
const paperAt = (x: number, y: number) =>
  PAPER[(y % PAPER_SIZE) * PAPER_SIZE + (x % PAPER_SIZE)] / 255

async function openCanvas(page: Page): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour]) => {
      window.remountEngine({ manualFluidClock: true })
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", spacing: 0.125 })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [WIDTH, HEIGHT, BLUE] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

async function pixels(page: Page) {
  await frames(page)
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

/** How much paint a pixel shows: what has been taken out of white paper. */
const darkness = (image: number[], x: number, y: number) => {
  const at = (y * WIDTH + x) * 4
  return 765 - image[at] - image[at + 1] - image[at + 2]
}

const steps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

/** Runs the simulation on until paint has settled by itself. */
async function untilSettled(page: Page) {
  const before = await steps(page)
  for (let i = 0; i < 200 && (await steps(page)) === before; i++) {
    await advance(page, 20)
    // History reads the settled tiles back after the frame.
    await frames(page)
  }
  expect(await steps(page)).toBeGreaterThan(before)
}

/** Dries everything wet, waited for as the undo step it lands as. */
async function dryNow(page: Page) {
  const before = await steps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "dryNow" }))
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
      n,
    before
  )
}

/** A wash with a fluid brush along a row: its paint is wet. */
async function wash(
  page: Page,
  origin: Origin,
  fluid: typeof FLUID,
  { row = ROW, colour = BLUE, radius = WASH.radius } = {}
) {
  await page.evaluate(
    async ([fluid, colour, radius, flow]) => {
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "setBrush", fluid, radius, flow })
    },
    [fluid, colour, radius, WASH.flow] as const
  )
  await page.mouse.move(origin.x + WASH.from, origin.y + row)
  await page.mouse.down()
  await page.mouse.move(origin.x + WASH.to, origin.y + row, { steps: 30 })
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/**
 * How much darker a picture is in the paper's valleys than on its peaks,
 * over a box of it: the mean of one over the mean of the other.
 */
function valleysOverPeaks(image: number[], box: Box) {
  const valleys = { sum: 0, count: 0 }
  const peaks = { sum: 0, count: 0 }
  for (let y = box.top; y < box.bottom; y++)
    for (let x = box.left; x < box.right; x++) {
      const height = paperAt(x, y)
      const into = height < 0.35 ? valleys : height > 0.65 ? peaks : null
      if (!into) continue
      into.sum += darkness(image, x, y)
      into.count++
    }
  expect(Math.min(valleys.count, peaks.count)).toBeGreaterThan(50)
  return valleys.sum / valleys.count / (peaks.sum / peaks.count)
}

/**
 * How unevenly a picture shows paper of one height, over a box of it: the
 * pixels are sorted by the paper's height under them into narrow bands, and
 * this is the spread of darkness within a band, as a share of the mean. The
 * glaze shows paper of one height alike, so what is left is speckle the
 * simulation made.
 */
function speckle(image: number[], box: Box) {
  const BANDS = 32
  const bands = Array.from({ length: BANDS }, () => [] as number[])
  let total = 0
  let count = 0
  for (let y = box.top; y < box.bottom; y++)
    for (let x = box.left; x < box.right; x++) {
      const dark = darkness(image, x, y)
      bands[Math.min(BANDS - 1, Math.floor(paperAt(x, y) * BANDS))].push(dark)
      total += dark
      count++
    }
  let spread = 0
  let counted = 0
  for (const band of bands) {
    if (band.length < 20) continue
    const mean = band.reduce((sum, dark) => sum + dark, 0) / band.length
    const variance =
      band.reduce((sum, dark) => sum + (dark - mean) ** 2, 0) / band.length
    spread += Math.sqrt(variance) * band.length
    counted += band.length
  }
  expect(counted).toBeGreaterThan(count / 2)
  return spread / counted / (total / count)
}

/** A wash at a brush's `granulation`, left to dry by itself. */
async function leftToDry(page: Page, granulation: number) {
  const origin = await openCanvas(page)
  await wash(page, origin, { ...FLUID, granulation })
  await untilSettled(page)
  return pixels(page)
}

test("a dried wash with granulation up shows more pigment in the paper's valleys than on its peaks", async ({
  page,
}) => {
  // On CI's software GPU this has run to within a quarter of the minute an
  // ordinary test is given there, or past it.
  test.slow()
  const granulated = await leftToDry(page, 1)
  const flat = await leftToDry(page, 0)
  // The glaze shows the grain in any paint the paper has taken; granulation
  // is the pigment that gathered in the valleys besides.
  expect(valleysOverPeaks(flat, INSIDE)).toBeGreaterThan(1.02)
  expect(valleysOverPeaks(granulated, INSIDE)).toBeGreaterThan(
    valleysOverPeaks(flat, INSIDE) * 1.25
  )
  // At the most granulation there is (`MAX_GRANULATION`, tuned down in
  // fluid brushes 12), about three times a flat wash's.
  expect(speckle(granulated, INSIDE)).toBeGreaterThan(0.045)
  expect(speckle(granulated, INSIDE)).toBeGreaterThan(speckle(flat, INSIDE) * 2)
})

test("with granulation at zero a wash dries without speckle from the simulation", async ({
  page,
}) => {
  const image = await leftToDry(page, 0)
  expect(darkness(image, 120, ROW)).toBeGreaterThan(30)
  // Paper of one height shows one darkness, to the rounding of a channel
  // and the width of a band.
  expect(speckle(image, INSIDE)).toBeLessThan(0.03)
})

test("two washes from two different fluid brushes granulate into the same paper", async ({
  page,
}) => {
  // On CI's software GPU this has run to within a quarter of the minute an
  // ordinary test is given there, or past it.
  test.slow()
  const origin = await openCanvas(page)
  // Two brushes of different sizes, colours and rates, one after the other
  // and apart: each gathers in the valleys of the one paper, which is where
  // the document's pixels put them and not where either stroke began.
  await wash(
    page,
    origin,
    { ...FLUID, granulation: 1 },
    { row: 30, radius: 20 }
  )
  await untilSettled(page)
  await wash(
    page,
    origin,
    { ...FLUID, water: 0.8, drying: 0.7, granulation: 0.7 },
    { row: 91, radius: 16, colour: SEPIA }
  )
  await untilSettled(page)
  const image = await pixels(page)
  const first = { ...INSIDE, top: 30 - 10, bottom: 30 + 10 }
  const second = { ...INSIDE, top: 91 - 8, bottom: 91 + 8 }
  expect(valleysOverPeaks(image, first)).toBeGreaterThan(1.3)
  expect(valleysOverPeaks(image, second)).toBeGreaterThan(1.3)
})

test("the grain is at the document's resolution, not the simulation's", async ({
  page,
}) => {
  // No granulation: the simulation holds this wash smooth, a cell to two
  // document pixels, and what grain it shows is the glaze's.
  const image = await leftToDry(page, 0)
  // Two pixels side by side in one cell of the simulation, on paper of
  // different heights: the one in the valley is the darker.
  let pairs = 0
  let ordered = 0
  for (let y = INSIDE.top; y < INSIDE.bottom; y++)
    // A cell begins on an even pixel.
    for (let x = INSIDE.left + (INSIDE.left % 2); x < INSIDE.right; x += 2) {
      const fall = paperAt(x, y) - paperAt(x + 1, y)
      if (Math.abs(fall) < 0.1) continue
      pairs++
      const darker = darkness(image, x + 1, y) - darkness(image, x, y)
      if (Math.sign(darker) === Math.sign(fall)) ordered++
    }
  expect(pairs).toBeGreaterThan(50)
  expect(ordered / pairs).toBeGreaterThan(0.95)
})

test("a granulating wash settles into the picture it last showed", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin, { ...FLUID, edge: 0.5, granulation: 1 })
  // Part dry: some of the pigment is in the paper and some still in water.
  await advance(page, 150)
  const wet = await pixels(page)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(true)
  expect(valleysOverPeaks(wet, INSIDE)).toBeGreaterThan(1.02)
  await dryNow(page)
  const dry = await pixels(page)
  // A layer stores half floats, so a channel may round the other way.
  const off = dry.filter((channel, index) => Math.abs(channel - wet[index]) > 1)
  expect(off.length).toBe(0)
})

test("the paper is made once, with the renderer", async ({ page }) => {
  await page.addInitScript(() => {
    const device = GPUDevice.prototype
    const createTexture = device.createTexture
    const made = { papers: 0 }
    Object.assign(window, { made })
    device.createTexture = function (
      ...args: Parameters<typeof createTexture>
    ) {
      if (args[0].label === "paper") made.papers++
      return createTexture.apply(this, args)
    }
  })
  const papers = () =>
    page.evaluate(
      () => (window as unknown as { made: { papers: number } }).made.papers
    )
  const origin = await openCanvas(page)
  // Before any brush is fluid.
  const before = await papers()
  expect(before).toBeGreaterThan(0)
  await wash(page, origin, { ...FLUID, granulation: 1 })
  await wash(page, origin, { ...FLUID, granulation: 0.3 }, { colour: SEPIA })
  await untilSettled(page)
  await wash(page, origin, FLUID)
  await dryNow(page)
  expect(await papers()).toBe(before)
})
