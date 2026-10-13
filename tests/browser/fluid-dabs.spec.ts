import { expect, test, type Page } from "@playwright/test"
import type { Modulator } from "../../engine/brush/dynamics"

/**
 * A fluid dab is a full brush dab (fluid brushes 10), through the engine's
 * command seam and the pixels it presents: the tip, the dynamics graph,
 * scatter and colour jitter reach the paint a fluid brush lays as they reach
 * a dry brush's, and the graph drives the water and pigment a dab carries.
 *
 * The simulation's clock is stopped here and stepped by command, so paint is
 * read where the dabs laid it unless a test runs it on.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row strokes are drawn along, and the column single dabs land on. */
const ROW = 60
const MIDDLE = 120
const BLUE = "#1040e0"
const FLUID = { water: 0.5, drying: 0.5, bleed: 0, edge: 0, granulation: 0 }

type Brush = Record<string, unknown>
type Sample = { x: number; y: number; pressure: number }

async function openCanvas(page: Page, brush: Brush = {}) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, fluid, brush]) => {
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
      // Half a tile, a white square with its right half cut away, and a set
      // of two frames: one that lays everything and one that lays nothing.
      await window.engine.dispatch({
        type: "registerTexture",
        id: "left-half",
        texture: {
          width: 2,
          height: 1,
          data: new Uint8Array([255, 0]),
        },
      })
      await window.engine.dispatch({
        type: "registerTexture",
        id: "on-off",
        texture: {
          width: 1,
          height: 1,
          frameCount: 2,
          data: new Uint8Array([255, 0]),
        },
      })
      await window.engine.dispatch({
        type: "registerTexture",
        id: "square",
        texture: { width: 1, height: 1, data: new Uint8Array([255]) },
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        feather: 1,
        spacing: 0.125,
        opacity: 1,
        flow: 1,
        dynamics: [],
        fluid,
        ...brush,
      })
    },
    [WIDTH, HEIGHT, BLUE, FLUID, brush] as const
  )
}

/**
 * Plays a gesture into the canvas as a pen's, or a mouse's: a mouse has no
 * force sensor, and what it reports as pressure is a stand-in.
 */
async function pen(
  page: Page,
  samples: Sample[],
  pointerType: "pen" | "mouse" = "pen"
) {
  await page.evaluate(
    async ([points, pointerType]) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (type: string, sample: (typeof points)[number]) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: bounds.left + sample.x,
            clientY: bounds.top + sample.y,
            pressure: sample.pressure,
          })
        )
      send("pointerdown", points[0])
      for (const sample of points.slice(1)) send("pointerrawupdate", sample)
      send("pointerup", points[points.length - 1])
      // The last dabs are laid by the frame after the pen lifts.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    },
    [samples, pointerType] as const
  )
}

/** A stroke along the row, its pressure running from one value to another. */
function run(from: number, to: number, pressure: number, until = pressure) {
  const samples: Sample[] = []
  for (let x = from; x <= to; x += 4)
    samples.push({
      x,
      y: ROW,
      pressure: pressure + ((until - pressure) * (x - from)) / (to - from),
    })
  return samples
}

/** One dab, where the pen touches and lifts. */
const tap = (x = MIDDLE, pressure = 1) => [{ x, y: ROW, pressure }]

async function pixels(page: Page) {
  return page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
    return Array.from((await window.engine.readPixels()).data)
  })
}

const rgba = (image: number[], x: number, y = ROW) =>
  image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)

/** How far a pixel is from the bare paper in a corner, over its channels. */
const ink = (image: number[], x: number, y = ROW) => {
  const paper = rgba(image, 2, 2)
  return rgba(image, x, y).reduce(
    (sum, channel, index) => sum + Math.abs(channel - paper[index]),
    0
  )
}

/** Enough that a pixel holds paint and not a rounding of the paper. */
const PAINTED = 24

/** How many pixels of a column hold paint. */
const tall = (image: number[], x: number) =>
  Array.from({ length: HEIGHT }, (_, y) => ink(image, x, y)).filter(
    (amount) => amount > PAINTED
  ).length

const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

const scaledBy = (
  source: Modulator["source"],
  target: Modulator["target"],
  low = 0,
  high = 1
): Modulator => ({ source, target, range: [low, high], mix: "multiply" })

