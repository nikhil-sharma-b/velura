import { expect, test, type Page } from "@playwright/test"

/**
 * Undo, redo and cancel while paint is wet (fluid brushes 04), through the
 * engine's command seam and the pixels it presents. A fluid stroke is a step
 * that holds the wet fields as they were at pen-down, on the GPU; a settle is
 * one step over the tiles it wrote and takes those steps out of history. So
 * undo goes stroke by stroke through what was painted since anything last
 * dried, and passage by passage before that.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row strokes are drawn along. */
const ROW = 60
const BLUE = "#1040e0"
const YELLOW = "#f0c020"
const FLUID = { water: 0.5, drying: 0.5, bleed: 1, edge: 0.5, granulation: 0 }
/** A brush whose paint is dry within two hundred steps. */
const QUICK = { ...FLUID, drying: 1 }
/** The wet fields of one wet tile, copied: half floats in three fields. */
const TILE_COPY_BYTES = 128 * 128 * 3 * 8

type Origin = { x: number; y: number }

async function openCanvas(
  page: Page,
  options: { width?: number; height?: number; wetBudgetBytes?: number } = {}
): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, fluid, wetBudgetBytes]) => {
      window.remountEngine({
        manualFluidClock: true,
        ...(wetBudgetBytes ? { history: { wetBudgetBytes } } : {}),
      })
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
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.125,
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [
      options.width ?? WIDTH,
      options.height ?? HEIGHT,
      BLUE,
      FLUID,
      options.wetBudgetBytes,
    ] as const
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

const rgba = (image: number[], x: number, y = ROW, width = WIDTH) =>
  image.slice((y * width + x) * 4, (y * width + x) * 4 + 4)

/** How far two pixels are apart, summed over their channels. */
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)

/**
 * How many channels of two pictures are over one apart: a layer stores half
 * floats, so a channel may round the other way.
 */
const differing = (a: number[], b: number[]) =>
  a.reduce(
    (count, channel, index) =>
      count + (Math.abs(channel - b[index]) > 1 ? 1 : 0),
    0
  )

const usage = (page: Page) => page.evaluate(() => window.engine.historyUsage())

/** The steps undo can take back that are fluid strokes still wet. */
const wetSteps = async (page: Page) => (await usage(page)).wetSteps

/** The steps undo can take back that are in the layer's own pixels. */
const drySteps = async (page: Page) => {
  const { steps, wetSteps } = await usage(page)
  return steps - wetSteps
}

const setColour = (page: Page, hex: string) =>
  page.evaluate((hex) => window.engine.dispatch({ type: "setColor", hex }), hex)

const setFluid = (page: Page, fluid: typeof FLUID) =>
  page.evaluate(
    (fluid) => window.engine.dispatch({ type: "setBrush", fluid }),
    fluid
  )

const undo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "undo" }))

const redo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "redo" }))

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

/** Runs the simulation on by so many steps. */
const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

async function penDown(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  await page.mouse.move(origin.x + from, origin.y + row)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + row, { steps: 30 })
}

/** A drag with the fluid brush, waited for as the wet step it lands as. */
async function wash(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  await penDown(page, origin, from, to, row)
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/** Dries everything wet, waited for as the step it lands as. */
async function dryNow(page: Page) {
  const before = await drySteps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "dryNow" }))
  await page.waitForFunction((n) => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps > n
  }, before)
}

/**
 * Three strokes into one wash: blue, a touch of yellow that bleeds into it,
 * and a second blue stroke beside them. Answers the picture just before the
 * third and the one once all three have run on a little.
 */
async function threeStrokes(page: Page, origin: Origin) {
  await wash(page, origin, 30, 130)
  await setColour(page, YELLOW)
  await wash(page, origin, 76, 84)
  await advance(page, 20)
  const beforeThird = await pixels(page)
  await setColour(page, BLUE)
  await wash(page, origin, 150, 210)
  await advance(page, 20)
  return { beforeThird, withThird: await pixels(page) }
}

test("three fluid strokes then one undo leave the wash as it was before the third, still moving", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  const { beforeThird, withThird } = await threeStrokes(page, origin)
  // Each stroke is a step, and none of them is in the layer.
  expect(await wetSteps(page)).toBe(3)
  expect(await drySteps(page)).toBe(1)
  expect(distance(rgba(withThird, 180), rgba(empty, 180))).toBeGreaterThan(200)

  await undo(page)
  const undone = await pixels(page)
  expect(differing(undone, beforeThird)).toBe(0)
  expect(rgba(undone, 180)).toEqual(rgba(empty, 180))
  expect(await isWet(page)).toBe(true)
  expect(await wetSteps(page)).toBe(2)

  // The paint is wet and goes on moving from there.
  await advance(page, 80)
  expect(differing(await pixels(page), undone)).toBeGreaterThan(0)
  expect(await isWet(page)).toBe(true)
})

