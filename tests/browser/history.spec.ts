import { expect, test, type Page } from "@playwright/test"

/**
 * Undo and redo, through the engine's command seam and the pixels it presents.
 *
 * The claim under test is not that a stack pops in the right order — that is
 * settled in unit tests against a fake surface — but that the pixels a step
 * restores are the pixels that were there, after they have made the round trip
 * through GPU textures, the tile store's compression, and the browser's own
 * filesystem.
 */

const WIDTH = 200
const HEIGHT = 120

/** Inside the seeded scene's opaque wide-gamut green rectangle. */
const IN_GREEN = { x: 20, y: 10 }

type Image = { width: number; data: number[] }

/**
 * A history small enough that a handful of strokes crosses both boundaries.
 * The compressed pool is sized in compressed terms: a deflated tile is a
 * fraction of the raw half-megabyte one, so a warm budget measured in raw
 * tiles would never overflow and nothing would ever reach disk.
 */
const TINY_HISTORY = {
  budgetBytes: 64 * 1024 * 1024,
  hotBytes: 1024 * 1024,
  warmBytes: 4 * 1024,
}

async function openCanvas(
  page: Page,
  history?: typeof TINY_HISTORY
): Promise<{ x: number; y: number }> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, budget]) => {
      window.remountEngine(
        budget ? { history: budget as Record<string, number> } : undefined
      )
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT, history] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function painted(page: Page): Promise<Image> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () => {
    const pixels = await window.engine.readPixels()
    return { width: pixels.width, data: Array.from(pixels.data) }
  })
}

/** One horizontal mark at a given height, so strokes can be told apart. */
async function paint(
  page: Page,
  origin: { x: number; y: number },
  y: number,
  from = 10,
  to = 30
) {
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(origin.x + from, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + y, { steps: 20 })
  await page.mouse.up()
  // The mark is composited on the next frame and read back after that, so the
  // step exists a little after the pen does.
  await page.waitForFunction(
    (steps) => window.engine.historyUsage().steps > steps,
    before
  )
}

const undo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "undo" }))
const redo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "redo" }))

const channel = (image: Image, at: { x: number; y: number }, index: number) =>
  image.data[(at.y * image.width + at.x) * 4 + index]

/** Painting is dark ink, so a marked pixel is dark in every channel. */
const isInk = (image: Image, at: { x: number; y: number }) =>
  channel(image, at, 0) < 128 &&
  channel(image, at, 1) < 128 &&
  channel(image, at, 2) < 128

test("undo takes back a stroke, pixel for pixel, and redo puts it back", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const scene = await painted(page)
  expect(isInk(scene, IN_GREEN)).toBe(false)

  await paint(page, origin, IN_GREEN.y)
  const marked = await painted(page)
  expect(isInk(marked, IN_GREEN)).toBe(true)

  await undo(page)
  // Every pixel, not a sample of them: an undo that is close is not an undo.
  expect(await painted(page)).toEqual(scene)

  await redo(page)
  expect(await painted(page)).toEqual(marked)
})

test("one stroke is one step", async ({ page }) => {
  const origin = await openCanvas(page)
  const scene = await painted(page)
  await paint(page, origin, 20)
  const first = await painted(page)
  await paint(page, origin, 40)
  const second = await painted(page)
  expect(second).not.toEqual(first)

  await undo(page)
  expect(await painted(page)).toEqual(first)
  await undo(page)
  expect(await painted(page)).toEqual(scene)
  expect(await page.evaluate(() => window.engine.getSnapshot().canUndo)).toBe(
    false
  )
})

test("painting after an undo abandons what was undone", async ({ page }) => {
  const origin = await openCanvas(page)
  await paint(page, origin, 20)
  const first = await painted(page)
  await paint(page, origin, 40)
  await undo(page)
  expect(await painted(page)).toEqual(first)

  await paint(page, origin, 60)
  const snapshot = await page.evaluate(() => window.engine.getSnapshot())
  expect(snapshot.canRedo).toBe(false)
  await undo(page)
  expect(await painted(page)).toEqual(first)
})

