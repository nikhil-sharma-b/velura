import { expect, test, type Page } from "@playwright/test"
import type { Modulator } from "../../engine/brush/dynamics"

const WIDTH = 240
const HEIGHT = 140
const Y = 70
const RADIUS = 6

/**
 * A stroke driven by synthetic pointer events, because a mouse has no pressure
 * and no tilt: Playwright's pointer can only say where. Constructed
 * `PointerEvent`s carry the fields a stylus would report, and they reach the
 * engine through exactly the listeners a real pen does.
 */
type Sample = {
  x: number
  y: number
  pressure: number
  tiltX?: number
  tiltY?: number
}

async function openCanvas(page: Page, dynamics: Modulator[], radius = RADIUS) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([size, brush]) => {
      const { width, height } = size as { width: number; height: number }
      await window.engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      // The pulled string would move the mark away from the pen and blur the
      // comparison; these tests are about what a dab is, not where it is.
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({
        type: "setBrush",
        ...(brush as { radius: number; dynamics: Modulator[] }),
      })
    },
    [
      { width: WIDTH, height: HEIGHT },
      { radius, dynamics },
    ] as const
  )
}

/**
 * Plays a pen gesture into the canvas. `delay` is the wait between samples: it
 * is what makes a stroke slow or fast, since a constructed event's timestamp
 * is the moment it is made and cannot be dictated.
 */
async function pen(page: Page, samples: Sample[], delay = 0) {
  await page.evaluate(
    async ([points, wait]) => {
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
            tiltX: sample.tiltX ?? 0,
            tiltY: sample.tiltY ?? 0,
          })
        )
      const list = points as Sample[]
      send("pointerdown", list[0])
      for (const sample of list.slice(1)) {
        send("pointerrawupdate", sample)
        if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      }
      send("pointerup", list[list.length - 1])
    },
    [samples, delay] as const
  )
}

