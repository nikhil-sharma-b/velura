import { expect, test, type Page } from "@playwright/test"

/**
 * Blotting wet paint (fluid brushes 17), through the engine's command seam
 * and the pixels it presents. A blot brush lays nothing: it takes water and
 * suspended pigment out of the wet surface, and never reaches a tile that is
 * dry or one it would have to take a slot for.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row strokes are drawn along. */
const ROW = 60
const BLUE = "#1040e0"
const FLUID = { water: 0.5, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }
/** A brush whose paint is dry within two hundred steps. */
const QUICK = { ...FLUID, drying: 1 }
const TISSUE = { water: 1, pigment: 0.8 }
/** Where the blot is drawn, and a point of the wash it never reaches. */
const BLOTTED = { from: 50, to: 90, at: 70 }
const UNBLOTTED = 170

type Origin = { x: number; y: number }
type Fluid = typeof FLUID
type Blot = typeof TISSUE

async function openCanvas(
  page: Page,
  options: { width?: number; height?: number; fit?: boolean } = {}
): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, fluid, fit]) => {
      window.remountEngine({
        manualFluidClock: true,
        ...(fit ? { documentSize: { width, height } } : {}),
      })
      await window.engine.dispatch({
        type: "resize",
        width: fit ? 400 : width,
        height: fit ? 400 : height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      if (fit) await window.engine.dispatch({ type: "fitView" })
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
      options.fit ?? false,
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

const wetSteps = async (page: Page) => (await usage(page)).wetSteps

const drySteps = async (page: Page) => {
  const { steps, wetSteps } = await usage(page)
  return steps - wetSteps
}

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

const dispatch = (page: Page, command: Record<string, unknown>) =>
  page.evaluate(
    (command) =>
      window.engine.dispatch(
        command as Parameters<typeof window.engine.dispatch>[0]
      ),
    command
  )

const advance = (page: Page, steps: number) =>
  dispatch(page, { type: "advanceFluid", steps })

const setFluid = (page: Page, fluid: Fluid = FLUID) =>
  dispatch(page, { type: "setBrush", blot: null, fluid })

const setBlot = (page: Page, blot: Blot = TISSUE) =>
  dispatch(page, { type: "setBrush", fluid: null, blot })

async function penDown(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW,
  steps = 30
) {
  await page.mouse.move(origin.x + from, origin.y + row)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + row, { steps })
}

/** A drag, waited for as the step it lands as. */
async function drag(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW,
  steps = 30
) {
  await penDown(page, origin, from, to, row, steps)
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/** A wash along the row, with the fluid brush. */
const wash = (page: Page, origin: Origin, fluid: Fluid = FLUID) =>
  setFluid(page, fluid).then(() => drag(page, origin, 30, 210))

/** A blot over part of the wash. */
const blot = (page: Page, origin: Origin, with_: Blot = TISSUE) =>
  setBlot(page, with_).then(() => drag(page, origin, BLOTTED.from, BLOTTED.to))

test("a blot lightens a wet wash where it lands, and nowhere else", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  await wash(page, origin)
  const before = await pixels(page)
  await blot(page, origin)
  const after = await pixels(page)
  expect(await isWet(page)).toBe(true)
  // Lighter where it was blotted: nearer the empty layer than it was.
  const blotted = (image: number[]) =>
    distance(rgba(image, BLOTTED.at), rgba(empty, BLOTTED.at))
  expect(blotted(after)).toBeLessThan(blotted(before) * 0.6)
  // The wash a blot never reached has not changed.
  expect(rgba(after, UNBLOTTED)).toEqual(rgba(before, UNBLOTTED))

  // And it dries lighter there than where it was left alone.
  await dispatch(page, { type: "dryNow" })
  const dried = await pixels(page)
  expect(blotted(dried)).toBeLessThan(
    distance(rgba(dried, UNBLOTTED), rgba(empty, UNBLOTTED)) * 0.6
  )
})

test("a blot that takes water and no pigment keeps the colour where it lands", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin)
  const before = await pixels(page)
  await blot(page, origin, { water: 1, pigment: 0 })
  expect(
    distance(rgba(await pixels(page), BLOTTED.at), rgba(before, BLOTTED.at))
  ).toBeLessThanOrEqual(12)
})

test("where a blot has taken the water, two colours stop bleeding into each other", async ({
  page,
}) => {
  /** How far the colour where yellow meets blue moves as the wash runs on. */
  const bleeding = async (blotted: boolean) => {
    const origin = await openCanvas(page)
    await setFluid(page, { ...FLUID, bleed: 1 })
    await dispatch(page, { type: "setColor", hex: "#f0c020" })
    await drag(page, origin, 30, 120)
    await dispatch(page, { type: "setColor", hex: BLUE })
    await drag(page, origin, 120, 210)
    if (blotted) {
      await setBlot(page, { water: 1, pigment: 0 })
      await drag(page, origin, 105, 135)
    }
    const before = await pixels(page)
    await advance(page, 200)
    const after = await pixels(page)
    let moved = 0
    for (let x = 108; x <= 132; x += 2)
      moved += distance(rgba(after, x), rgba(before, x))
    return moved
  }
  const unblotted = await bleeding(false)
  expect(unblotted).toBeGreaterThan(100)
  expect(await bleeding(true)).toBeLessThan(unblotted * 0.2)
})

test("a blot over dry paper changes nothing, wets nothing and is no step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await setBlot(page)
  const before = await pixels(page)
  const steps = (await usage(page)).steps
  await drag(page, origin, 30, 210)
  expect(await pixels(page)).toEqual(before)
  expect(await isWet(page)).toBe(false)
  expect((await usage(page)).steps).toBe(steps)
})