test("undo covers layer operations, and the pixels of a removed layer", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const scene = await painted(page)

  const added = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot().activeLayerId
  })
  await paint(page, origin, IN_GREEN.y)
  const marked = await painted(page)
  expect(isInk(marked, IN_GREEN)).toBe(true)

  // Halving the layer's opacity is a step of its own.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, opacity: 0.5 }),
    added
  )
  const faded = await painted(page)
  expect(faded).not.toEqual(marked)

  // Removing the layer takes its pixels with it.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "removeLayer", id }),
    added
  )
  expect(await painted(page)).toEqual(scene)

  await undo(page)
  const back = await page.evaluate(() => window.engine.getSnapshot())
  expect(back.layers).toHaveLength(2)
  expect(await painted(page)).toEqual(faded)

  await undo(page)
  expect(await painted(page)).toEqual(marked)
  await undo(page)
  expect(await painted(page)).toEqual(scene)
  await undo(page)
  // The layer that was added is gone again, and so is the scene's history.
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layers.length)
  ).toBe(1)
})

test("a duplicated layer's pixels survive undoing and redoing it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await paint(page, origin, IN_GREEN.y)
  const marked = await painted(page)
  const copied = await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "duplicateLayer", id })
    return window.engine.getSnapshot().layers.length
  })
  expect(copied).toBe(2)
  const doubled = await painted(page)

  await undo(page)
  expect(await painted(page)).toEqual(marked)
  await redo(page)
  expect(await painted(page)).toEqual(doubled)
})

test("undo takes back paint on a mask, not on the layer under it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await paint(page, origin, IN_GREEN.y)
  const marked = await painted(page)

  // Painting a mask hides the layer where the mark falls.
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
  })
  await paint(page, origin, IN_GREEN.y)
  const masked = await painted(page)
  expect(masked).not.toEqual(marked)

  await undo(page)
  expect(await painted(page)).toEqual(marked)
  await redo(page)
  expect(await painted(page)).toEqual(masked)
})

test("a long session crosses the tiers without exhausting memory, and still restores exactly", async ({
  page,
}) => {
  test.slow()
  const origin = await openCanvas(page, TINY_HISTORY)
  const scene = await painted(page)
  const marks: Image[] = []
  for (let step = 0; step < 12; step++) {
    await paint(page, origin, 8 + step * 8, 6, 60)
    marks.push(await painted(page))
  }

  const usage = await page.evaluate(() => window.engine.historyUsage())
  // History is holding far more than it is keeping in memory: the older tiles
  // are compressed, and the oldest have left memory for OPFS altogether.
  expect(usage.heldBytes).toBeGreaterThan(usage.residentBytes)
  expect(usage.residentBytes).toBeLessThanOrEqual(
    TINY_HISTORY.hotBytes + TINY_HISTORY.warmBytes
  )
  expect(usage.spilledBytes).toBeGreaterThan(0)

  // All the way back down through every tier, each step exact. The deepest
  // steps are the spilled ones, and they are the ones timed below.
  const timings: number[] = []
  for (let step = marks.length - 1; step > 0; step--) {
    expect(await painted(page)).toEqual(marks[step])
    timings.push(
      await page.evaluate(async () => {
        const started = performance.now()
        await window.engine.dispatch({ type: "undo" })
        return performance.now() - started
      })
    )
  }
  await undo(page)
  expect(await painted(page)).toEqual(scene)

  // Responsive at the deepest tier: reading a step back off disk and
  // inflating it stays well inside the time a keystroke may take, even on the
  // software rasterizer this suite runs on.
  expect(Math.max(...timings)).toBeLessThan(250)

  // And all the way forward again.
  for (const mark of marks) {
    await redo(page)
    expect(await painted(page)).toEqual(mark)
  }
})
