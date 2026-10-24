import { expect, test, type Page } from "@playwright/test"

/**
 * A selection holds fluid paint in (fluid brushes 09), through the engine's
 * command seam and the pixels it presents. The selection clips what a fluid
 * dab lays and stops what flows, so it works as masking fluid: nothing
 * outside it changes, paint pools against its edge, and a soft edge lets
 * through its share. Wet paint is held by the selection it was laid under, so
 * it dries before that selection changes.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 160
/** The row strokes are drawn along. */
const ROW = 80
const BLUE = "#1040e0"
const YELLOW = "#f0d020"
/** Water the paper holds, and no rim: paint stays where the brush put it. */
const ORDINARY = {
  water: 0.5,
  drying: 0.5,
  bleed: 0.5,
  edge: 0,
  granulation: 0,
}
/** As much water as a brush carries, which is more than the paper holds. */
const FLOODED = { ...ORDINARY, water: 1 }
/**
 * The selected box. Its sides are on odd pixels, so each cuts through a cell
 * of the wet fields, which are two pixels to a cell.
 */
const BOX = { x: 71, y: 21, width: 100, height: 118 }
const RIGHT = BOX.x + BOX.width
const BOTTOM = BOX.y + BOX.height
const MIDDLE = BOX.x + BOX.width / 2

type Origin = { x: number; y: number }
type Fluid = typeof ORDINARY
type Box = typeof BOX

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

const dispatch = (
  page: Page,
  command: Parameters<typeof window.engine.dispatch>[0]
) => page.evaluate((command) => window.engine.dispatch(command), command)

/** The canvas as it is presented, a byte a channel. */
async function pixels(page: Page) {
  await frames(page)
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

/** What has been taken out of white paper at a pixel of a picture. */
const paint = (image: number[], x: number, y: number) => {
  const at = (y * WIDTH + x) * 4
  return 765 - image[at] - image[at + 1] - image[at + 2]
}

/** The selection's coverage, one byte per document pixel. */
const coverage = (page: Page) =>
  page.evaluate(async () =>
    Array.from((await window.engine.readSelection())!.data)
  )

const inside = (box: Box, x: number, y: number) =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height

/** The pixels of `image` that differ from `from`'s, as `where` picks them. */
function changed(
  image: number[],
  from: number[],
  where: (x: number, y: number) => boolean
) {
  let count = 0
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++) {
      if (!where(x, y)) continue
      const at = (y * WIDTH + x) * 4
      if (
        image[at] !== from[at] ||
        image[at + 1] !== from[at + 1] ||
        image[at + 2] !== from[at + 2]
      )
        count++
    }
  return count
}

/** The undo steps that are in the layers' own pixels. */
const steps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

const selected = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().selection?.bounds ?? null)

/** The brush: how it is fluid, its size, and the pigment a dab carries. */
const setBrush = (page: Page, fluid: Fluid, radius: number, flow: number) =>
  dispatch(page, { type: "setBrush", fluid, radius, flow })

const select = (page: Page, box: Box = BOX) =>
  dispatch(page, { type: "selectShape", shape: "rect", ...box })

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
  dispatch(page, { type: "advanceFluid", steps })

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

/** Dries everything wet, waited for as the undo step it lands as. */
async function dryNow(page: Page) {
  const before = await steps(page)
  await dispatch(page, { type: "dryNow" })
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
      n,
    before
  )
}

/**
 * Nothing changes as paint dries: the picture read back is the last wet
 * frame, to the rounding of a byte.
 */
function expectDriedAsShown(dried: number[], shown: number[]) {
  for (let at = 0; at < dried.length; at++)
    if (Math.abs(dried[at] - shown[at]) > 1)
      throw new Error(`byte ${at}: ${dried[at]} dried from ${shown[at]}`)
}

/** Paint enough to see, as a pixel shows it. */
const PAINTED = 12

