import { expect, test, type Page } from "@playwright/test"

/**
 * Pausing drying (fluid brushes 18), through the engine's command seam and
 * the pixels it presents. While drying is paused nothing evaporates, and a
 * body whose time has come holds, wet and still, instead of settling; a dab
 * into it sets it moving again, and turning the pause off lets every body
 * dry from where it is.
 *
 * The simulation's clock is stopped here and stepped by command, so a wash
 * has run the same number of steps on every machine and no test waits on one.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row strokes are drawn along. */
const ROW = 60
const BLUE = "#1040e0"
const YELLOW = "#f0c020"
/** A brush whose paint is dry within two hundred steps. */
const QUICK = { water: 0.5, drying: 1, bleed: 1, edge: 0.5, granulation: 0 }
/** Steps that see any wash of `QUICK` past its deadline. */
const PAST_DRY = 400
const TISSUE = { water: 1, pigment: 0.8 }

type Origin = { x: number; y: number }

/** A canvas wide enough for two bodies, a dry tile apart (tiles are 256 px). */
const WIDE = 800
/** Where a wash in the canvas's third tile is laid. */
const FAR = { from: 600, to: 700 }

async function openCanvas(page: Page, width = WIDTH): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, fluid]) => {
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
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.125,
        fluid,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [width, HEIGHT, BLUE, QUICK] as const
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

const usage = (page: Page) => page.evaluate(() => window.engine.historyUsage())

/** The undo steps that are in the layers' own pixels. */
const drySteps = async (page: Page) => {
  const { steps, wetSteps } = await usage(page)
  return steps - wetSteps
}

const untilDrySteps = (page: Page, count: number) =>
  page.waitForFunction(
    (count) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >=
      count,
    count
  )

const rgba = (image: number[], x: number, y = ROW, width = WIDTH) =>
  image.slice((y * width + x) * 4, (y * width + x) * 4 + 4)

/** How far two pixels are apart, summed over their channels. */
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

const isPaused = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().dryingPaused)

const dispatch = (page: Page, command: Record<string, unknown>) =>
  page.evaluate(
    (command) =>
      window.engine.dispatch(
        command as Parameters<typeof window.engine.dispatch>[0]
      ),
    command
  )

const pause = (page: Page, paused = true) =>
  dispatch(page, { type: "setDryingPaused", paused })

const advance = (page: Page, steps: number) =>
  dispatch(page, { type: "advanceFluid", steps })

/** A drag along a row, waited for as the step it lands as. */
async function drag(
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

test("drying starts unpaused, and pausing it is no step and dries nothing", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  expect(await isPaused(page)).toBe(false)
  await drag(page, origin, 30, 210)
  const before = await usage(page)
  await pause(page)
  expect(await isPaused(page)).toBe(true)
  expect(await isWet(page)).toBe(true)
  expect(await usage(page)).toEqual(before)
})

test("paused, a wash past its time holds wet and still, and settles nothing", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await pause(page)
  await drag(page, origin, 30, 210)
  const before = await drySteps(page)
  await advance(page, PAST_DRY)
  expect(await isWet(page)).toBe(true)
  expect(await drySteps(page)).toBe(before)
  // Held: further steps move nothing.
  const held = await pixels(page)
  await advance(page, 101)
  expect(same(await pixels(page), held)).toBe(true)
})

test("a wash already wet when drying is paused holds too", async ({ page }) => {
  const origin = await openCanvas(page)
  await drag(page, origin, 30, 210)
  await advance(page, 20)
  await pause(page)
  await advance(page, PAST_DRY)
  expect(await isWet(page)).toBe(true)
})

test("letting drying go on, a held wash dries from where it is, by itself", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await pause(page)
  await drag(page, origin, 30, 210)
  await advance(page, PAST_DRY)
  const held = await pixels(page)
  const before = await drySteps(page)
  await pause(page, false)
  expect(await isPaused(page)).toBe(false)
  // Nothing settles as it is let go: it moves again, and dries.
  expect(await isWet(page)).toBe(true)
  expect(await drySteps(page)).toBe(before)
  await advance(page, 60)
  expect(same(await pixels(page), held)).toBe(false)
  await advance(page, PAST_DRY)
  expect(await isWet(page)).toBe(false)
  await untilDrySteps(page, before + 1)
})

