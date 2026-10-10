import { expect, test, type Page } from "@playwright/test"
import type { BrushGrain } from "../../engine/brush/brush"

/**
 * Grain on a wet brush (live brushes 06), through the engine's command seam
 * and the pixels it presents: the paper shows in the paint a wet brush lays
 * and never in the paint it drags, its scale, depth and movement read as they
 * do for the same brush dry, and the grain-depth target reaches a wet dab.
 *
 * The paper is generated here: stripes eight pixels wide, so which pixels
 * the grain lets take paint is known without reading a shipped texture.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row every stroke is drawn along. */
const ROW = 60
const RADIUS = 12
const RED = "#d0202a"
const BLUE = "#1040e0"
/** One tile of the paper, in its own pixels: half peak, half valley. */
const TILE = 16
/** Stripes along the stroke, so dragging moves paint along them, not across. */
const ROWS = "stripes-rows"
/** Stripes across the stroke. */
const COLUMNS = "stripes-columns"
/**
 * Rows of a stroke along `ROW` over the paper in rows: the middle of a peak,
 * which takes paint whole, and of a valley, which at full depth takes none.
 */
const PEAK = 68
const VALLEY = 60
/** A peak at the paper's own size and a valley at twice it. */
const PEAK_UNTIL_DOUBLED = 52
/** Columns clear of both ends of every stroke drawn here. */
const MIDDLE = [90, 105, 120, 135, 150]

type Origin = { x: number; y: number }

type Command = Parameters<typeof window.engine.dispatch>[0]

type Sample = { x: number; y: number; pressure: number }

/** A fresh engine with an empty layer in hand, a dry red brush and the paper. */
async function openCanvas(page: Page): Promise<Origin> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, radius, colour, tile, rows, columns]) => {
      window.remountEngine()
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
        radius,
        spacing: 0.125,
        dynamics: [],
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
      const stripes = (along: "x" | "y") => {
        const data = new Uint8Array(tile * tile)
        for (let y = 0; y < tile; y++)
          for (let x = 0; x < tile; x++)
            data[y * tile + x] = (along === "x" ? x : y) < tile / 2 ? 255 : 0
        return { width: tile, height: tile, data }
      }
      await window.engine.dispatch({
        type: "registerTexture",
        id: rows,
        texture: stripes("y"),
      })
      await window.engine.dispatch({
        type: "registerTexture",
        id: columns,
        texture: stripes("x"),
      })
    },
    [WIDTH, HEIGHT, RADIUS, RED, TILE, ROWS, COLUMNS] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const dispatch = (page: Page, command: Command) =>
  page.evaluate((command) => window.engine.dispatch(command), command)

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

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

/** How far one pixel is apart in two images, summed over its channels. */
function change(a: number[], b: number[], x: number, y = ROW) {
  let sum = 0
  for (let c = 0; c < 4; c++) {
    const i = (y * WIDTH + x) * 4 + c
    sum += Math.abs(a[i] - b[i])
  }
  return sum
}

/** A mouse drag along the row, waited for as one undo step. */
async function stroke(page: Page, origin: Origin, from: number, to: number) {
  const before = await steps(page)
  await page.mouse.move(origin.x + from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/**
 * A pen's gesture along the row as constructed pointer events, which carry
 * the pressure Playwright's mouse cannot, waited for as one undo step.
 */
async function penStroke(page: Page, samples: Sample[]) {
  const before = await steps(page)
  await page.evaluate((samples) => {
    const canvas = document.querySelector("canvas")!
    const bounds = canvas.getBoundingClientRect()
    const send = (type: string, sample: Sample) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: "pen",
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: bounds.left + sample.x,
          clientY: bounds.top + sample.y,
          pressure: sample.pressure,
        })
      )
    send("pointerdown", samples[0])
    for (const sample of samples.slice(1)) send("pointerrawupdate", sample)
    send("pointerup", samples[samples.length - 1])
  }, samples)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

const grainOf = (
  textureId: string,
  settings: Partial<Omit<BrushGrain, "textureId">> = {}
): BrushGrain => ({ textureId, scale: 1, depth: 1, movement: 0, ...settings })

/**
 * One stroke along the row of an empty layer by a brush on this paper, wet
 * or dry: the layer before it and after.
 */