test("a wash laid across a selection's edge changes no pixel outside it, wet or settled", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await pixels(page)
  await select(page)
  await setBrush(page, ORDINARY, 20, 0.3)
  // In over one side of the box and out over the other.
  await wash(page, origin, 30, 210)
  const outside = (x: number, y: number) => !inside(BOX, x, y)

  const wet = await pixels(page)
  expect(await isWet(page)).toBe(true)
  expect(changed(wet, blank, outside)).toBe(0)
  // Up to both sides, to the pixel.
  for (const x of [BOX.x, MIDDLE, RIGHT - 1])
    expect(paint(wet, x, ROW), `column ${x}`).toBeGreaterThan(PAINTED)

  // Still so once the water has moved it about.
  await advance(page, 120)
  const moved = await pixels(page)
  expect(await isWet(page)).toBe(true)
  expect(changed(moved, blank, outside)).toBe(0)

  // And once it is the layer's own pixels, which are what the screen showed.
  await dryNow(page)
  const settled = await pixels(page)
  expect(changed(settled, blank, outside)).toBe(0)
  expectDriedAsShown(settled, moved)
})

test("paint dries darker against the selection's edge than in the open wash", async ({
  page,
}) => {
  test.slow()
  const origin = await openCanvas(page)
  await select(page)
  // A rim that dries first, as a wash's own edge does.
  await setBrush(page, { ...ORDINARY, edge: 1 }, 30, 0.3)
  await wash(page, origin, 30, 210)
  await untilSettled(page)
  const dried = await pixels(page)
  /** The most paint within a rim's width of a column, going into the box. */
  const rim = (from: number, step: number) => {
    let most = 0
    for (let i = 0; i < 12; i++)
      most = Math.max(most, paint(dried, from + i * step, ROW))
    return most
  }
  const open = paint(dried, MIDDLE, ROW)
  expect(open).toBeGreaterThan(PAINTED)
  expect(rim(BOX.x, 1)).toBeGreaterThan(open * 1.15)
  expect(rim(RIGHT - 1, -1)).toBeGreaterThan(open * 1.15)
})

test("a feathered selection lets proportionally less through", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await pixels(page)
  await select(page)
  await dispatch(page, { type: "featherSelection", radius: 8 })
  const cover = await coverage(page)
  const share = (x: number, y: number) => cover[y * WIDTH + x] / 255
  // Thin paint, so what a pixel shows is near enough what lies on it.
  await setBrush(page, ORDINARY, 30, 0.04)
  await wash(page, origin, 30, 210)
  await dryNow(page)
  const dried = await pixels(page)

  expect(changed(dried, blank, (x, y) => share(x, y) === 0)).toBe(0)
  /** Paint down a few rows of a column, so the paper's grain evens out. */
  const column = (x: number) => {
    let sum = 0
    for (let y = ROW - 6; y <= ROW + 6; y++) sum += paint(dried, x, y)
    return sum
  }
  const full = column(MIDDLE)
  expect(share(MIDDLE, ROW)).toBe(1)
  expect(full).toBeGreaterThan(13 * PAINTED)
  let soft = 0
  for (let x = BOX.x - 12; x < BOX.x + 12; x++) {
    const through = share(x, ROW)
    if (through > 0.1 && through < 0.9) soft++
    expect(
      Math.abs(column(x) / full - through),
      `column ${x}, selected ${through.toFixed(2)}`
    ).toBeLessThan(0.15)
  }
  // The edge is soft over several pixels, and each was looked at.
  expect(soft).toBeGreaterThan(4)
})