test("paused, a held wash keeps its water: paint laid into it bleeds", async ({
  page,
}) => {
  /** How far the colour beside where yellow was laid moves as it runs on. */
  const bleeding = async (paused: boolean) => {
    const origin = await openCanvas(page)
    if (paused) await pause(page)
    await drag(page, origin, 30, 210)
    await advance(page, PAST_DRY)
    await dispatch(page, { type: "setColor", hex: YELLOW })
    await drag(page, origin, 30, 110)
    const before = await pixels(page)
    await advance(page, 120)
    const after = await pixels(page)
    // Past where the yellow brush reached, in the blue wash.
    let moved = 0
    for (let x = 124; x <= 140; x += 4)
      moved += distance(rgba(after, x), rgba(before, x))
    return moved
  }
  // Unpaused the blue dried first, and nothing moves in it.
  expect(await bleeding(false)).toBeLessThan(5)
  expect(await bleeding(true)).toBeGreaterThan(20)
})

test("Dry now while paused settles everything, and drying stays paused", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await pause(page)
  await drag(page, origin, 30, 210)
  await advance(page, PAST_DRY)
  await dispatch(page, { type: "dryNow" })
  expect(await isWet(page)).toBe(false)
  expect(await isPaused(page)).toBe(true)
})

/** On the wide canvas, the first tile, row by row: where `heldWash` lies. */
const heldTile = (image: number[]) =>
  Array.from({ length: HEIGHT }, (_, y) =>
    image.slice(y * WIDE * 4, (y * WIDE + 256) * 4)
  ).flat()

/** A wash laid with drying paused and run on until it holds. */
async function heldWash(page: Page, origin: Origin) {
  await pause(page)
  await drag(page, origin, 30, 210)
  await advance(page, PAST_DRY)
  return pixels(page)
}

test("a blot takes from a held wash and leaves it held, while paint beside it moves", async ({
  page,
}) => {
  const origin = await openCanvas(page, WIDE)
  const held = await heldWash(page, origin)
  const before = await drySteps(page)
  // A wash of its own, so the simulation steps on.
  await drag(page, origin, FAR.from, FAR.to)
  await dispatch(page, { type: "setBrush", fluid: null, blot: TISSUE })
  await drag(page, origin, 80, 160)
  const blotted = heldTile(await pixels(page))
  expect(same(blotted, heldTile(held))).toBe(false)
  // Odd, so the copy of the fields current at the end is the other one.
  await advance(page, 101)
  // The blotted wash was not woken, and does not move on.
  expect(same(heldTile(await pixels(page)), blotted)).toBe(true)
  expect(await drySteps(page)).toBe(before)
})

test("undoing paint laid into a held wash puts the held wash back, and it holds while paint beside it moves", async ({
  page,
}) => {
  const origin = await openCanvas(page, WIDE)
  await heldWash(page, origin)
  // A wash of its own, so the simulation steps on after the undo.
  await drag(page, origin, FAR.from, FAR.to)
  const held = heldTile(await pixels(page))
  await dispatch(page, { type: "setColor", hex: YELLOW })
  await drag(page, origin, 60, 120)
  await advance(page, 50)
  await dispatch(page, { type: "undo" })
  expect(same(heldTile(await pixels(page)), held)).toBe(true)
  // Odd, so the copy of the fields current at the end is the other one.
  await advance(page, 101)
  expect(same(heldTile(await pixels(page)), held)).toBe(true)
  expect(await isWet(page)).toBe(true)
})

test("a held wash painted into moves, and holds again when its time comes", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await heldWash(page, origin)
  await dispatch(page, { type: "setColor", hex: YELLOW })
  await drag(page, origin, 60, 120)
  await advance(page, PAST_DRY)
  const held = await pixels(page)
  await advance(page, 101)
  expect(same(await pixels(page), held)).toBe(true)
  expect(await isWet(page)).toBe(true)
})

