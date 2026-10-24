import { expect, test, type Page } from "@playwright/test"

/**
 * Forced settles (fluid brushes 03), through the engine's command seam and
 * the pixels it presents. Wet paint is only ever on the active layer and only
 * in the session: whatever needs the layer's pixels to be final dries it
 * first, as one undo step, and then acts on what dried.
 *
 * The simulation's clock is stopped here and stepped by command, so nothing
 * dries by itself and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row strokes are drawn along. */
const ROW = 60
const BLUE = "#1040e0"
const FLUID = { water: 0.5, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }

type Origin = { x: number; y: number }

/** A fresh id per test: OPFS outlives the page. */
const newId = () => `doc-${Math.random().toString(36).slice(2)}`

/** Opens the canvas with a fluid brush, on a stored document when named. */
async function openCanvas(page: Page, documentId?: string): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, fluid, documentId]) => {
      window.remountEngine({
        manualFluidClock: true,
        ...(documentId ? { persistence: { documentId } } : {}),
      })
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
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.125,
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [WIDTH, HEIGHT, BLUE, FLUID, documentId] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const addLayer = (page: Page) =>
  page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot().activeLayerId!
  })

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

/**
 * Whether two pictures are the same to the rounding of a half float: a layer
 * stores them, so a channel of settled paint may round the other way.
 */
const same = (a: number[], b: number[]) =>
  a.length === b.length &&
  a.every((channel, index) => Math.abs(channel - b[index]) <= 1)

/**
 * The undo steps that are in the layers' own pixels. A fluid stroke whose
 * paint is still wet is a step too, but one that holds no tile (fluid
 * brushes 04), and it gives way to the settle's.
 */
const steps = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

const untilSteps = (page: Page, count: number) =>
  page.waitForFunction(
    (count) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >=
      count,
    count
  )

const undo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "undo" }))

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

async function drag(page: Page, origin: Origin, from: number, to: number) {
  await page.mouse.move(origin.x + from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

/**
 * A wash left wet on a new layer, run on a little so it has moved: the layer
 * it is on, the picture it shows, and the undo steps there were with it wet.
 */
async function wetWash(page: Page, origin: Origin) {
  const layer = await addLayer(page)
  await drag(page, origin, 40, 150)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "advanceFluid", steps: 30 })
  )
  expect(await isWet(page)).toBe(true)
  return { layer, wet: await pixels(page), before: await steps(page) }
}

const dispatches =
  (command: (layer: string) => Parameters<Window["engine"]["dispatch"]>[0]) =>
  (page: Page, layer: string) =>
    page.evaluate((command) => window.engine.dispatch(command), command(layer))

/** What forces a settle and leaves the picture as it was. */
const SETTLERS: [string, (page: Page, layer: string) => Promise<unknown>][] = [
  ["a flush", (page) => page.evaluate(() => window.engine.save())],
  ["a new layer", dispatches(() => ({ type: "addLayer" }))],
  [
    "a backup export",
    (page) =>
      page.evaluate(() => window.engine.exportDocument().then(() => {})),
  ],
  [
    "an SVG export",
    (page) =>
      page.evaluate(() =>
        window.engine.exportSvg({ raster: "embed" }).then(() => {})
      ),
  ],
  [
    "a filter opened",
    dispatches((id) => ({ type: "beginFilter", id, kind: "blur" })),
  ],
  [
    "a transform begun",
    dispatches((id) => ({ type: "beginLayerTransform", id })),
  ],
  [
    "a mask chosen to paint on",
    async (page, id) => {
      await dispatches((id) => ({ type: "addMask", id }))(page, id)
      await dispatches((id) => ({ type: "selectMask", id }))(page, id)
    },
  ],
]

for (const [name, act] of SETTLERS)
  test(`${name} settles wet paint first, as one step and with nothing changed on screen`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const { layer, wet, before } = await wetWash(page, origin)
    await act(page, layer)
    expect(await isWet(page)).toBe(false)
    await untilSteps(page, before + 1)
    expect(same(await pixels(page), wet)).toBe(true)
  })

test("a filter works on the settled paint", async ({ page }) => {
  const origin = await openCanvas(page)
  const { layer, wet, before } = await wetWash(page, origin)
  await dispatches((id) => ({ type: "beginFilter", id, kind: "hsl" }))(
    page,
    layer
  )
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "previewFilter",
      filter: { kind: "hsl", hue: 120, saturation: 0, lightness: 0 },
    })
    await window.engine.dispatch({ type: "applyFilter" })
  })
  // The settle, then the filter over it.
  await untilSteps(page, before + 2)
  expect(same(await pixels(page), wet)).toBe(false)
  await undo(page)
  expect(same(await pixels(page), wet)).toBe(true)
})