test("a textured tip lays fluid paint in the tip's shape", async ({ page }) => {
  await openCanvas(page, { radius: 24, tipTextureId: "left-half" })
  await pen(page, tap())
  const image = await pixels(page)
  expect(ink(image, MIDDLE - 12)).toBeGreaterThan(PAINTED)
  expect(ink(image, MIDDLE + 12)).toBeLessThan(PAINTED)
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(true)
})

test("a turned tip lays paint out to its corners, past the dab's radius", async ({
  page,
}) => {
  // A square tip an eighth of a turn round stands on a corner: the corner
  // is the radius and nearly half again from the middle, along the row.
  await openCanvas(page, { radius: 24, tipTextureId: "square", angle: 0.125 })
  await pen(page, tap())
  const image = await pixels(page)
  expect(ink(image, MIDDLE + 29)).toBeGreaterThan(PAINTED)
  expect(ink(image, MIDDLE - 29)).toBeGreaterThan(PAINTED)
  // And no further: the corner is 34 px out.
  expect(ink(image, MIDDLE + 40)).toBeLessThan(PAINTED)
  // Off the diagonal the square's side is nearer than its corner.
  expect(ink(image, MIDDLE + 21, ROW + 21)).toBeLessThan(PAINTED)
})

test("a tip of several frames lays each fluid dab with the frame the brush chose", async ({
  page,
}) => {
  // Dabs a diameter apart, so each is on its own: every other one is the
  // frame that lays nothing.
  await openCanvas(page, {
    radius: 10,
    spacing: 1,
    tipTextureId: "on-off",
    tipSelection: "sequential",
  })
  await pen(page, run(30, 210, 1))
  const image = await pixels(page)
  const laid = [30, 50, 70, 90, 110].map((x) => ink(image, x) > PAINTED)
  expect(laid).toEqual([true, false, true, false, true])
})

test("roundness squashes a fluid dab and angle turns it", async ({ page }) => {
  await openCanvas(page, { radius: 24, roundness: 0.25 })
  await pen(page, tap())
  const flat = await pixels(page)
  // Long along the row, a quarter as deep across it.
  expect(ink(flat, MIDDLE + 16)).toBeGreaterThan(PAINTED)
  expect(ink(flat, MIDDLE, ROW + 16)).toBeLessThan(PAINTED)

  await openCanvas(page, { radius: 24, roundness: 0.25, angle: 0.25 })
  await pen(page, tap())
  const turned = await pixels(page)
  expect(ink(turned, MIDDLE + 16)).toBeLessThan(PAINTED)
  expect(ink(turned, MIDDLE, ROW + 16)).toBeGreaterThan(PAINTED)
})

test("size, angle and roundness dynamics shape fluid dabs as they shape dry ones", async ({
  page,
}) => {
  await openCanvas(page, {
    radius: 20,
    dynamics: [scaledBy("pressure", "size", 0.2, 1)],
  })
  await pen(page, run(40, 200, 0.1, 1))
  const tapered = await pixels(page)
  expect(tall(tapered, 190)).toBeGreaterThan(tall(tapered, 90) + 8)

  await openCanvas(page, {
    radius: 20,
    dynamics: [scaledBy("pressure", "roundness", 0.2, 1)],
  })
  await pen(page, run(40, 200, 0.1, 1))
  const squashed = await pixels(page)
  expect(tall(squashed, 190)).toBeGreaterThan(tall(squashed, 90) + 8)

  // A quarter turn stands the squashed dab up across the row.
  const turn: Modulator = {
    source: "pressure",
    target: "angle",
    range: [0, 0.25],
    mix: "add",
  }
  await openCanvas(page, { radius: 20, roundness: 0.25, dynamics: [turn] })
  await pen(page, run(40, 200, 0, 1))
  const stood = await pixels(page)
  expect(tall(stood, 190)).toBeGreaterThan(tall(stood, 90) + 8)
})

test("scatter throws fluid dabs off the path", async ({ page }) => {
  await openCanvas(page, { radius: 6, spacing: 0.5 })
  await pen(page, run(40, 200, 1))
  const kept = await pixels(page)
  await openCanvas(page, {
    radius: 6,
    spacing: 0.5,
    scatter: { amount: 4, count: 2, axes: "across" },
  })
  await pen(page, run(40, 200, 1))
  const thrown = await pixels(page)
  const reach = (image: number[]) =>
    Array.from({ length: HEIGHT }, (_, y) => y).filter((y) =>
      Array.from({ length: 160 }, (_, i) => 40 + i).some(
        (x) => ink(image, x, y) > PAINTED
      )
    ).length
  expect(reach(thrown)).toBeGreaterThan(reach(kept) + 12)
})

