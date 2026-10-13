import { expect, test, type Page } from "@playwright/test"

/**
 * Blooms (fluid brushes 08), through the engine's command seam and the
 * pixels it presents. The edge of a wash stays where the brush put it unless
 * the brush lays more water than the paper holds: then the damp edge moves
 * outward and takes pigment with it, into a neighbouring tile if that is
 * where it leads.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 160
/** The row strokes are drawn along. */
const ROW = 80
const BLUE = "#1040e0"
/** Water the paper holds, and no rim: only a bloom moves an edge here. */
const ORDINARY = {
  water: 0.5,
  drying: 0.5,
  bleed: 0.5,
  edge: 0,
  granulation: 0,
}
/** As much water as a brush carries, which is more than the paper holds. */
const FLOODED = { ...ORDINARY, water: 1 }

type Origin = { x: number; y: number }
type Fluid = typeof ORDINARY

async function openCanvas(
  page: Page,
  width = WIDTH,
  height = HEIGHT
): Promise<Origin> {
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
    [width, height, BLUE] as const
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

/** A picture of the canvas, and how much paint each of its pixels shows. */
async function picture(page: Page, width = WIDTH) {
  await frames(page)
  const image = await page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
  /** What has been taken out of white paper at a pixel. */
  return (x: number, y: number) => {
    const at = (y * width + x) * 4
    return 765 - image[at] - image[at + 1] - image[at + 2]
  }
}
type Picture = Awaited<ReturnType<typeof picture>>

/** The undo steps that are in the layers' own pixels. */
const steps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

/** The brush: how it is fluid, its size, and the pigment a dab carries. */
const setBrush = (page: Page, fluid: Fluid, radius: number, flow: number) =>
  page.evaluate(
    ([fluid, radius, flow]) =>
      window.engine.dispatch({ type: "setBrush", fluid, radius, flow }),
    [fluid, radius, flow] as const
  )

/** A drag with a fluid brush: its paint is wet, and in no tile yet. */
async function wash(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  await page.mouse.move(origin.x + from, origin.y + row)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + row, { steps: 30 })
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/** Runs the simulation on by so many steps. */
const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

/** Runs the simulation on until paint has settled by itself. */
async function untilSettled(page: Page) {
  const before = await steps(page)
  for (let i = 0; i < 200 && (await steps(page)) === before; i++) {
    await advance(page, 40)
    // History reads the settled tiles back after the frame.
    await frames(page)
  }
  expect(await steps(page)).toBeGreaterThan(before)
}

/**
 * Dries everything wet, waited for as the undo step it lands as: for as long
 * as the test has, since the steps before it are slow where the GPU is
 * software and the settle is read back behind them.
 */
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

/** Paint enough to see, as a pixel shows it. */
const PAINTED = 12

/** How many pixels of a column show paint. */
function painted(image: Picture, x: number, height = HEIGHT) {
  let count = 0
  for (let y = 0; y < height; y++) if (image(x, y) > PAINTED) count++
  return count
}

const STROKE = { from: 70, to: 170, radius: 20, flow: 0.3 }
const MIDDLE = (STROKE.from + STROKE.to) / 2

/** A stroke as it was laid, and as it is once it has dried by itself. */
async function laidAndDried(page: Page, fluid: Fluid) {
  const origin = await openCanvas(page)
  await setBrush(page, fluid, STROKE.radius, STROKE.flow)
  await wash(page, origin, STROKE.from, STROKE.to)
  const laid = await picture(page)
  await untilSettled(page)
  return { laid, dried: await picture(page) }
}

test("a stroke with ordinary water keeps the edge the brush gave it", async ({
  page,
}) => {
  const { laid, dried } = await laidAndDried(page, ORDINARY)
  expect(painted(laid, MIDDLE)).toBeGreaterThan(STROKE.radius)
  for (const x of [STROKE.from, MIDDLE, STROKE.to])
    expect(
      Math.abs(painted(dried, x) - painted(laid, x)),
      `column ${x}`
    ).toBeLessThanOrEqual(2)
})

test("a flooded stroke ends wider than it was laid", async ({ page }) => {
  // On CI's software GPU this has run to within a quarter of the minute an
  // ordinary test is given there, or past it.
  test.slow()
  const { laid, dried } = await laidAndDried(page, FLOODED)
  for (const x of [STROKE.from, MIDDLE, STROKE.to])
    expect(painted(dried, x), `column ${x}`).toBeGreaterThan(
      painted(laid, x) + 4
    )
})

test("water laid into a drying wash leaves a lighter centre and pigment pushed outward", async ({
  page,
}) => {
  // On CI's software GPU this has run to within a quarter of the minute an
  // ordinary test is given there, or past it.
  test.slow()
  const DROP = { radius: 8, reach: 30 }
  /** A wash part dried, with or without a drop of water let into it. */
  const dried = async (drop: boolean) => {
    const origin = await openCanvas(page)
    await setBrush(page, ORDINARY, 36, 0.3)
    await wash(page, origin, 80, 160)
    // Nearly dry: little water stands on it, and its pigment is still in
    // what does.
    await advance(page, 600)
    if (drop) {
      // Water and no pigment.
      await setBrush(page, FLOODED, DROP.radius, 0)
      await wash(page, origin, MIDDLE - 1, MIDDLE + 1)
    }
    await untilSettled(page)
    return picture(page)
  }
  const plain = await dried(false)
  const bloomed = await dried(true)
  // Where the water fell the wash is lighter than it would have dried.
  expect(bloomed(MIDDLE, ROW)).toBeLessThan(plain(MIDDLE, ROW) * 0.5)
  // And the pigment it pushed out lies about it, darker than the wash was.
  let most = 0
  for (let r = DROP.radius; r <= DROP.reach; r++)
    most = Math.max(
      most,
      bloomed(MIDDLE + r, ROW) - plain(MIDDLE + r, ROW),
      bloomed(MIDDLE, ROW - r) - plain(MIDDLE, ROW - r)
    )
  expect(most).toBeGreaterThan(plain(MIDDLE, ROW) * 0.25)
})

/** Tiles are 256 px: this is the border between the first two rows. */
const BORDER = 256
/**
 * The row a stroke is drawn along for its dabs to end just short of a line:
 * a dab is laid a cell past its rim, and a cell is two pixels.
 */
const above = (line: number, radius: number) => line - radius - 3

test("a bloom beside a tile border crosses it with no wall and no seam, and is undone with its stroke", async ({
  page,
}) => {
  // On CI's software GPU this has run to within a quarter of the minute an
  // ordinary test is given there, or past it.
  test.slow()
  const radius = 30
  // Slow to dry, so the water stands deeper than the paper holds for long
  // enough to carry the damp edge well past the border.
  const standing = { ...FLOODED, drying: 0 }
  /** A column of the tile below the border, which no dab reaches. */
  const below = (image: Picture) =>
    Array.from({ length: 12 }, (_, row) => image(MIDDLE, BORDER + row))
  /**
   * A flooded stroke whose dabs end just above `BORDER + shift`, left to
   * bloom and dried: the picture of it from `shift` rows up. The canvas is
   * one tile wide and two deep, and no larger: a step is slow where the GPU
   * is software.
   */
  const bloomedBy = async (shift: number) => {
    const origin = await openCanvas(page, WIDTH, 400)
    const empty = await picture(page)
    await setBrush(page, standing, radius, 0.3)
    await wash(page, origin, 80, 160, above(BORDER + shift, radius))
    // Dried by command, long before it would by itself.
    await advance(page, 250)
    await dryNow(page)
    const image = await picture(page)
    if (shift === 0) {
      // The tile the bloom crossed into was settled and kept with the
      // rest: undo takes the paint out of it, and redo puts it back.
      expect(below(image)[1]).toBeGreaterThan(PAINTED)
      await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
      expect(below(await picture(page))).toEqual(below(empty))
      await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
      expect(below(await picture(page))).toEqual(below(image))
    }
    return (x: number, y: number) => image(x, y + shift)
  }
  // Unshifted, no dab reaches the tile below the border; a quarter tile
  // down, the same stroke has no border within a bloom's reach.
  const across = await bloomedBy(0)
  const within = await bloomedBy(64)
  /** How many rows past the border line a column's paint goes on. */
  const past = (image: typeof across, x: number) => {
    let rows = 0
    while (image(x, BORDER + rows) > PAINTED) rows++
    return rows
  }
  for (const x of [90, 120, 150]) {
    // No wall: the paint goes on past the border, by more than the pixel a
    // cell this side of it would show there.
    expect(past(across, x), `column ${x}`).toBeGreaterThan(2)
    // No seam. The front is where it is with no border, to a cell: it
    // follows the paper, and a quarter tile down is other paper.
    const front = Math.min(past(across, x), past(within, x))
    expect(
      Math.abs(past(across, x) - past(within, x)),
      `column ${x}`
    ).toBeLessThanOrEqual(2)
    // And behind the front the paint either side of the border is the paint
    // there is where there is no border, to the paper's grain.
    for (let y = BORDER - 16; y < BORDER + front - 4; y++)
      expect(
        Math.abs(across(x, y) - within(x, y)),
        `column ${x}, row ${y}`
      ).toBeLessThanOrEqual(12)
  }
})

test("the tiles about a stroke's own dry with it, and are freed with it", async ({
  page,
}) => {
  const origin = await openCanvas(page, WIDTH, 400)
  // Quick to dry: what is looked for is that nothing is left wet.
  await setBrush(page, { ...FLOODED, drying: 1 }, 30, 0.3)
  const before = await steps(page)
  // In one tile, with the one below it wet for whatever blooms into it.
  await wash(page, origin, 100, 140, above(BORDER, 30))
  expect(await isWet(page)).toBe(true)
  await untilSettled(page)
  // One body, so one step, and no tile of the ring still held.
  expect(await steps(page)).toBe(before + 1)
  expect(await isWet(page)).toBe(false)
  await advance(page, 400)
  await frames(page)
  expect(await steps(page)).toBe(before + 1)
})
