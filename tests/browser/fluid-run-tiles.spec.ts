import { expect, test, type Page } from "@playwright/test"

type Command = Parameters<typeof window.engine.dispatch>[0]
const dispatch = (page: Page, command: Command) =>
  page.evaluate((command) => window.engine.dispatch(command), command)

async function open(
  page: Page,
  steepness = 1,
  water = 0.6,
  size = { width: 512, height: 768 }
) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ({ steepness, water, size }) => {
      window.remountEngine({ manualFluidClock: true })
      await window.engine.dispatch({
        type: "resize",
        ...size,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "addLayer" })
      await window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
      await window.engine.dispatch({ type: "setDryingPaused", paused: true })
      await window.engine.dispatch({
        type: "setBoard",
        steepness,
        direction: 0,
      })
      // Exactly HOLDS takes no dab ring. Gravity then gathers water past HOLDS
      // at the downhill edge, immediately above a still-dry tile.
      await window.engine.dispatch({
        type: "setBrush",
        radius: 18,
        flow: 1,
        fluid: { water, drying: 0.5, bleed: 0.5, edge: 0, granulation: 0 },
      })
    },
    { steepness, water, size }
  )
  const box = (await page.locator("canvas").boundingBox())!
  await page.mouse.move(box.x + 128, box.y + 234)
  await page.mouse.down()
  await page.mouse.up()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}
const wet = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => window.engine.wetUnder(x, y), { x, y })
const pixels = (page: Page) =>
  page.evaluate(async () => Array.from((await window.engine.readPixels()).data))

test("a flooded downhill edge claims just the next tile, carries paint across, and undoes", async ({
  page,
}) => {
  test.slow()
  await open(page)
  expect(await wet(page, 128, 270)).toBe(false)
  await dispatch(page, { type: "advanceFluid", steps: 400 })
  expect(await wet(page, 128, 270)).toBe(true)
  expect(await wet(page, 384, 270)).toBe(false)
  expect(await wet(page, 128, 530)).toBe(false)
  const running = await pixels(page)
  let darkness = 0
  for (let y = 258; y < 270; y++)
    for (let x = 118; x < 138; x++) {
      const at = (y * 512 + x) * 4
      darkness += 765 - running[at] - running[at + 1] - running[at + 2]
    }
  expect(darkness).toBeGreaterThan(100)
  await dispatch(page, { type: "undo" })
  expect(await wet(page, 128, 270)).toBe(false)
  const undone = await pixels(page)
  await dispatch(page, { type: "redo" })
  expect(await pixels(page)).toEqual(running)
  await dispatch(page, { type: "dryNow" })
  await expect
    .poll(() => page.evaluate(() => window.engine.historyUsage().wetSteps))
    .toBe(0)
  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(undone)
})

for (const control of [
  { name: "flat", steepness: 0, water: 0.6 },
  { name: "below HOLDS", steepness: 1, water: 0.15 },
]) {
  test(`${control.name} paint claims no downhill tile`, async ({ page }) => {
    await open(page, control.steepness, control.water)
    await dispatch(page, { type: "advanceFluid", steps: 400 })
    expect(await wet(page, 128, 270)).toBe(false)
  })
}

test("a body already covering the document needs no edge readback", async ({
  page,
}) => {
  await open(page, 1, 0.6, { width: 256, height: 256 })
  const readbacks = await page.evaluate(async () => {
    const original = GPUBuffer.prototype.mapAsync
    let count = 0
    GPUBuffer.prototype.mapAsync = function (...args) {
      count++
      return original.apply(this, args)
    }
    try {
      await window.engine.dispatch({ type: "advanceFluid", steps: 10 })
      return count
    } finally {
      GPUBuffer.prototype.mapAsync = original
    }
  })
  expect(readbacks).toBe(0)
})

test("a run's new tile holds on the original body's deadline", async ({
  page,
}) => {
  test.slow()
  await open(page)
  await dispatch(page, { type: "advanceFluid", steps: 400 })
  expect(await wet(page, 128, 270)).toBe(true)
  // A 1.2-deep dab at drying 0.5 is due at step 940 (including relief,
  // dampness and the drying margin). Acquiring a tile must not restart it.
  await dispatch(page, { type: "advanceFluid", steps: 540 })
  const held = await pixels(page)
  await dispatch(page, { type: "advanceFluid", steps: 200 })
  expect(await pixels(page)).toEqual(held)
})

test("undo while an edge report is in flight cannot reclaim the undone tiles", async ({
  page,
}) => {
  await open(page)
  await page.evaluate(async () => {
    const running = window.engine.dispatch({ type: "advanceFluid", steps: 400 })
    await window.engine.dispatch({ type: "undo" })
    await running
  })
  expect(await wet(page, 128, 234)).toBe(false)
  expect(await wet(page, 128, 270)).toBe(false)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(false)
})

test("finding a missing downhill face reads only the bounded edge report", async ({
  page,
}) => {
  await open(page)
  const reports = await page.evaluate(async () => {
    const original = GPUBuffer.prototype.mapAsync
    const sizes: number[] = []
    GPUBuffer.prototype.mapAsync = function (...args) {
      sizes.push(this.size)
      return original.apply(this, args)
    }
    try {
      await window.engine.dispatch({ type: "advanceFluid", steps: 2 })
      return sizes
    } finally {
      GPUBuffer.prototype.mapAsync = original
    }
  })
  expect(reports).toEqual([256, 256])
})