test("colour jitter reaches the pigment a fluid dab lays", async ({ page }) => {
  await openCanvas(page)
  await pen(page, run(40, 200, 1))
  const plain = rgba(await pixels(page), MIDDLE)

  const third: Modulator = {
    source: "random",
    target: "hue",
    range: [1 / 3, 1 / 3],
    mix: "replace",
  }
  await openCanvas(page, { dynamics: [third] })
  await pen(page, run(40, 200, 1))
  const turned = rgba(await pixels(page), MIDDLE)
  // Blue a third of a turn on is red: the wash is no longer bluest.
  expect(plain[2]).toBeGreaterThan(plain[0])
  expect(turned[0]).toBeGreaterThan(turned[2])
})

test("pressure mapped to opacity lays more pigment at a hard press, dab by dab", async ({
  page,
}) => {
  await openCanvas(page, {
    flow: 0.05,
    dynamics: [scaledBy("pressure", "opacity", 0.1, 1)],
  })
  await pen(page, run(40, 200, 0.1, 1))
  const image = await pixels(page)
  expect(ink(image, 60)).toBeGreaterThan(0)
  expect(ink(image, 180)).toBeGreaterThan(ink(image, 60) * 2)
})

test("pressure mapped to water lays more water at a hard press", async ({
  page,
}) => {
  // On CI's software GPU a run of the simulation is most of a minute.
  test.slow()
  // A brush that floods the paper at its full water: only water standing
  // deeper than the paper holds pushes the damp edge outward.
  const flooding = {
    radius: 16,
    flow: 0.3,
    fluid: { ...FLUID, water: 1, drying: 0.2 },
    dynamics: [scaledBy("pressure", "water")],
  }
  const spread = async (pressure: number) => {
    await openCanvas(page, flooding)
    await pen(page, run(70, 170, pressure))
    const laid = tall(await pixels(page), MIDDLE)
    await advance(page, 400)
    return tall(await pixels(page), MIDDLE) - laid
  }
  const light = await spread(0.3)
  const hard = await spread(1)
  expect(hard).toBeGreaterThan(light + 4)
})

test("with no pressure sensor the brush lays its set water and colour", async ({
  page,
}) => {
  const mapped = [
    scaledBy("pressure", "water"),
    scaledBy("pressure", "opacity"),
    scaledBy("pressure", "size", 0.2, 1),
  ]
  await openCanvas(page)
  await pen(page, run(40, 200, 0.5), "mouse")
  const set = await pixels(page)
  await openCanvas(page, { dynamics: mapped })
  await pen(page, run(40, 200, 0.5), "mouse")
  expect(await pixels(page)).toEqual(set)
  // And it laid paint: the two are not alike for being empty.
  expect(ink(set, MIDDLE)).toBeGreaterThan(PAINTED)
})

test("accumulation has no effect on a fluid brush", async ({ page }) => {
  await openCanvas(page, { accumulation: "coverage", flow: 0.3 })
  await pen(page, run(40, 200, 1))
  const coverage = await pixels(page)
  await openCanvas(page, { accumulation: "buildup", flow: 0.3 })
  await pen(page, run(40, 200, 1))
  expect(await pixels(page)).toEqual(coverage)
  expect(ink(coverage, MIDDLE)).toBeGreaterThan(PAINTED)
})

test("a fluid brush lays dabs closer than the wet spacing floor", async ({
  page,
}) => {
  // A 2 px brush at a tenth of its diameter: the wet floor would hold its
  // dabs 4 px apart, ten times what it asks for.
  await openCanvas(page, { radius: 1, spacing: 0.1, feather: 0 })
  await page.evaluate(() => {
    const counted = window as unknown as { stamps: number }
    counted.stamps = 0
    window.engine.observeFrames((frame) => (counted.stamps += frame.stamps))
  })
  await pen(page, run(40, 200, 1))
  // 160 px at 0.2 px a dab is 800; at the floor it would be 40. A frame is
  // reported once the GPU has drawn it.
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { stamps: number }).stamps)
    )
    .toBeGreaterThan(400)
})
