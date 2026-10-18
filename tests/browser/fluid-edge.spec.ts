import { expect, test, type Page } from "@playwright/test"

/**
 * The edge of fluid paint (fluid brushes 30), through the engine's command
 * seam and the pixels it presents. The wet surface is simulated at half the
 * document's resolution (D42), but a straight stroke's edge must not follow
 * that grid: it is as straight and as anti-aliased as a dry brush's, wet or
 * dried. A bloom's front is anti-aliased too, but keeps the cells' edge
 * (fluid brushes 44, decided against), and must get no more jagged.
 *
 * Each test draws a shallow diagonal, at which a two pixel step would come
 * round every few columns, lets it dry by itself, and fits a line to its
 * upper edge where it shows half the paint's darkness.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const SIZE = 256
const BLUE = "#1040e0"
/** Water the paper holds, with a rim: a wash's edge stays where it is laid. */
const RIMMED = {
  water: 0.5,
  drying: 0.5,
  bleed: 0.5,
  edge: 0.5,
  granulation: 0,
}
/** More water than the paper holds, so the edge is a bloom's front. */
const FLOODED = { ...RIMMED, water: 1, edge: 0 }
/** A dry brush's edge, measured the same way, is within these. */
const STRAIGHT = { rms: 0.25, max: 0.5 }
/**
 * A bloom's front keeps the cells' edge, stepped every two pixels: measured
 * at 0.48 px RMS and 1.13 px at worst (fluid brushes 44). Within these, so a
 * front that grows more jagged fails.
 */
const CELL_EDGE = { rms: 0.6, max: 1.5 }

type Fluid = typeof RIMMED

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

const settledSteps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

type Mark = {
  radius: number
  fluid: Fluid | null
  /** Where the pen goes down and where it lifts; one point is a tap. */
  path: [number, number][]
  /** The brush's flow, which sets how much pigment a dab carries. */
  flow?: number
  /** The brush's feather, in document pixels. */
  feather?: number
  /** A tap of a blot brush, of this radius, at this point, while it is wet. */
  blot?: { at: [number, number]; radius: number }
}

/** A diagonal, at a slope where a two pixel step comes round every seven columns. */
const DIAGONAL: [number, number][] = [
  [20, 170],
  [236, 105],
]

