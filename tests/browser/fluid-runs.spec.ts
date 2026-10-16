import { expect, test, type Page } from "@playwright/test"

/** Runs (39), through commands, the manual clock and the presented pixels. */
const WIDTH = 240
const HEIGHT = 240
const ROW = 60
const RADIUS = 24
const HEAVY = { water: 1, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }
type Command = Parameters<typeof window.engine.dispatch>[0]
const dispatch = (page: Page, command: Command) =>
  page.evaluate((command) => window.engine.dispatch(command), command)
const advance = (page: Page, steps: number) =>
  dispatch(page, { type: "advanceFluid", steps })
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
async function open(page: Page, steepness = 1) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, steepness]) => {
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
      await window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
      await window.engine.dispatch({ type: "addLayer" })
      await window.engine.dispatch({
        type: "setBoard",
        steepness,
        direction: 0,
      })
    },
    [WIDTH, HEIGHT, steepness]
  )
  return (await page.locator("canvas").boundingBox())!
}
async function wash(
  page: Page,
  origin: { x: number; y: number },
  fluid = HEAVY,
  radius = RADIUS
) {
  await dispatch(page, {
    type: "setBrush",
    fluid,
    radius,
    spacing: 0.125,
    flow: 0.1,
  })
  await page.mouse.move(origin.x + 50, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + 190, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
  await frames(page)
}
/** Mean darkness across the evenly laid middle of the wash. */
function rowPaint(image: number[], y: number) {
  let sum = 0
  for (let x = 80; x < 160; x++) {
    const at = (y * WIDTH + x) * 4
    sum += 765 - image[at] - image[at + 1] - image[at + 2]
  }
  return sum / 80
}
function tip(image: number[]) {
  let last = 0
  for (let y = 0; y < HEIGHT; y++) if (rowPaint(image, y) > 5) last = y
  return last
}

test("past HOLDS a wash runs after lift and dries with a bead darker than its trail", async ({
  page,
}) => {
  test.slow()
  const origin = await open(page)
  await wash(page, origin)
  const laid = await pixels(page)
  await advance(page, 400)
  const running = await pixels(page)
  expect(tip(running)).toBeGreaterThan(tip(laid) + 8)
  for (
    let i = 0;
    i < 30 && (await page.evaluate(() => window.engine.getSnapshot().wet));
    i++
  ) {
    await advance(page, 50)
    await frames(page)
  }
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(false)
  const dry = await pixels(page)
  const end = tip(dry)
  const bead = Math.max(
    ...Array.from({ length: 8 }, (_, i) => rowPaint(dry, end - i))
  )
  const trail = rowPaint(dry, ROW + RADIUS)
  expect(trail).toBeGreaterThan(5)
  expect(bead).toBeGreaterThan(trail * 1.15)
  await test.info().attach("run-measurement", {
    body: JSON.stringify({
      steps: 400,
      travelPx: tip(running) - tip(laid),
      dryBeadDarkness: bead,
      dryTrailDarkness: trail,
    }),
    contentType: "application/json",
  })
})

test("a running wash conserves water at full steepness with evaporation off", async ({
  page,
}) => {
  const origin = await open(page)
  await dispatch(page, { type: "setDryingPaused", paused: true })
  await wash(page, origin)
  const water = () => page.evaluate(() => window.engine.readWetWater())
  const before = await water()
  expect(before).toBeGreaterThan(0)
  for (const steps of [1, 99, 300, 400]) {
    await advance(page, steps)
    const after = await water()
    expect(Number.isFinite(after)).toBe(true)
    expect(Math.abs(after - before) / before).toBeLessThan(0.005)
  }
})

test("a deep broad sheet cannot lose water against the cell depth cap", async ({
  page,
}) => {
  const origin = await open(page)
  await dispatch(page, { type: "setDryingPaused", paused: true })
  await wash(page, origin, HEAVY, 56)
  const water = () => page.evaluate(() => window.engine.readWetWater())
  const before = await water()
  await advance(page, 800)
  expect(Math.abs((await water()) - before) / before).toBeLessThan(0.005)
})

test("below HOLDS the same wash slopes but does not run", async ({ page }) => {
  const origin = await open(page)
  await wash(page, origin, { ...HEAVY, water: 0.4 })
  const laid = await pixels(page)
  await advance(page, 400)
  expect(tip(await pixels(page))).toBeLessThanOrEqual(tip(laid) + 2)
})

test("running does not extend the deadline, and held runs do not move", async ({
  page,
}) => {
  test.slow()
  const deadline = async (steepness: number, paused = false) => {
    const origin = await open(page, steepness)
    await dispatch(page, { type: "setDryingPaused", paused })
    await wash(page, origin, { ...HEAVY, drying: 1 })
    // The deepest water takes 201 steps at the stored float rate, then
    // dampness and the body's margin: inspect either side of the deadline.
    await advance(page, 270)
    expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(
      true
    )
    await advance(page, 1)
    await frames(page)
    return pixels(page)
  }
  await deadline(0)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(false)
  await deadline(1)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(false)
  const held = await deadline(1, true)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(true)
  await advance(page, 200)
  expect(await pixels(page)).toEqual(held)
})

test("blotting the downhill bead stops its tip", async ({ page }) => {
  const origin = await open(page)
  await wash(page, origin)
  await advance(page, 200)
  const end = tip(await pixels(page))
  await dispatch(page, {
    type: "setBrush",
    fluid: null,
    blot: { water: 1, pigment: 0.8 },
    radius: 12,
    flow: 1,
  })
  await page.mouse.move(origin.x + 25, origin.y + end)
  await page.mouse.down()
  await page.mouse.move(origin.x + 215, origin.y + end, { steps: 40 })
  await page.mouse.up()
  await frames(page)
  await advance(page, 300)
  // Removing pigment can retract the visible edge. The run must never
  // advance past the tip where its bead was removed.
  expect(tip(await pixels(page))).toBeLessThanOrEqual(end)
  // Without the blot, the same front still has travel left: undo restores
  // its fields and test clock to just before the tissue touched it.
  await dispatch(page, { type: "undo" })
  await advance(page, 300)
  expect(tip(await pixels(page))).toBeGreaterThan(end)
})

test("undo and redo put a running stroke's fields back and forward", async ({
  page,
}) => {
  const origin = await open(page)
  const empty = await pixels(page)
  await wash(page, origin)
  await advance(page, 400)
  const ran = await pixels(page)
  const water = await page.evaluate(() => window.engine.readWetWater())
  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(empty)
  await dispatch(page, { type: "redo" })
  expect(await pixels(page)).toEqual(ran)
  expect(await page.evaluate(() => window.engine.readWetWater())).toBe(water)
})

test("heavy washes are deterministic, and flat skips the board regardless of direction", async ({
  page,
}) => {
  test.slow()
  const run = async (steepness: number, direction = 0) => {
    const origin = await open(page, steepness)
    if (direction)
      await dispatch(page, { type: "setBoard", steepness, direction })
    await wash(page, origin)
    await advance(page, 400)
    return pixels(page)
  }
  expect(await run(1)).toEqual(await run(1))
  expect(await run(0, 123)).toEqual(await run(0))
})