test("redo puts the third stroke back, as the wash was at the moment of the undo", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const { beforeThird, withThird } = await threeStrokes(page, origin)
  await undo(page)
  // Whatever the wash does undone is not what redo gives back.
  await advance(page, 40)
  await redo(page)
  expect(differing(await pixels(page), withThird)).toBe(0)
  expect(await wetSteps(page)).toBe(3)
  expect(await isWet(page)).toBe(true)

  // And undo is still safe to press: the pen-down copy is still held.
  await undo(page)
  expect(differing(await pixels(page), beforeThird)).toBe(0)
})

test("undo goes back stroke by stroke to a dry layer, and redo forward again", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  const { withThird } = await threeStrokes(page, origin)
  for (let i = 0; i < 3; i++) await undo(page)
  // The first stroke found the layer dry, and undoing it leaves it so.
  expect(await isWet(page)).toBe(false)
  expect(await pixels(page)).toEqual(empty)
  expect(await wetSteps(page)).toBe(0)
  expect(await drySteps(page)).toBe(1)

  for (let i = 0; i < 3; i++) await redo(page)
  expect(await isWet(page)).toBe(true)
  expect(differing(await pixels(page), withThird)).toBe(0)
})

test("a cancelled fluid stroke leaves the wet fields as they were at pen-down", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin, 30, 130)
  await advance(page, 20)
  const before = await pixels(page)
  await setColour(page, YELLOW)
  // Through the wash and out over the empty layer beside it.
  await penDown(page, origin, 60, 200)
  await frames(page)
  expect(differing(await pixels(page), before)).toBeGreaterThan(0)
  // Choosing another tool with the pen down drops the mark in flight.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  await page.mouse.up()
  expect(differing(await pixels(page), before)).toBe(0)
  expect(await isWet(page)).toBe(true)
  expect(await wetSteps(page)).toBe(1)

  // The wash is the one that was there: it moves, and dries as it would have.
  await advance(page, 40)
  const moved = await pixels(page)
  await dryNow(page)
  expect(differing(await pixels(page), moved)).toBe(0)
})

test("undo with the pen down takes back the stroke in flight and no step under it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin, 30, 130)
  const before = await pixels(page)
  await penDown(page, origin, 150, 210)
  await undo(page)
  await page.mouse.up()
  expect(differing(await pixels(page), before)).toBe(0)
  expect(await wetSteps(page)).toBe(1)
})

test("after a wash settles, one undo removes the whole dried passage and one redo restores it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  const dry = await drySteps(page)
  await threeStrokes(page, origin)
  await dryNow(page)
  const settled = await pixels(page)
  // The three strokes are one step now, and no step of their own.
  expect(await wetSteps(page)).toBe(0)
  expect(await drySteps(page)).toBe(dry + 1)

  await undo(page)
  expect(await pixels(page)).toEqual(empty)
  expect(await drySteps(page)).toBe(dry)
  await redo(page)
  expect(await pixels(page)).toEqual(settled)
  // A passage that has dried stays dry.
  expect(await isWet(page)).toBe(false)
})

test("when one body settles while another is wet, the next undo dries the rest and removes that passage", async ({
  page,
}) => {
  // Five tiles across and no wider: a picture is slow to read back where
  // the GPU is software. A wash wets the tiles about its own (fluid brushes
  // 08), so two that are to stay apart have a dry tile between those.
  const width = 1250
  // The window is as wide as the canvas, for the pen to reach its far end.
  await page.setViewportSize({ width: 1300, height: 720 })
  const origin = await openCanvas(page, { width })
  const at = (image: number[], x: number) => rgba(image, x, ROW, width)
  const empty = await pixels(page)
  await setFluid(page, QUICK)
  const dry = await drySteps(page)
  // One wash, and later one three tiles clear of it.
  await wash(page, origin, 60, 160)
  await advance(page, 100)
  await wash(page, origin, 1090, 1170)
  expect(await wetSteps(page)).toBe(2)

  // The first dries on its own deadline with the second still wet.
  for (let i = 0; i < 200 && (await drySteps(page)) === dry; i++) {
    // Few and long: a step is slow where the GPU is software.
    await advance(page, 20)
    await frames(page)
  }
  expect(await drySteps(page)).toBe(dry + 1)
  expect(await isWet(page)).toBe(true)
  // Its settle took the wet strokes out of history: both, the wet one's too.
  expect(await wetSteps(page)).toBe(0)

  // Undo dries what is left and takes that passage back, whole.
  await undo(page)
  expect(await isWet(page)).toBe(false)
  const first = await pixels(page)
  expect(at(first, 1130)).toEqual(at(empty, 1130))
  expect(distance(at(first, 110), at(empty, 110))).toBeGreaterThan(200)
  expect(await drySteps(page)).toBe(dry + 1)
  // And the next takes back the passage that dried first.
  await undo(page)
  expect(await pixels(page)).toEqual(empty)
})