test("a bloom does not cross the selection's edge", async ({ page }) => {
  test.slow()
  const radius = 20
  // Slow to dry, so the water stands deeper than the paper holds for long
  // enough to carry the damp edge well past where the selection ends.
  const standing = { ...FLOODED, drying: 0 }
  /** The row a stroke's dabs end just short of the box's bottom side from. */
  const row = BOTTOM - radius - 3
  /** A flooded stroke left to bloom and dried, in the selection or with none. */
  const bloomed = async (held: boolean) => {
    const origin = await openCanvas(page)
    const blank = await pixels(page)
    if (held) await select(page)
    await setBrush(page, standing, radius, 0.12)
    await wash(page, origin, 100, 140, row)
    await advance(page, 250)
    await dryNow(page)
    return { blank, dried: await pixels(page) }
  }
  /** Paint in a band of rows, across the stroke. */
  const band = (image: number[], from: number, to: number) => {
    let sum = 0
    for (let y = from; y < to; y++)
      for (let x = 100; x <= 140; x++) sum += paint(image, x, y)
    return sum
  }
  const open = await bloomed(false)
  const held = await bloomed(true)
  // With nothing selected the bloom runs on past where the box would end.
  expect(paint(open.dried, 120, BOTTOM + 3)).toBeGreaterThan(PAINTED)
  // Selected, nothing is past it.
  expect(changed(held.dried, held.blank, (x, y) => !inside(BOX, x, y))).toBe(0)
  // And the pigment the bloom would have carried over is still this side of
  // the edge: were it only hidden past it, these would be the same.
  expect(band(held.dried, BOTTOM - 8, BOTTOM)).toBeGreaterThan(
    band(open.dried, BOTTOM - 8, BOTTOM) * 1.02
  )
})

test("clearing the selection while paint is wet settles the paint first", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await pixels(page)
  await select(page)
  await setBrush(page, ORDINARY, 20, 0.3)
  await wash(page, origin, 30, 210)
  const wet = await pixels(page)
  expect(await isWet(page)).toBe(true)
  const before = await steps(page)

  await dispatch(page, { type: "deselect" })
  // The paint dried as the selection held it, and then the selection went:
  // a step each.
  expect(await isWet(page)).toBe(false)
  expect(await selected(page)).toBeNull()
  expect(await steps(page)).toBe(before + 2)
  const dried = await pixels(page)
  expect(changed(dried, blank, (x, y) => !inside(BOX, x, y))).toBe(0)
  expectDriedAsShown(dried, wet)

  // Undo puts the selection back and leaves the paint, then takes the paint.
  await dispatch(page, { type: "undo" })
  expect(await selected(page)).toEqual(BOX)
  expect(await pixels(page)).toEqual(dried)
  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(blank)
})

const CHANGES: [string, Parameters<typeof window.engine.dispatch>[0]][] = [
  ["inverting", { type: "invertSelection" }],
  ["feathering", { type: "featherSelection", radius: 4 }],
  ["moving", { type: "moveSelection", dx: 20, dy: 0 }],
  ["selecting all", { type: "selectAll" }],
  [
    "a lasso",
    {
      type: "selectLasso",
      points: [
        { x: 10, y: 10 },
        { x: 120, y: 10 },
        { x: 60, y: 150 },
      ],
    },
  ],
]
for (const [name, command] of CHANGES)
  test(`${name} while paint is wet settles the paint first`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const blank = await pixels(page)
    await select(page)
    await setBrush(page, ORDINARY, 20, 0.3)
    await wash(page, origin, 30, 210)
    const wet = await pixels(page)
    const before = await steps(page)

    await dispatch(page, command)
    expect(await isWet(page)).toBe(false)
    expect(await selected(page)).not.toEqual(BOX)
    expect(await steps(page)).toBe(before + 2)
    // As the selection it was laid under held it, not as the new one would.
    const dried = await pixels(page)
    expect(changed(dried, blank, (x, y) => !inside(BOX, x, y))).toBe(0)
    expectDriedAsShown(dried, wet)
  })

test("a click that lets go of the selection settles wet paint under that step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await select(page)
  await setBrush(page, ORDINARY, 20, 0.3)
  await wash(page, origin, 30, 210)
  const wet = await pixels(page)
  const before = await steps(page)

  // No drag, so no outline is previewed before the selection goes.
  await dispatch(page, { type: "setTool", tool: "rectSelect" })
  await page.mouse.move(origin.x + 20, origin.y + 20)
  await page.mouse.down()
  await page.mouse.up()
  await frames(page)
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >=
      n,
    before + 2
  )
  expect(await isWet(page)).toBe(false)
  expect(await selected(page)).toBeNull()
  const dried = await pixels(page)
  expectDriedAsShown(dried, wet)

  // The selection's step is the one on top: undo puts it back, paint left.
  await dispatch(page, { type: "undo" })
  expect(await selected(page)).toEqual(BOX)
  expect(await pixels(page)).toEqual(dried)
})

