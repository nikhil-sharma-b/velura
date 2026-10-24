import { expect, test, type Page } from "@playwright/test"

/**
 * The wet tile limit (fluid brushes 05), through the engine's command seam
 * and the pixels it presents. There are 64 wet tile slots; a dab that needs
 * one with none free settles the body due to dry first, and the stroke
 * carries on. The document here is nine tiles a side, eighty-one in all, seen
 * whole in a small window, and a picture of it is every eighth pixel each
 * way: the whole of one is too much to hand back from the page.
 *
 * The simulation's clock is stopped here and stepped by command, so nothing
 * dries by itself and no test waits on one.
 */

const TILE = 256
/** Tiles along one side of the document. */
const SIDE = 9
const DOCUMENT = SIDE * TILE
const VIEWPORT = 400
const RADIUS = 40
/** Document pixels between the ones a picture keeps. */
const STRIDE = 8
/** Pixels along one side of a picture. */
const PICTURE = DOCUMENT / STRIDE
const BLUE = "#1040e0"
const FLUID = { water: 0.5, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }

/** Where a point of the document is in the window. */
type ToScreen = (x: number, y: number) => { x: number; y: number }
type Canvas = { origin: { x: number; y: number }; toScreen: ToScreen }

async function openCanvas(page: Page): Promise<Canvas> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  const view = await page.evaluate(
    async ([size, viewport, radius, colour, fluid]) => {
      window.remountEngine({
        manualFluidClock: true,
        documentSize: { width: size, height: size },
      })
      await window.engine.dispatch({
        type: "resize",
        width: viewport,
        height: viewport,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      await window.engine.dispatch({ type: "fitView" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({
        type: "setBrush",
        radius,
        spacing: 0.125,
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
      return window.engine.getSnapshot().view
    },
    [DOCUMENT, VIEWPORT, RADIUS, BLUE, FLUID] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return {
    origin: { x: box.x, y: box.y },
    toScreen: (x, y) => ({
      x: VIEWPORT / 2 + view.panX + (x - DOCUMENT / 2) * view.zoom,
      y: VIEWPORT / 2 + view.panY + (y - DOCUMENT / 2) * view.zoom,
    }),
  }
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
  return page.evaluate(async (stride) => {
    const { width, height, data } = await window.engine.readPixels()
    const picture: number[] = []
    for (let y = 0; y < height; y += stride)
      for (let x = 0; x < width; x += stride) {
        const offset = (y * width + x) * 4
        picture.push(
          data[offset],
          data[offset + 1],
          data[offset + 2],
          data[offset + 3]
        )
      }
    return picture
  }, STRIDE)
}

/** The pixel a picture keeps nearest a point of the document. */
const at = (image: number[], x: number, y: number) => {
  const offset = (Math.floor(y / STRIDE) * PICTURE + Math.floor(x / STRIDE)) * 4
  return image.slice(offset, offset + 4)
}

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

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

/** Runs the simulation on by so many steps. */
const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

/** The middle of a row of tiles, down the document. */
const rowY = (row: number) => row * TILE + TILE / 2
/** The ends of a stroke that crosses every tile of a row. */
const LEFT = 100
const RIGHT = DOCUMENT - 100

/** Moves the pen to a point of the document. */
function move(page: Page, canvas: Canvas, x: number, y: number, steps = 1) {
  const point = canvas.toScreen(x, y)
  return page.mouse.move(canvas.origin.x + point.x, canvas.origin.y + point.y, {
    steps,
  })
}

/**
 * One stroke back and forth along rows of tiles, `first` to `last`, without
 * the pen lifting: it reaches every tile of each.
 */
async function serpentine(
  page: Page,
  canvas: Canvas,
  first: number,
  last: number
) {
  await move(page, canvas, LEFT, rowY(first))
  await page.mouse.down()
  for (let row = first; row <= last; row++) {
    const forward = (row - first) % 2 === 0
    await move(page, canvas, forward ? LEFT : RIGHT, rowY(row), 4)
    await move(page, canvas, forward ? RIGHT : LEFT, rowY(row), 24)
  }
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

test("a stroke that reaches more tiles than there are slots lays paint along its whole length", async ({
  page,
}) => {
  test.slow()
  const canvas = await openCanvas(page)
  const empty = await pixels(page)
  const dry = await drySteps(page)

  // Eighty-one tiles in one stroke: seventeen past the limit.
  await serpentine(page, canvas, 0, SIDE - 1)
  const painted = await pixels(page)
  for (let row = 0; row < SIDE; row++)
    for (let column = 0; column < SIDE; column++) {
      const x = Math.min(Math.max(column * TILE + TILE / 2, LEFT), RIGHT)
      expect(
        distance(at(painted, x, rowY(row)), at(empty, x, rowY(row))),
        `tile ${column}, ${row}`
      ).toBeGreaterThan(100)
    }

  // The wash it was painting into dried once to make room, as one step, and
  // what was laid after is still wet.
  await expect.poll(() => drySteps(page)).toBe(dry + 1)
  expect(await isWet(page)).toBe(true)

  // Drying the rest changes nothing on screen: there is no seam of lost
  // paint where the early settle ended.
  await dryNow(page)
  expect(differing(await pixels(page), painted)).toBe(0)
})

test("the paint settled early is what was on screen, and the wash being painted stays wet", async ({
  page,
}) => {
  // Paints into most of the wet tiles on CI's two-core software GPU, where
  // the same commit has taken from about one to three minutes by runner.
  test.setTimeout(300_000)
  const canvas = await openCanvas(page)
  const dry = await drySteps(page)

  // A small wash of two tiles, left to move a little.
  await move(page, canvas, LEFT, rowY(0))
  await page.mouse.down()
  await move(page, canvas, 400, rowY(0), 10)
  await page.mouse.up()
  await frames(page)
  await advance(page, 20)
  const before = await pixels(page)
  expect(await wetSteps(page)).toBe(1)

  // A second, a row of tiles clear of it, of sixty-three: one slot short.
  await serpentine(page, canvas, 2, SIDE - 1)

  // The small one made room, and only it: one settle, with the wash being
  // painted still wet and its stroke a step.
  await expect.poll(() => drySteps(page)).toBe(dry + 1)
  expect(await isWet(page)).toBe(true)
  expect(await wetSteps(page)).toBe(1)

  // What settled is what was showing, and it moves no more.
  const after = await pixels(page)
  // The first row of tiles, which is all the small wash reached.
  const band = (image: number[]) =>
    image.slice(0, (TILE / STRIDE) * PICTURE * 4)
  expect(differing(band(after), band(before))).toBe(0)
  await advance(page, 20)
  expect(differing(band(await pixels(page)), band(before))).toBe(0)
})

test("paused, the held body painted into longest ago makes room, and not the one due first", async ({
  page,
}) => {
  // Paints into most of the wet tiles on CI's two-core software GPU, where
  // the same commit has taken from about one to three minutes by runner.
  test.setTimeout(300_000)
  const canvas = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setDryingPaused", paused: true })
  )
  const brush = (drying: number) =>
    page.evaluate(
      (fluid) => window.engine.dispatch({ type: "setBrush", fluid }),
      { ...FLUID, drying }
    )
  /** A wash through document points, in one stroke. */
  const wash = async (...points: [number, number][]) => {
    await move(page, canvas, ...points[0])
    await page.mouse.down()
    for (const point of points.slice(1)) await move(page, canvas, ...point, 10)
    await page.mouse.up()
    await frames(page)
  }
  const wetAt = (x: number) =>
    page.evaluate(
      ({ x, y }) => window.engine.wetUnder(x, y),
      canvas.toScreen(x, rowY(0))
    )
  // Eight tiles a slow brush paints first, two rows of four, and four in the
  // first row, a tile clear of them, a quick brush paints after: due long
  // before the first.
  // About three hundred steps to its deadline, against some 170 for the
  // quick brush: both held soon, and few steps for a slow GPU to run.
  await brush(0.8)
  await wash([LEFT, rowY(0)], [900, rowY(0)], [900, rowY(1)], [LEFT, rowY(1)])
  await brush(1)
  await wash([1380, rowY(0)], [RIGHT, rowY(0)])
  // Both held.
  await advance(page, 320)
  expect(await isWet(page)).toBe(true)
  const dry = await drySteps(page)

  // Six rows of tiles, two more than the slots left: one body makes room.
  await serpentine(page, canvas, 3, SIDE - 1)

  await expect.poll(() => drySteps(page)).toBe(dry + 1)
  expect(await wetAt(500)).toBe(false)
  expect(await wetAt(1800)).toBe(true)
})

test("a run at 64 slots settles another body and takes only its downhill tile", async ({
  page,
}) => {
  // Paints into most of the wet tiles on CI's two-core software GPU, where
  // the same commit has taken from about one to three minutes by runner.
  test.setTimeout(300_000)
  const canvas = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setDryingPaused", paused: true })
    await window.engine.dispatch({
      type: "setBoard",
      steepness: 1,
      direction: 0,
    })
  })
  // Sixty-three tiles in another body, separated from the source by row 1.
  await serpentine(page, canvas, 2, 8)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "setBrush",
      radius: 18,
      flow: 1,
      // All slots are occupied after this dab takes the last one, so even
      // a flooded brush cannot take its usual ring. The run must make room.
      fluid: { water: 1, drying: 0.5, bleed: 0.5, edge: 0, granulation: 0 },
    })
  )
  await move(page, canvas, 128, 234)
  await page.mouse.down()
  await page.mouse.up()
  await frames(page)
  const wetAt = (x: number, y: number) =>
    page.evaluate(
      ({ x, y }) => window.engine.wetUnder(x, y),
      canvas.toScreen(x, y)
    )
  expect(await wetAt(128, 270)).toBe(false)
  const dry = await drySteps(page)
  // This test observes acquisition, not hundreds of subsequent run steps.
  // Stop at the claim so CI's software GPU need not step 64 tiles afterward.
  let steps = 0
  while (steps < 100 && !(await wetAt(128, 270))) {
    await advance(page, 5)
    steps += 5
  }
  await test.info().attach("steps-to-claim", {
    body: String(steps),
    contentType: "text/plain",
  })
  expect(await wetAt(128, 234)).toBe(true)
  expect(await wetAt(128, 270)).toBe(true)
  expect(await wetAt(384, 270)).toBe(false)
  expect(await wetAt(128, rowY(2))).toBe(false)
  await expect.poll(() => drySteps(page)).toBe(dry + 1)
})