test("clearing the layer empties the settled paint, and undo brings it back dry", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  const { wet, before } = await wetWash(page, origin)
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId!
    await window.engine.dispatch({ type: "clearLayer", id })
  })
  expect(await isWet(page)).toBe(false)
  await untilSteps(page, before + 2)
  expect(await pixels(page)).toEqual(empty)
  await undo(page)
  expect(same(await pixels(page), wet)).toBe(true)
  expect(await isWet(page)).toBe(false)
})

test("a flipped layer is the settled paint, mirrored", async ({ page }) => {
  const origin = await openCanvas(page)
  const { layer, wet, before } = await wetWash(page, origin)
  await dispatches((id) => ({ type: "flipLayer", id, axis: "vertical" }))(
    page,
    layer
  )
  expect(await isWet(page)).toBe(false)
  await untilSteps(page, before + 2)
  await undo(page)
  expect(same(await pixels(page), wet)).toBe(true)
})

test("after a layer switch the layer left behind holds the settled paint and nothing is wet", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const other = await addLayer(page)
  const empty = await pixels(page)
  const { layer, wet, before } = await wetWash(page, origin)
  await dispatches(() => ({ type: "selectLayer", id: other }))(page, layer)
  expect(await isWet(page)).toBe(false)
  await untilSteps(page, before + 1)
  expect(same(await pixels(page), wet)).toBe(true)

  // The paint is in the layer that was left, and nowhere else.
  const show = (visible: boolean) =>
    dispatches((id) => ({ type: "setLayer", id, visible }))(page, layer)
  await show(false)
  expect(await pixels(page)).toEqual(empty)
  await show(true)
  // A fluid stroke on the layer switched to wets that one alone.
  await drag(page, origin, 40, 150)
  expect(await isWet(page)).toBe(true)
  await show(false)
  expect(await pixels(page)).not.toEqual(empty)
})

/** Each tool that is not a fluid brush, as it is picked up. */
const TOOLS: [string, Parameters<Window["engine"]["dispatch"]>[0][]][] = [
  ["a dry brush", [{ type: "setBrush", fluid: null }]],
  ["a wet brush", [{ type: "setBrush", fluid: null, wet: { pickup: 0.5 } }]],
  ["the eraser", [{ type: "setTool", tool: "eraser" }]],
  ["smudge", [{ type: "setTool", tool: "smudge" }]],
]

for (const [name, pickUp] of TOOLS)
  test(`${name} lands on top of paint that was wet a moment before`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const { wet, before } = await wetWash(page, origin)
    await page.evaluate(async (commands) => {
      await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
      for (const command of commands) await window.engine.dispatch(command)
    }, pickUp)
    // Picking a tool up dries nothing; using it does.
    expect(await isWet(page)).toBe(true)
    expect(same(await pixels(page), wet)).toBe(true)

    // Out of the wash and past its end.
    await drag(page, origin, 110, 210)
    // The settle, and the stroke over it.
    await untilSteps(page, before + 2)
    expect(await isWet(page)).toBe(false)
    expect(same(await pixels(page), wet)).toBe(false)
    // Under the stroke is the wash as it was, dried.
    await undo(page)
    expect(same(await pixels(page), wet)).toBe(true)
  })

test("a fluid brush on a layer mask paints it as a dry brush and wets nothing", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const layer = await addLayer(page)
  for (const type of ["addMask", "selectMask"] as const)
    await dispatches((id) => ({ type, id }))(page, layer)
  const before = await steps(page)
  await drag(page, origin, 40, 150)
  expect(await isWet(page)).toBe(false)
  // The stroke is its own step as the pen lifts, with nothing left to dry.
  await untilSteps(page, before + 1)
})

test("hiding the tab settles wet paint", async ({ page }) => {
  const origin = await openCanvas(page)
  const { wet, before } = await wetWash(page, origin)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  expect(await isWet(page)).toBe(false)
  await untilSteps(page, before + 1)
  await page.evaluate(() => {
    delete (document as { visibilityState?: string }).visibilityState
  })
  expect(same(await pixels(page), wet)).toBe(true)
})

test("a flush made while paint was wet, then a reload, shows the dried paint", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openCanvas(page, documentId)
  const { wet } = await wetWash(page, origin)
  await page.evaluate(() => window.engine.save())

  // No dispose, no unload handler: the tab simply stops existing.
  await page.reload()
  await openCanvas(page, documentId)
  expect(await isWet(page)).toBe(false)
  expect(same(await pixels(page), wet)).toBe(true)
})

test("leaving the canvas settles wet paint, and the document reopens with it", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openCanvas(page, documentId)
  const { wet } = await wetWash(page, origin)
  const stored = () =>
    page.evaluate((id) => window.tileCountFor(id), documentId)
  // Wet paint is in no tile, so the store holds none of it yet.
  const dry = await stored()
  await page.evaluate(() => window.engine.dispose())
  await expect.poll(stored).toBeGreaterThan(dry)

  await page.reload()
  await openCanvas(page, documentId)
  expect(same(await pixels(page), wet)).toBe(true)
})
