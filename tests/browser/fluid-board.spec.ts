import { expect, test, type Page } from "@playwright/test"

import type { Board } from "../../engine/doc/board"

/**
 * The board (fluid brushes 38), through the engine's command seam and the
 * pixels it presents: the document's paper lies on a board, and tilted, wet
 * paint drifts downhill on it. Below what the paper holds a wash only
 * slopes, gathering its pigment and its rim on the downhill side, within the
 * paper it has wet. Flat, nothing changes.
 *
 * The simulation's clock is stopped here and stepped by command, as in the
 * fluid brush's own spec.
 */

const WIDTH = 240
const HEIGHT = 160
const ROW = 60
const BLUE = "#1040e0"
/**
 * Water to a depth below what the paper holds, so the wash slopes and does
 * not bloom; and a rim, which a slope moves downhill.
 */
const FLUID = { water: 0.4, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }
/** One that dries within a few hundred steps, for holding while paused. */
const QUICK = { ...FLUID, drying: 1 }
const WASH = { from: 50, to: 190, radius: 24, flow: 0.1 }
const STEEP: Board = { steepness: 1, direction: 0 }

type Origin = { x: number; y: number }
type Command = Parameters<typeof window.engine.dispatch>[0]

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

const dispatch = (page: Page, command: Command) =>
  page.evaluate((command) => window.engine.dispatch(command), command)

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

/** The paint over a box of a picture, summed. */
function paintIn(
  image: number[],
  box: { left: number; top: number; right: number; bottom: number }
) {
  let sum = 0
  for (let y = box.top; y < box.bottom; y++)
    for (let x = box.left; x < box.right; x++) sum += darkness(image, x, y)
  return sum
}

/** The wash's middle, a radius in from each end, where it is laid evenly. */
const ALONG = { left: WASH.from + WASH.radius, right: WASH.to - WASH.radius }
const ABOVE = { ...ALONG, top: ROW - WASH.radius - 4, bottom: ROW }
const BELOW = { ...ALONG, top: ROW, bottom: ROW + WASH.radius + 4 }
/** The wash's two ends, each a radius long, across its whole height. */
const ACROSS = { top: ROW - WASH.radius - 4, bottom: ROW + WASH.radius + 4 }
const LEFT_END = { ...ACROSS, left: WASH.from - WASH.radius, right: ALONG.left }
const RIGHT_END = { ...ACROSS, left: ALONG.right, right: WASH.to + WASH.radius }

const drySteps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

const advance = (page: Page, steps: number) =>
  dispatch(page, { type: "advanceFluid", steps })

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

const boardNow = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().board)

const tilt = (page: Page, board: Board) =>
  dispatch(page, { type: "setBoard", ...board })

/** Runs the simulation on until paint has settled by itself. */
async function untilSettled(page: Page) {
  const before = await drySteps(page)
  for (let i = 0; i < 200 && (await drySteps(page)) === before; i++) {
    await advance(page, 20)
    // History reads the settled tiles back after the frame.
    await frames(page)
  }
  expect(await drySteps(page)).toBeGreaterThan(before)
}