async function drawn(
  page: Page,
  kind: "wet" | "dry",
  grain: BrushGrain | null,
  pickup = 0
) {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  await dispatch(page, {
    type: "setBrush",
    grain,
    flow: 1,
    wet: kind === "wet" ? { pickup } : null,
  })
  await stroke(page, origin, 40, 200)
  return { empty, image: await pixels(page) }
}

test("a wet brush with grain lays paint the paper has bitten", async ({
  page,
}) => {
  const plain = await drawn(page, "wet", null)
  const bitten = await drawn(page, "wet", grainOf(ROWS))
  const laid = (x: number, y: number) =>
    change(bitten.image, bitten.empty, x, y)
  for (const x of MIDDLE) {
    // The peaks take the colour as a brush with no grain lays it.
    expect(change(bitten.image, plain.image, x, PEAK)).toBeLessThan(8)
    expect(laid(x, PEAK)).toBeGreaterThan(200)
    // And the valleys take none of it.
    expect(laid(x, VALLEY)).toBe(0)
    expect(change(plain.image, plain.empty, x, VALLEY)).toBeGreaterThan(200)
  }
})

for (const [name, grain, pickup] of [
  ["at its own size", grainOf(ROWS), 0],
  ["at twice its size", grainOf(ROWS, { scale: 2 }), 0],
  // Across the stroke a drag would carry paint into the valleys, so these
  // two only lay.
  ["fixed to the canvas", grainOf(COLUMNS), 0],
  ["carried with the brush", grainOf(COLUMNS, { movement: 1 }), 0],
] as const)
  test(`grain ${name} bites a wet stroke where it bites the same brush dry`, async ({
    page,
  }) => {
    const wet = await drawn(page, "wet", grain, pickup)
    const dry = await drawn(page, "dry", grain)
    // Through the middle of every stripe the stroke crosses, either way.
    for (let x = 84; x <= 156; x += 8)
      for (const y of [PEAK_UNTIL_DOUBLED, VALLEY, PEAK])
        expect(
          Math.abs(
            change(wet.image, wet.empty, x, y) -
              change(dry.image, dry.empty, x, y)
          ),
          `at ${x}, ${y}`
        ).toBeLessThan(12)
  })

test("grain scale sizes the paper under a wet stroke", async ({ page }) => {
  const single = await drawn(page, "wet", grainOf(ROWS))
  const doubled = await drawn(page, "wet", grainOf(ROWS, { scale: 2 }))
  for (const x of MIDDLE) {
    expect(
      change(single.image, single.empty, x, PEAK_UNTIL_DOUBLED)
    ).toBeGreaterThan(200)
    expect(change(doubled.image, doubled.empty, x, PEAK_UNTIL_DOUBLED)).toBe(0)
    expect(change(doubled.image, doubled.empty, x, PEAK)).toBeGreaterThan(200)
  }
})

test("grain depth sets how much of a wet stroke the valleys take", async ({
  page,
}) => {
  const plain = await drawn(page, "wet", null)
  const none = await drawn(page, "wet", grainOf(ROWS, { depth: 0 }))
  const half = await drawn(page, "wet", grainOf(ROWS, { depth: 0.5 }), 0)
  const full = await drawn(page, "wet", grainOf(ROWS), 0)
  // At no depth the paper is not there at all.
  expect(none.image).toEqual(plain.image)
  // One dab at the very start of the stroke's reach, where the fewest pile up.
  const x = 40 - RADIUS + 2
  const valley = (of: typeof half) => change(of.image, of.empty, x, VALLEY)
  expect(valley(full)).toBe(0)
  expect(valley(half)).toBeGreaterThan(0)
  expect(valley(half)).toBeLessThan(valley(plain))
})

test("grain movement carries the paper along with a wet stroke", async ({
  page,
}) => {
  const fixed = await drawn(page, "wet", grainOf(COLUMNS), 0)
  const carried = await drawn(page, "wet", grainOf(COLUMNS, { movement: 1 }), 0)
  const laid = (of: typeof fixed, x: number) => change(of.image, of.empty, x)
  // Fixed to the canvas, the stripes are left standing across the stroke.
  expect(laid(fixed, 100)).toBeGreaterThan(200)
  expect(laid(fixed, 108)).toBe(0)
  // Carried, every pixel is passed over by a peak, and none is left bare.
  for (let x = 84; x <= 156; x += 4)
    expect(laid(carried, x)).toBeGreaterThan(200)
})