/** A mark left to dry by itself, and the canvas it leaves. */
async function dried(
  page: Page,
  { radius, fluid, path, flow = 1, feather = 1, blot }: Mark
) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([size, radius, colour, fluid, flow, feather]) => {
      window.remountEngine({ manualFluidClock: true })
      await window.engine.dispatch({
        type: "resize",
        width: size,
        height: size,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({
        type: "setBrush",
        radius,
        spacing: 0.125,
        flow,
        feather,
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [SIZE, radius, BLUE, fluid, flow, feather] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  const [[x0, y0], ...rest] = path
  await page.mouse.move(box.x + x0, box.y + y0)
  await page.mouse.down()
  for (const [x, y] of rest)
    await page.mouse.move(box.x + x, box.y + y, { steps: 60 })
  await page.mouse.up()
  await frames(page)
  if (blot) {
    await page.evaluate(
      (radius) =>
        window.engine.dispatch({
          type: "setBrush",
          radius,
          fluid: null,
          blot: { water: 1, pigment: 0.8 },
        }),
      blot.radius
    )
    await page.mouse.move(box.x + blot.at[0], box.y + blot.at[1])
    await page.mouse.down()
    await page.mouse.up()
    await frames(page)
  }
  if (fluid) {
    const before = await settledSteps(page)
    for (let i = 0; i < 60 && (await settledSteps(page)) === before; i++) {
      await page.evaluate(() =>
        window.engine.dispatch({ type: "advanceFluid", steps: 100 })
      )
      await frames(page)
    }
    expect(await settledSteps(page)).toBeGreaterThan(before)
  }
  await frames(page)
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

/**
 * The stroke's upper edge across the middle of the canvas: where each column
 * first shows half its darkest pixel's darkness, between pixels, and how far
 * those points stray from the straight line that fits them best. Also
 * whether every column passes through a pixel between bare paper and paint.
 */
function upperEdge(image: number[]) {
  const darkness = (x: number, y: number) => {
    const i = (y * SIZE + x) * 4
    return 765 - image[i] - image[i + 1] - image[i + 2]
  }
  const points: [number, number][] = []
  let unramped = 0
  for (let x = 70; x < 190; x++) {
    let peak = 0
    for (let y = 32; y < SIZE; y++) peak = Math.max(peak, darkness(x, y))
    for (let y = 33; y < SIZE; y++) {
      const a = darkness(x, y - 1)
      const b = darkness(x, y)
      if (a < peak / 2 && b >= peak / 2) {
        points.push([x, y - 1 + (peak / 2 - a) / (b - a)])
        // A pixel a tenth or more of the way from bare paper to the darkest
        // paint, and as far short of it, shows the edge is filtered.
        const between = (d: number) => d >= peak / 10 && d <= peak * 0.9
        if (!between(a) && !between(b)) unramped++
        break
      }
    }
  }
  const n = points.length
  const mx = points.reduce((s, [x]) => s + x, 0) / n
  const my = points.reduce((s, [, y]) => s + y, 0) / n
  const slope =
    points.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) /
    points.reduce((s, [x]) => s + (x - mx) ** 2, 0)
  const off = points.map(([x, y]) => Math.abs(y - (my + slope * (x - mx))))
  return {
    columns: n,
    rms: Math.sqrt(off.reduce((s, d) => s + d * d, 0) / n),
    max: Math.max(...off),
    unramped,
  }
}

test("a dry brush's diagonal edge is straight by this measure", async ({
  page,
}) => {
  const edge = upperEdge(
    await dried(page, { radius: 24, fluid: null, path: DIAGONAL })
  )
  expect(edge.columns).toBe(120)
  expect(edge.rms).toBeLessThanOrEqual(STRAIGHT.rms)
  expect(edge.max).toBeLessThanOrEqual(STRAIGHT.max)
})

// Where the dabs laid paint is kept at the document's resolution, so a laid
// edge follows the brush (fluid brushes 42). A bloom carries paint past where
// it was laid, and there the edge is still the cells': anti-aliased but
// stepped every two pixels (fluid brushes 44).
const CASES = [
  {
    name: "a dried fluid stroke's edge, at radius 4",
    radius: 4,
    fluid: RIMMED,
    straightness: "follows the stroke, not the cell grid",
    within: STRAIGHT,
  },
  {
    name: "a dried fluid stroke's edge, at radius 24",
    radius: 24,
    fluid: RIMMED,
    straightness: "follows the stroke, not the cell grid",
    within: STRAIGHT,
  },
  {
    name: "a dried bloom's front",
    radius: 12,
    fluid: FLOODED,
    straightness: "keeps the cells' edge, and no more jagged",
    within: CELL_EDGE,
  },
]

for (const { name, radius, fluid, straightness, within } of CASES) {
  test(`${name} is anti-aliased`, async ({ page }) => {
    test.slow()
    const edge = upperEdge(await dried(page, { radius, fluid, path: DIAGONAL }))
    expect(edge.columns).toBe(120)
    expect(edge.unramped).toBe(0)
  })

  test(`${name} ${straightness}`, async ({ page }) => {
    test.slow()
    const edge = upperEdge(await dried(page, { radius, fluid, path: DIAGONAL }))
    await test.info().attach("edge", {
      body: JSON.stringify({ rms: edge.rms, max: edge.max }),
      contentType: "application/json",
    })
    expect(edge.columns).toBe(120)
    expect(edge.rms).toBeLessThanOrEqual(within.rms)
    expect(edge.max).toBeLessThanOrEqual(within.max)
  })
}

/** How dark a pixel is: what has been taken out of white paper. */
const darknessIn = (image: number[]) => (x: number, y: number) => {
  const i = (y * SIZE + x) * 4
  return 765 - image[i] - image[i + 1] - image[i + 2]
}

/** The pixels showing at least half a mark's darkest pixel's darkness. */
function painted(image: number[]) {
  const darkness = darknessIn(image)
  let peak = 0
  for (let y = 32; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) peak = Math.max(peak, darkness(x, y))
  const box = { left: SIZE, top: SIZE, right: -1, bottom: -1 }
  let area = 0
  for (let y = 32; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      if (darkness(x, y) < peak / 2) continue
      area++
      box.left = Math.min(box.left, x)
      box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x)
      box.bottom = Math.max(box.bottom, y)
    }
  return {
    area,
    width: box.right - box.left + 1,
    height: box.bottom - box.top + 1,
    ...box,
  }
}

// What these marks measured before the edge followed where the dabs laid
// paint (fluid brushes 42), which must only trim where paint shows.
const TAP_AREA = 48
const LINE_ENDS = { left: 56, right: 199 }
const FAINT_INTERIOR = 64.6

test("a single small dab keeps its size and stays round", async ({ page }) => {
  test.slow()
  const tap = painted(
    await dried(page, { radius: 4, fluid: RIMMED, path: [[128, 128]] })
  )
  expect(tap.area).toBeGreaterThanOrEqual(TAP_AREA * 0.9)
  expect(tap.area).toBeLessThanOrEqual(TAP_AREA * 1.1)
  expect(tap.width / tap.height).toBeGreaterThanOrEqual(0.9)
  expect(tap.width / tap.height).toBeLessThanOrEqual(1.1)
})

test("a thin stroke's tips draw back no more than a pixel", async ({
  page,
}) => {
  test.slow()
  const line = painted(
    await dried(page, {
      radius: 4,
      fluid: RIMMED,
      path: [
        [60, 128],
        [196, 128],
      ],
    })
  )
  expect(line.left).toBeLessThanOrEqual(LINE_ENDS.left + 1)
  expect(line.right).toBeGreaterThanOrEqual(LINE_ENDS.right - 1)
})

test("a faint wash dries as light inside as it was", async ({ page }) => {
  test.slow()
  const darkness = darknessIn(
    await dried(page, {
      radius: 24,
      fluid: RIMMED,
      flow: 0.1,
      path: [
        [40, 128],
        [216, 128],
      ],
    })
  )
  let patch = 0
  for (let y = 124; y < 132; y++)
    for (let x = 112; x < 144; x++) patch += darkness(x, y)
  expect(Math.abs(patch / 256 - FAINT_INTERIOR)).toBeLessThanOrEqual(2)
})

// Also measured before the edge followed the coverage: a soft brush's width,
// and the steepest step between neighbouring pixels across the edge of a hole
// blotted out of a wash, which inside where paint was laid is filtered across
// as it always was.
const SOFT_WIDTH = 32
const BLOTTED_STEP = 85

test("a soft brush's paint is as wide as it was", async ({ page }) => {
  test.slow()
  const soft = painted(
    await dried(page, {
      radius: 16,
      feather: 6,
      fluid: RIMMED,
      path: [
        [60, 128],
        [196, 128],
      ],
    })
  )
  expect(Math.abs(soft.height - SOFT_WIDTH)).toBeLessThanOrEqual(1)
})

test("the edge of a hole blotted out of a wash is as soft as it was", async ({
  page,
}) => {
  test.slow()
  const darkness = darknessIn(
    await dried(page, {
      radius: 24,
      fluid: RIMMED,
      path: [
        [40, 128],
        [216, 128],
      ],
      blot: { at: [128, 128], radius: 10 },
    })
  )
  let step = 0
  for (let x = 100; x < 156; x++)
    step = Math.max(step, Math.abs(darkness(x + 1, 128) - darkness(x, 128)))
  expect(step).toBeLessThanOrEqual(BLOTTED_STEP * 1.1)
})