/** A wash with a fluid brush along a row: its paint is wet. */
async function wash(page: Page, origin: Origin, fluid = FLUID) {
  await dispatch(page, {
    type: "setBrush",
    fluid,
    radius: WASH.radius,
    flow: WASH.flow,
  })
  await page.mouse.move(origin.x + WASH.from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + WASH.to, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/** A wash laid on a board and left to dry by itself. */
async function dried(page: Page, board: Board) {
  const origin = await openCanvas(page)
  await tilt(page, board)
  await wash(page, origin)
  await untilSettled(page)
  return pixels(page)
}

test("a document's board is tilted as a step that undoes", async ({ page }) => {
  await openCanvas(page)
  expect(await boardNow(page)).toEqual({ steepness: 0, direction: 0 })
  const before = await drySteps(page)
  await tilt(page, { steepness: 0.5, direction: 90 })
  expect(await boardNow(page)).toEqual({ steepness: 0.5, direction: 90 })
  expect(await drySteps(page)).toBe(before + 1)
  // Tilting it as it is is not a step.
  await tilt(page, { steepness: 0.5, direction: 90 })
  expect(await drySteps(page)).toBe(before + 1)
  await dispatch(page, { type: "undo" })
  expect(await boardNow(page)).toEqual({ steepness: 0, direction: 0 })
  await dispatch(page, { type: "redo" })
  expect(await boardNow(page)).toEqual({ steepness: 0.5, direction: 90 })
})

test("a board out of range is refused", async ({ page }) => {
  await openCanvas(page)
  for (const board of [
    { steepness: 1.5, direction: 0 },
    { steepness: -0.5, direction: 0 },
    { steepness: 0.5, direction: Number.NaN },
  ])
    await expect(tilt(page, board)).rejects.toThrow(/steepness/)
  expect(await boardNow(page)).toEqual({ steepness: 0, direction: 0 })
})

test("a board tilted and laid flat again paints as one never tilted", async ({
  page,
}) => {
  const wet = async (tilted: boolean) => {
    const origin = await openCanvas(page)
    if (tilted) {
      await tilt(page, STEEP)
      await tilt(page, { steepness: 0, direction: 0 })
    }
    await wash(page, origin)
    await advance(page, 150)
    return pixels(page)
  }
  expect(await wet(true)).toEqual(await wet(false))
})

test("on a tilted board a wash gathers its pigment and its rim downhill, within the paper it wet", async ({
  page,
}) => {
  test.slow()
  const flat = await dried(page, { steepness: 0, direction: 0 })
  const tilted = await dried(page, STEEP)
  const downhill = (image: number[]) =>
    paintIn(image, BELOW) / paintIn(image, ABOVE)
  // Flat, a wash is as dark either side of its stroke.
  expect(downhill(flat)).toBeGreaterThan(0.85)
  expect(downhill(flat)).toBeLessThan(1.15)
  expect(downhill(tilted)).toBeGreaterThan(downhill(flat) * 1.3)
  // None of it ran past where the brush wet the paper.
  const past = { ...ALONG, top: ROW + WASH.radius + 6, bottom: HEIGHT }
  expect(paintIn(tilted, past)).toBe(0)
  expect(paintIn(flat, past)).toBe(0)
})

test("the board's direction is on the paper: turned to the left, a wash gathers at its left end", async ({
  page,
}) => {
  test.slow()
  const leftOverRight = (image: number[]) =>
    paintIn(image, LEFT_END) / paintIn(image, RIGHT_END)
  const flat = leftOverRight(await dried(page, { steepness: 0, direction: 0 }))
  const left = leftOverRight(await dried(page, { steepness: 1, direction: 90 }))
  const right = leftOverRight(
    await dried(page, { steepness: 1, direction: 270 })
  )
  expect(left).toBeGreaterThan(flat * 1.2)
  expect(right).toBeLessThan(flat / 1.2)
})

test("turning the view does not change which way paint runs", async ({
  page,
}) => {
  const run = async (turned: boolean) => {
    const origin = await openCanvas(page)
    await tilt(page, STEEP)
    await wash(page, origin)
    if (turned)
      await dispatch(page, { type: "rotateView", radians: Math.PI / 2 })
    await advance(page, 200)
    if (turned)
      await dispatch(page, { type: "rotateView", radians: 0, absolute: true })
    return pixels(page)
  }
  expect(await run(true)).toEqual(await run(false))
})

test("on a tilted board a wash makes and loses no water", async ({ page }) => {
  const origin = await openCanvas(page)
  // Paused, nothing evaporates.
  await dispatch(page, { type: "setDryingPaused", paused: true })
  await tilt(page, STEEP)
  await wash(page, origin)
  const water = () => page.evaluate(() => window.engine.readWetWater())
  const before = await water()
  expect(before).toBeGreaterThan(0)
  await advance(page, 200)
  const after = await water()
  // The fields are half floats, so each step rounds a little.
  expect(Math.abs(after - before) / before).toBeLessThan(0.005)
})

test("tilting the board with wet paint dries nothing, and undo puts the board back, not the paint", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await wash(page, origin)
  await advance(page, 50)
  const before = await drySteps(page)
  await tilt(page, STEEP)
  expect(await isWet(page)).toBe(true)
  expect(await drySteps(page)).toBe(before + 1)
  const still = await pixels(page)
  await advance(page, 100)
  const moved = await pixels(page)
  expect(moved).not.toEqual(still)
  await dispatch(page, { type: "undo" })
  expect(await boardNow(page)).toEqual({ steepness: 0, direction: 0 })
  expect(await isWet(page)).toBe(true)
  expect(await pixels(page)).toEqual(moved)
})

test("paused, a held wash on a tilted board does not move", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await dispatch(page, { type: "setDryingPaused", paused: true })
  await wash(page, origin, QUICK)
  // Past its deadline: held.
  await advance(page, 400)
  expect(await isWet(page)).toBe(true)
  const held = await pixels(page)
  await tilt(page, STEEP)
  await advance(page, 101)
  expect(await pixels(page)).toEqual(held)
})

test("running paint pools against a selection's edge and does not cross it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  // The selection's bottom edge runs through the middle of the wash.
  const edge = ROW + 6
  await dispatch(page, {
    type: "selectShape",
    shape: "rect",
    x: 20,
    y: 10,
    width: 200,
    height: edge - 10,
  })
  await tilt(page, STEEP)
  await wash(page, origin)
  await advance(page, 300)
  const image = await pixels(page)
  expect(
    paintIn(image, { left: 0, right: WIDTH, top: edge, bottom: HEIGHT })
  ).toBe(0)
  // And it gathered there: the rows just above the edge are the darkest.
  const row = (y: number) => paintIn(image, { ...ALONG, top: y, bottom: y + 1 })
  expect(row(edge - 2)).toBeGreaterThan(row(ROW - 12))
})

test("a fluid brush on a layer mask stays a dry brush on a tilted board", async ({
  page,
}) => {
  const masked = async (board: Board) => {
    const origin = await openCanvas(page)
    await tilt(page, board)
    const layer = await page.evaluate(
      () => window.engine.getSnapshot().activeLayerId
    )
    for (const type of ["addMask", "selectMask"] as const)
      await dispatch(page, { type, id: layer } as Command)
    await wash(page, origin)
    expect(await isWet(page)).toBe(false)
    await advance(page, 100)
    return pixels(page)
  }
  expect(await masked(STEEP)).toEqual(
    await masked({ steepness: 0, direction: 0 })
  )
})

test("the same strokes on the same board end in the same pixels", async ({
  page,
}) => {
  const run = async () => {
    const origin = await openCanvas(page)
    await tilt(page, { steepness: 0.7, direction: 40 })
    await wash(page, origin)
    await advance(page, 250)
    return pixels(page)
  }
  expect(await run()).toEqual(await run())
})

test("the board is saved with the document and comes back with it", async ({
  page,
}) => {
  const documentId = `doc-${Math.random().toString(36).slice(2)}`
  const open = () =>
    page.evaluate(async (id) => {
      window.remountEngine({ persistence: { documentId: id } })
      await window.engine.dispatch({
        type: "resize",
        width: 120,
        height: 80,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
    }, documentId)
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await open()
  await tilt(page, { steepness: 0.4, direction: 135 })
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await open()
  await expect
    .poll(() => boardNow(page))
    .toEqual({ steepness: 0.4, direction: 135 })
})
