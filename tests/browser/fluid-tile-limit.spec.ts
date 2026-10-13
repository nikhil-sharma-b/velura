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
  test.slow()
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