test("undo and redo go through a selection and the wet stroke laid in it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const blank = await pixels(page)
  await select(page)
  await setBrush(page, ORDINARY, 20, 0.3)
  await wash(page, origin, 30, 210)
  const wet = await pixels(page)

  // The stroke, wet as it is, and then the selection it was laid in.
  await dispatch(page, { type: "undo" })
  expect(await selected(page)).toEqual(BOX)
  expect(await pixels(page)).toEqual(blank)
  await dispatch(page, { type: "undo" })
  expect(await selected(page)).toBeNull()
  expect(await pixels(page)).toEqual(blank)

  // And back: the paint is wet again, and held by the selection again.
  await dispatch(page, { type: "redo" })
  await dispatch(page, { type: "redo" })
  expect(await selected(page)).toEqual(BOX)
  expect(await isWet(page)).toBe(true)
  const again = await pixels(page)
  expect(changed(again, blank, (x, y) => !inside(BOX, x, y))).toBe(0)
  expectDriedAsShown(again, wet)
})

test("selecting while paint is wet settles all of it, where it lies", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await setBrush(page, ORDINARY, 20, 0.3)
  await wash(page, origin, 30, 210)
  const wet = await pixels(page)
  const before = await steps(page)

  // A marquee dragged out over the middle of the wash.
  await dispatch(page, { type: "setTool", tool: "rectSelect" })
  await page.mouse.move(origin.x + BOX.x, origin.y + BOX.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + RIGHT, origin.y + BOTTOM, { steps: 6 })
  // With the outline still being drawn, the wash is whole.
  expect(paint(await pixels(page), 40, ROW)).toBe(paint(wet, 40, ROW))
  await page.mouse.up()
  await frames(page)

  expect(await isWet(page)).toBe(false)
  expect(await selected(page)).toEqual(BOX)
  expect(await steps(page)).toBe(before + 2)
  // None of it was cut off by the selection it was not laid under.
  const dried = await pixels(page)
  expectDriedAsShown(dried, wet)
})

test("paint beside the selection is not dragged in", async ({ page }) => {
  test.slow()
  /** The half of the canvas right of the wash laid first. */
  const HALF = { x: 121, y: 0, width: WIDTH - 121, height: HEIGHT }
  /**
   * A flooded yellow wash in the selected half, from its edge, bloomed and
   * dried; with or without blue laid up to that edge first.
   */
  const painted = async (beside: boolean) => {
    const origin = await openCanvas(page)
    if (beside) {
      // Laid over the edge with the other half selected, so it ends flush
      // against it, and still wet when the selection turns about.
      await select(page, { ...HALF, x: 0, width: HALF.x })
      await setBrush(page, FLOODED, 20, 0.3)
      await wash(page, origin, 40, 140)
      expect(await isWet(page)).toBe(true)
    }
    await select(page, HALF)
    const before = await pixels(page)
    await dispatch(page, { type: "setColor", hex: YELLOW })
    await setBrush(page, { ...FLOODED, drying: 0 }, 20, 0.3)
    await wash(page, origin, 100, 200)
    await advance(page, 250)
    await dryNow(page)
    return { before, dried: await pixels(page) }
  }
  const alone = await painted(false)
  const beside = await painted(true)
  // The blue is there, up against the edge, and is as it was.
  expect(paint(beside.before, HALF.x - 2, ROW)).toBeGreaterThan(PAINTED)
  expect(
    changed(beside.dried, beside.before, (x, y) => !inside(HALF, x, y))
  ).toBe(0)
  // And the yellow is the yellow it is with nothing beside it.
  expect(changed(beside.dried, alone.dried, (x, y) => inside(HALF, x, y))).toBe(
    0
  )
})