for (const [name, act] of [
  [
    "a backup export",
    (page: Page) =>
      page.evaluate(() => window.engine.exportDocument().then(() => {})),
  ],
  [
    "an SVG export",
    (page: Page) =>
      page.evaluate(() =>
        window.engine.exportSvg({ raster: "embed" }).then(() => {})
      ),
  ],
] as const)
  test(`paused, ${name} still dries everything first`, async ({ page }) => {
    const origin = await openCanvas(page)
    await heldWash(page, origin)
    await act(page)
    expect(await isWet(page)).toBe(false)
  })

test("paused, a save still dries everything first", async ({ page }) => {
  const origin = await openCanvas(page)
  await heldWash(page, origin)
  await page.evaluate(() => window.engine.save())
  expect(await isWet(page)).toBe(false)
  expect(await isPaused(page)).toBe(true)
})

test("paused, hiding the tab still dries everything", async ({ page }) => {
  const origin = await openCanvas(page)
  await heldWash(page, origin)
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  expect(await isWet(page)).toBe(false)
  await page.evaluate(() => {
    delete (document as { visibilityState?: string }).visibilityState
  })
})

test("paused, the idle flush sends what has settled and leaves the paint wet", async ({
  page,
}) => {
  /** Whether paint is still wet once the idle flush has gone. */
  const wetAfterIdleFlush = async (paused: boolean) => {
    await page.goto(
      process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
    )
    await page.waitForFunction(() => !!window.engine)
    await page.evaluate(
      async ([width, height, colour, id]) => {
        window.fakeCloud = window.createFakeCloud({ width, height })
        window.remountEngine({
          manualFluidClock: true,
          persistence: { documentId: id },
          cloud: { remote: window.fakeCloud.remote, idleMs: 4000 },
        })
        await window.engine.dispatch({
          type: "resize",
          width,
          height,
          devicePixelRatio: 1,
        })
        await window.engine.dispatch({ type: "initialize" })
        await window.engine.dispatch({ type: "setStabilization", strength: 0 })
        await window.engine.dispatch({ type: "setBrush", radius: 12 })
        await window.engine.dispatch({ type: "setColor", hex: colour })
        await window.engine.dispatch({ type: "addLayer" })
      },
      [
        WIDTH,
        HEIGHT,
        BLUE,
        `doc-${Math.random().toString(36).slice(2)}`,
      ] as const
    )
    const box = (await page.locator("canvas").boundingBox())!
    const origin = { x: box.x, y: box.y }
    // Wet paint is in no tile: a dry stroke first gives the flush a tile to
    // send, and is the commit the idle timer waits on.
    await drag(page, origin, 30, 210, 20)
    await dispatch(page, { type: "setBrush", fluid: QUICK })
    if (paused) await pause(page)
    await drag(page, origin, 30, 210, 90)
    // The idle flush is still to come, with the wash wet.
    expect(
      await page.evaluate(() => window.fakeCloud.remote.tileIndex())
    ).toEqual([])
    expect(await isWet(page)).toBe(true)
    await expect
      .poll(() => page.evaluate(() => window.fakeCloud.remote.tileIndex()), {
        timeout: 15_000,
      })
      .not.toEqual([])
    return isWet(page)
  }
  expect(await wetAfterIdleFlush(false)).toBe(false)
  expect(await wetAfterIdleFlush(true)).toBe(true)
})

test("undoing, after drying goes on, paint laid while paused leaves the wash drying from where it is", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await heldWash(page, origin)
  await dispatch(page, { type: "setColor", hex: YELLOW })
  await drag(page, origin, 60, 120)
  await pause(page, false)
  // Back to the held wash, its water still standing: it is given the time
  // to dry, not settled on the next step.
  await dispatch(page, { type: "undo" })
  await advance(page, 5)
  expect(await isWet(page)).toBe(true)
  await advance(page, PAST_DRY)
  expect(await isWet(page)).toBe(false)
})

test("a document imported opens with drying unpaused", async ({ page }) => {
  await openCanvas(page)
  await pause(page)
  await page.evaluate(async () => {
    const backup = await window.engine.exportDocument()
    await window.engine.importDocument(backup)
  })
  expect(await isPaused(page)).toBe(false)
})