async function painted(page: Page) {
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

type Image = { width: number; data: number[] }

function level(image: Image, x: number, y: number): number {
  return image.data[(Math.round(y) * image.width + Math.round(x)) * 4]
}

/**
 * The band the stroke is drawn in. The document opens with colour swatches
 * along its top edge, so a column scanned end to end would measure those too.
 */
const BAND = { from: Y - 30, to: Y + 30 }

/** How tall the mark is in one column: the width of the line drawn there. */
function thickness(image: Image, x: number): number {
  let inked = 0
  for (let y = BAND.from; y <= BAND.to; y++)
    if (level(image, x, y) < 128) inked++
  return inked
}

/** The darkest the mark gets in one column. */
function peak(image: Image, x: number): number {
  let darkest = 255
  for (let y = BAND.from; y <= BAND.to; y++)
    darkest = Math.min(darkest, level(image, x, y))
  return darkest
}

/** A straight run at a fixed pen state, sampled every `step` pixels. */
function run(
  from: number,
  to: number,
  step: number,
  state: Omit<Sample, "x" | "y">
): Sample[] {
  const samples: Sample[] = []
  for (let x = from; x <= to; x += step) samples.push({ x, y: Y, ...state })
  return samples
}

test("pressing harder widens the stroke", async ({ page }) => {
  await openCanvas(page, [
    { source: "pressure", target: "size", range: [0.2, 1], mix: "multiply" },
  ])
  // Force ramps from a whisper on the left to a full press on the right.
  const samples = []
  for (let x = 20; x <= 220; x += 5)
    samples.push({ x, y: Y, pressure: (x - 20) / 200 })
  await pen(page, samples)
  const image = await painted(page)

  const light = thickness(image, 40)
  const heavy = thickness(image, 200)
  expect(light).toBeGreaterThan(0)
  expect(heavy).toBeGreaterThan(light * 2)
  // And it is a taper, not a step: the middle sits between the two ends.
  const middle = thickness(image, 120)
  expect(middle).toBeGreaterThan(light)
  expect(middle).toBeLessThan(heavy)
})

test("pressing harder deepens the tone", async ({ page }) => {
  await openCanvas(page, [
    { source: "pressure", target: "flow", range: [0.05, 1], mix: "multiply" },
  ])
  const samples = []
  for (let x = 20; x <= 220; x += 5)
    samples.push({ x, y: Y, pressure: (x - 20) / 200 })
  await pen(page, samples)
  const image = await painted(page)

  expect(peak(image, 200)).toBeLessThan(peak(image, 40) - 40)
})

test("a pressure curve decides how the taper is shaped", async ({ page }) => {
  // The same gesture, once through a curve that suppresses a light touch. The
  // curve is the difference, so the light end must come out thinner.
  const mapping = (curve?: { x: number; y: number }[]): Modulator[] => [
    {
      source: "pressure",
      target: "size",
      range: [0, 1],
      mix: "multiply",
      ...(curve ? { curve } : {}),
    },
  ]
  const samples = []
  for (let x = 20; x <= 220; x += 5)
    samples.push({ x, y: Y, pressure: (x - 20) / 200 })

  await openCanvas(page, mapping())
  await pen(page, samples)
  const linear = thickness(await painted(page), 70)

  await openCanvas(
    page,
    mapping([
      { x: 0, y: 0 },
      { x: 0.5, y: 0.15 },
      { x: 1, y: 1 },
    ])
  )
  await pen(page, samples)
  const shaped = thickness(await painted(page), 70)

  expect(shaped).toBeLessThan(linear)
})

test("tilting the pen shades wider, the way a pencil's side does", async ({
  page,
}) => {
  const dynamics: Modulator[] = [
    { source: "tilt", target: "size", range: [0.4, 1.6], mix: "multiply" },
  ]
  await openCanvas(page, dynamics)
  await pen(page, run(20, 220, 5, { pressure: 0.8, tiltX: 0, tiltY: 0 }))
  const upright = thickness(await painted(page), 120)

  await openCanvas(page, dynamics)
  await pen(page, run(20, 220, 5, { pressure: 0.8, tiltX: 75, tiltY: 0 }))
  const laidOver = thickness(await painted(page), 120)

  expect(upright).toBeGreaterThan(0)
  expect(laidOver).toBeGreaterThan(upright * 1.5)
})

test("tilt direction reaches the graph as its own source", async ({ page }) => {
  // Two pens leaning the same distance over, in opposite directions: only a
  // mapping that reads direction rather than magnitude can tell them apart.
  const dynamics: Modulator[] = [
    {
      source: "tiltDirection",
      target: "size",
      range: [0.4, 1.6],
      mix: "multiply",
    },
  ]
  await openCanvas(page, dynamics)
  await pen(page, run(20, 220, 5, { pressure: 1, tiltX: 60, tiltY: 0 }))
  const leaningRight = thickness(await painted(page), 120)

  await openCanvas(page, dynamics)
  await pen(page, run(20, 220, 5, { pressure: 1, tiltX: -60, tiltY: 0 }))
  const leaningLeft = thickness(await painted(page), 120)

  expect(leaningLeft).toBeGreaterThan(leaningRight)
})

test("drawing faster changes the character of the mark", async ({ page }) => {
  const dynamics: Modulator[] = [
    { source: "velocity", target: "size", range: [1, 0.25], mix: "multiply" },
  ]
  const samples = run(20, 220, 10, { pressure: 1 })

  await openCanvas(page, dynamics)
  // Every sample in one task: the pen crossed the canvas in no time at all.
  await pen(page, samples)
  const fast = thickness(await painted(page), 120)

  await openCanvas(page, dynamics)
  // Ten milliseconds between samples, so the same path is a slow drag.
  await pen(page, samples, 10)
  const slow = thickness(await painted(page), 120)

  expect(slow).toBeGreaterThan(fast)
})

test("a stroke with no dynamics is the brush at its own size", async ({
  page,
}) => {
  await openCanvas(page, [])
  await pen(page, run(20, 220, 5, { pressure: 0.1 }))
  const image = await painted(page)
  // Nothing modulates size, so the faintest touch still draws the full dab.
  // A dab's edge is feathered, so the fully opaque core is a pixel shy of the
  // radius either side.
  expect(thickness(image, 120)).toBeGreaterThanOrEqual(RADIUS * 2 - 2)
})

test("progress through the stroke can taper its tail", async ({ page }) => {
  await openCanvas(page, [
    {
      source: "strokeProgress",
      target: "size",
      range: [1, 0.2],
      mix: "multiply",
    },
  ])
  await pen(page, run(20, 220, 5, { pressure: 1 }))
  const image = await painted(page)
  expect(thickness(image, 40)).toBeGreaterThan(thickness(image, 200))
})