test("a blot over paint that has dried changes nothing and is no step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin)
  await dispatch(page, { type: "dryNow" })
  await page.waitForFunction(() => !window.engine.getSnapshot().wet)
  const before = await pixels(page)
  const steps = (await usage(page)).steps
  await blot(page, origin)
  expect(differing(await pixels(page), before)).toBe(0)
  expect(await isWet(page)).toBe(false)
  expect((await usage(page)).steps).toBe(steps)
})

test("a blot on a layer mask changes nothing", async ({ page }) => {
  const origin = await openCanvas(page)
  await wash(page, origin)
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
  })
  const before = await pixels(page)
  const steps = (await usage(page)).steps
  await blot(page, origin)
  expect(differing(await pixels(page), before)).toBe(0)
  expect((await usage(page)).steps).toBe(steps)
})

test("a blot leaves the wash's drying as it was: blotted or not, it settles on the same step", async ({
  page,
}) => {
  /** Steps until nothing is wet, ten at a time. */
  const dryingSteps = async (blotted: boolean) => {
    const origin = await openCanvas(page)
    await wash(page, origin, QUICK)
    if (blotted) await blot(page, origin, { water: 0.3, pigment: 0.3 })
    let steps = 0
    while (await isWet(page)) {
      await advance(page, 10)
      steps += 10
      if (steps > 2000) throw new Error("The wash never dried.")
    }
    return steps
  }
  expect(await dryingSteps(true)).toBe(await dryingSteps(false))
})

test("undo takes a blot back, redo puts it back, and a cancelled one leaves the wash", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin)
  const before = await pixels(page)
  await blot(page, origin)
  const after = await pixels(page)
  expect(await wetSteps(page)).toBe(2)

  await dispatch(page, { type: "undo" })
  expect(differing(await pixels(page), before)).toBe(0)
  expect(await isWet(page)).toBe(true)
  await dispatch(page, { type: "redo" })
  expect(differing(await pixels(page), after)).toBe(0)
  await dispatch(page, { type: "undo" })

  // A blot the pen is still drawing is dropped with the tool changed.
  await penDown(page, origin, BLOTTED.from, BLOTTED.to)
  await frames(page)
  expect(differing(await pixels(page), before)).toBeGreaterThan(0)
  await dispatch(page, { type: "setTool", tool: "eraser" })
  await page.mouse.up()
  expect(differing(await pixels(page), before)).toBe(0)
  expect(await wetSteps(page)).toBe(1)
})

test("a blot inside a selection lightens what it covers", async ({ page }) => {
  const origin = await openCanvas(page)
  await dispatch(page, {
    type: "selectShape",
    shape: "rect",
    x: 20,
    y: 20,
    width: 200,
    height: 80,
  })
  const empty = await pixels(page)
  await wash(page, origin)
  const before = await pixels(page)
  await blot(page, origin)
  const after = await pixels(page)
  const blotted = (image: number[]) =>
    distance(rgba(image, BLOTTED.at), rgba(empty, BLOTTED.at))
  expect(blotted(after)).toBeLessThan(blotted(before) * 0.6)
  expect(await isWet(page)).toBe(true)
})

test("with every wet tile slot taken, a blot settles nothing to make room", async ({
  page,
}) => {
  // Software rasterising on CI makes a document this size slow to paint.
  test.slow()
  // Twelve tiles across. A wash along every other row of tiles is a body of
  // its own, since a row of dry tiles parts it from the next, and six of
  // them are 72 tiles: the last settles the first to make room, and leaves
  // every slot but four taken.
  const columns = 12
  const rows = 11
  const width = columns * 256
  const height = rows * 256
  const origin = await openCanvas(page, { width, height, fit: true })
  await setFluid(page)
  await dispatch(page, { type: "setBrush", radius: 100 })
  const view = await page.evaluate(() => window.engine.getSnapshot().view)
  /** Where the middle of a row of tiles is on the screen. */
  const row = (tiles: number) =>
    200 + view.panY + (256 * (tiles + 0.5) - height / 2) * view.zoom
  const across = (x: number) => 200 + view.panX + (x - width / 2) * view.zoom
  const pass = (tiles: number) =>
    drag(page, origin, across(8), across(width - 8), row(tiles), 12)
  for (let tiles = 0; tiles < rows; tiles += 2) await pass(tiles)
  // A settle is recorded once its tiles are read back, a while after it.
  const recorded = () => page.waitForTimeout(1000)
  await recorded()
  expect(await isWet(page)).toBe(true)
  const settled = await drySteps(page)
  // Over the row that settled, where paint would need a slot it has not
  // got, and the wet row beside it.
  await setBlot(page)
  await pass(0)
  await pass(2)
  await recorded()
  expect(await drySteps(page)).toBe(settled)
  expect(await isWet(page)).toBe(true)
})

test("the engine says where paint is wet under the pen, at tile granularity", async ({
  page,
}) => {
  const origin = await openCanvas(page, { width: 1024, height: 120 })
  const wetUnder = (x: number, y = ROW) =>
    page.evaluate(([x, y]) => window.engine.wetUnder(x, y), [x, y] as const)
  expect(await wetUnder(100)).toBe(false)
  await setFluid(page)
  await drag(page, origin, 30, 210)
  expect(await wetUnder(100)).toBe(true)
  // A tile no dab reached is dry, however near the wash.
  expect(await wetUnder(900)).toBe(false)
  await dispatch(page, { type: "dryNow" })
  await page.waitForFunction(() => !window.engine.getSnapshot().wet)
  expect(await wetUnder(100)).toBe(false)
})
