import { expect, test, type Page } from "@playwright/test"

/**
 * The edge of fluid paint (fluid brushes 30), through the engine's command
 * seam and the pixels it presents. The wet surface is simulated at half the
 * document's resolution (D42), but what it shows must not follow that grid:
 * a straight stroke's edge, and the front of a bloom, are as straight and as
 * anti-aliased as a dry brush's, wet or dried.
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

/** A diagonal stroke left to dry by itself, and the canvas it leaves. */
async function driedDiagonal(page: Page, radius: number, fluid: Fluid | null) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([size, radius, colour, fluid]) => {
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
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [SIZE, radius, BLUE, fluid] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  // A slope of about 0.3: a two pixel step comes round every seven columns.
  await page.mouse.move(box.x + 20, box.y + 170)
  await page.mouse.down()
  await page.mouse.move(box.x + 236, box.y + 105, { steps: 60 })
  await page.mouse.up()
  await frames(page)
  if (fluid) {
    const before = await settledSteps(page)
    for (let i = 0; i < 300 && (await settledSteps(page)) === before; i++) {
      await page.evaluate(() =>
        window.engine.dispatch({ type: "advanceFluid", steps: 20 })
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
  const edge = upperEdge(await driedDiagonal(page, 24, null))
  expect(edge.columns).toBe(120)
  expect(edge.rms).toBeLessThanOrEqual(STRAIGHT.rms)
  expect(edge.max).toBeLessThanOrEqual(STRAIGHT.max)
})

const CASES = [
  {
    name: "a dried fluid stroke's edge, at radius 4",
    radius: 4,
    fluid: RIMMED,
  },
  {
    name: "a dried fluid stroke's edge, at radius 24",
    radius: 24,
    fluid: RIMMED,
  },
  { name: "a dried bloom's front", radius: 12, fluid: FLOODED },
]

for (const { name, radius, fluid } of CASES) {
  test(`${name} is anti-aliased`, async ({ page }) => {
    const edge = upperEdge(await driedDiagonal(page, radius, fluid))
    expect(edge.columns).toBe(120)
    expect(edge.unramped).toBe(0)
  })

  test(`${name} follows the stroke, not the cell grid`, async ({ page }) => {
    // Filtering in what a cell shows anti-aliases the edge but cannot move
    // it off the cell grid: it still strays about 0.45 px from a straight
    // line, stepped every two pixels. Fluid brushes 42 puts the edge back at
    // the document's resolution; this then passes and the mark comes off.
    test.fail()
    const edge = upperEdge(await driedDiagonal(page, radius, fluid))
    expect(edge.columns).toBe(120)
    expect(edge.rms).toBeLessThanOrEqual(STRAIGHT.rms)
    expect(edge.max).toBeLessThanOrEqual(STRAIGHT.max)
  })
}