test("with flow zero grain leaves pickup invisible on the layer", async ({
  page,
}) => {
  /** A dry bar, dragged out by a wet brush that lays nothing. */
  async function dragged(grain: BrushGrain | null) {
    const origin = await openCanvas(page)
    await stroke(page, origin, 40, 110)
    const painted = await pixels(page)
    await dispatch(page, { type: "setColor", hex: BLUE })
    await dispatch(page, {
      type: "setBrush",
      grain,
      flow: 0,
      wet: { pickup: 0.9 },
    })
    await page.mouse.move(origin.x + 80, origin.y + ROW)
    await page.mouse.down()
    await page.mouse.move(origin.x + 170, origin.y + ROW, { steps: 30 })
    await page.mouse.up()
    await frames(page)
    return { painted, image: await pixels(page) }
  }
  const plain = await dragged(null)
  const withGrain = await dragged(grainOf(ROWS))
  expect(plain.image).toEqual(plain.painted)
  expect(withGrain.image).toEqual(plain.image)
})

test("grain does not bite the paint picked into the reservoir", async ({
  page,
}) => {
  async function carried(pickupGrain: BrushGrain | null) {
    const origin = await openCanvas(page)
    await dispatch(page, { type: "setBrush", grain: grainOf(COLUMNS), flow: 1 })
    await stroke(page, origin, 40, 100)
    const painted = await pixels(page)
    await dispatch(page, { type: "setColor", hex: BLUE })
    await dispatch(page, {
      type: "setBrush",
      grain: pickupGrain,
      flow: 0,
      wet: { pickup: 1 },
    })
    await page.mouse.move(origin.x + 70, origin.y + ROW)
    await page.mouse.down()
    await frames(page)
    // The picked load is then laid with no further pickup or paper bite.
    await dispatch(page, {
      type: "setBrush",
      grain: null,
      flow: 1,
      dynamics: [
        {
          source: "velocity",
          target: "pickup",
          range: [0, 0],
          mix: "multiply",
        },
      ],
    })
    await page.mouse.move(origin.x + 180, origin.y + ROW, { steps: 30 })
    await page.mouse.up()
    return { painted, image: await pixels(page) }
  }
  const plain = await carried(null)
  const withGrain = await carried(grainOf(COLUMNS))
  expect(withGrain.image).toEqual(plain.image)
  expect(change(plain.image, plain.painted, 175)).toBeGreaterThan(200)
  const picked = plain.image.slice(
    (ROW * WIDTH + 175) * 4,
    (ROW * WIDTH + 175) * 4 + 4
  )
  expect(picked).toEqual([208, 32, 42, 255])
})

test("the grain-depth dynamics target changes the bite along a wet stroke", async ({
  page,
}) => {
  await openCanvas(page)
  const empty = await pixels(page)
  await dispatch(page, {
    type: "setBrush",
    grain: grainOf(ROWS),
    flow: 1,
    wet: { pickup: 0 },
    // Heavier pressure flattens the tooth, so the bite falls as force rises.
    dynamics: [
      {
        source: "pressure",
        target: "grainDepth",
        range: [1, 0],
        mix: "replace",
      },
    ],
  })
  // Lightly along the first half of the row, then pressed along the second.
  const samples: Sample[] = []
  for (let x = 40; x <= 200; x += 2)
    samples.push({ x, y: ROW, pressure: x < 120 ? 0.01 : 1 })
  await penStroke(page, samples)
  const image = await pixels(page)
  const laid = (x: number, y: number) => change(image, empty, x, y)
  // The peaks take the colour the whole way.
  for (const x of [70, 90, 160, 180]) expect(laid(x, PEAK)).toBeGreaterThan(200)
  // The valleys only where the pen pressed: the light touch is not quite no
  // pressure, so each dab leaves a trace there and no more.
  for (const x of [70, 90]) expect(laid(x, VALLEY)).toBeLessThan(60)
  for (const x of [160, 180]) expect(laid(x, VALLEY)).toBeGreaterThan(200)
})