test("the copies stay inside their byte budget, and undo past the oldest dries the passage", async ({
  page,
}) => {
  // Room for two copies of one wet tile, and not for three.
  const budget = TILE_COPY_BYTES * 2.5
  const origin = await openCanvas(page, { wetBudgetBytes: budget })
  const empty = await pixels(page)
  const dry = await drySteps(page)
  for (let i = 0; i < 8; i++) {
    await wash(page, origin, 30 + i * 20, 60 + i * 20)
    const { wetBytes } = await usage(page)
    expect(wetBytes).toBeLessThanOrEqual(budget)
  }
  // Only the newest strokes are still steps of their own.
  expect((await usage(page)).wetBytes).toBe(TILE_COPY_BYTES * 2)
  expect(await wetSteps(page)).toBe(2)
  const painted = await pixels(page)

  // The newest stroke is still taken back by itself.
  await undo(page)
  const undone = await pixels(page)
  expect(rgba(undone, 204)).toEqual(rgba(empty, 204))
  expect(distance(rgba(undone, 45), rgba(empty, 45))).toBeGreaterThan(200)
  expect(await isWet(page)).toBe(true)
  expect((await usage(page)).wetBytes).toBeLessThanOrEqual(budget)

  // Past the oldest copy there is no wet stroke to go back to: undo dries
  // what is wet and takes it back as one passage.
  while (await wetSteps(page)) await undo(page)
  await undo(page)
  expect(await isWet(page)).toBe(false)
  expect(await pixels(page)).toEqual(empty)
  expect(await drySteps(page)).toBe(dry)
  expect((await usage(page)).wetBytes).toBe(0)
  expect(painted).not.toEqual(empty)
})

test("nothing is read back from the GPU for a wet stroke, kept, undone or redone", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await frames(page)
  await page.evaluate(() => {
    const counts = { readbacks: 0 }
    const map = GPUBuffer.prototype.mapAsync
    GPUBuffer.prototype.mapAsync = function (...args: Parameters<typeof map>) {
      counts.readbacks++
      return map.apply(this, args)
    }
    const copy = GPUCommandEncoder.prototype.copyTextureToBuffer
    GPUCommandEncoder.prototype.copyTextureToBuffer = function (
      ...args: Parameters<typeof copy>
    ) {
      counts.readbacks++
      return copy.apply(this, args)
    }
    Object.assign(window, { wetReadbacks: counts })
  })
  await wash(page, origin, 30, 130)
  await wash(page, origin, 100, 200)
  await advance(page, 10)
  await undo(page)
  await advance(page, 10)
  await redo(page)
  await undo(page)
  await frames(page)
  expect(await wetSteps(page)).toBe(1)
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { wetReadbacks: { readbacks: number } })
          .wetReadbacks.readbacks
    )
  ).toBe(0)
})

test("a step that leaves wet paint alone is undone in its turn, between two wet strokes", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  const layer = await page.evaluate(
    () => window.engine.getSnapshot().activeLayerId!
  )
  await wash(page, origin, 30, 100)
  const first = await pixels(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, opacity: 0.5 }),
    layer
  )
  await wash(page, origin, 140, 210)
  expect(await wetSteps(page)).toBe(2)

  // The second stroke, then the opacity: the first is wet through both.
  await undo(page)
  await undo(page)
  expect(await isWet(page)).toBe(true)
  expect(await wetSteps(page)).toBe(1)
  expect(differing(await pixels(page), first)).toBe(0)
  await undo(page)
  expect(await isWet(page)).toBe(false)
  expect(await pixels(page)).toEqual(empty)
})

test("redo with nothing to put back leaves the wash wet, and its strokes steps", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin, 30, 100)
  await wash(page, origin, 140, 210)
  await redo(page)
  expect(await isWet(page)).toBe(true)
  expect(await wetSteps(page)).toBe(2)
})
