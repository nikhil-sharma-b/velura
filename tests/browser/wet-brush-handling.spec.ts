import { expect, test, type Page } from "@playwright/test"
import type { Modulator } from "../../engine/brush/dynamics"
import type { TipSelectionMode } from "../../engine/brush/tip-sets"

/**
 * A wet brush handling like a brush (live brushes 03), through the engine's
 * command seam and the pixels it presents: its dynamics reach each wet dab,
 * a tip of several frames gives each dab the frame the brush would have
 * drawn, a selection limits what a wet stroke writes and not what it reads,
 * and scatter and colour jitter are left out.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and dragged along. */
const ROW = 60
const RADIUS = 12
const RED = "#d0202a"
const BLUE = "#1040e0"
const PICKUP = 0.5
/** The selected box, which every crossing stroke enters by its left edge. */
const BOX = { x: 120, y: 30, width: 60, height: 60 }
/** A dry bar that stops flush against the box's left edge. */
const BAR = { from: 40, to: 150 }

type Origin = { x: number; y: number }

type Command = Parameters<typeof window.engine.dispatch>[0]

/** A fresh engine with an empty layer in hand and a dry red brush. */
async function openCanvas(page: Page): Promise<Origin> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, radius, colour]) => {
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
      await window.engine.dispatch({ type: "setBrush", radius, spacing: 0.125 })
      await window.engine.dispatch({ type: "setColor", hex: colour })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [WIDTH, HEIGHT, RADIUS, RED] as const
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

/** The selection's coverage, one byte per document pixel. */
const coverage = (page: Page) =>
  page.evaluate(async () =>
    Array.from((await window.engine.readSelection())!.data)
  )

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

/** How many pixels of one column the stroke changed: the mark's width there. */
function thickness(image: number[], empty: number[], x: number) {
  let changed = 0
  for (let y = 0; y < HEIGHT; y++) if (change(image, empty, x, y) > 0) changed++
  return changed
}

/** Every channel of the pixels the predicate picks. */
function pick(image: number[], wanted: (x: number, y: number) => boolean) {
  const out: number[] = []
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      if (wanted(x, y))
        out.push(...image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4))
  return out
}

const inBox = (x: number, y: number) =>
  x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height

const outBox = (x: number, y: number) => !inBox(x, y)

type Sample = { x: number; y: number; pressure: number }

/**
 * Plays one device's gesture into the canvas as constructed pointer events,
 * which carry the pressure a stylus would report and Playwright's mouse
 * cannot.
 */
async function play(
  page: Page,
  samples: Sample[],
  pointerType: "pen" | "mouse" = "pen"
) {
  await page.evaluate(
    ([samples, pointerType]) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (type: string, sample: Sample) =>
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
      send("pointerdown", samples[0])
      for (const sample of samples.slice(1)) send("pointerrawupdate", sample)
      send("pointerup", samples[samples.length - 1])
    },
    [samples, pointerType] as const
  )
}

/** A played gesture that is expected to land as one undo step, waited for. */
async function penStroke(
  page: Page,
  samples: Sample[],
  pointerType: "pen" | "mouse" = "pen"
) {
  const before = await steps(page)
  await play(page, samples, pointerType)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/** A run along the row, the pressure going evenly from one value to another. */
function run(
  from: number,
  to: number,
  pressure: number | [number, number],
  y = ROW
): Sample[] {
  const [first, last] =
    typeof pressure === "number" ? [pressure, pressure] : pressure
  const count = Math.abs(to - from) / 2
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: from + ((to - from) * i) / count,
    y,
    pressure: first + ((last - first) * i) / count,
  }))
}

async function drag(page: Page, origin: Origin, from: number, to: number) {
  await page.mouse.move(origin.x + from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
}

/** A drag that is expected to land as one undo step, waited for. */
async function stroke(page: Page, origin: Origin, from: number, to: number) {
  const before = await steps(page)
  await drag(page, origin, from, to)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/** A drag that is expected to change nothing, given time to have done so. */
async function idleDrag(page: Page, origin: Origin, from: number, to: number) {
  await drag(page, origin, from, to)
  await frames(page)
}

const setWet = (page: Page, flow?: number, pickup = PICKUP) =>
  dispatch(page, { type: "setBrush", wet: { pickup }, flow })

const select = (page: Page, box = BOX) =>
  dispatch(page, { type: "selectShape", shape: "rect", ...box })

/**
 * One stroke on an empty layer, by a brush with these dynamics, wet or dry:
 * the layer before it and after.
 */
async function drawn(
  page: Page,
  kind: "wet" | "dry",
  brush: Omit<Extract<Command, { type: "setBrush" }>, "type">,
  samples: Sample[],
  pointerType: "pen" | "mouse" = "pen"
) {
  await openCanvas(page)
  const empty = await pixels(page)
  await dispatch(page, { type: "setBrush", ...brush })
  if (kind === "wet") await setWet(page, undefined, 0)
  await penStroke(page, samples, pointerType)
  return { empty, image: await pixels(page) }
}

const SIZE_BY_PRESSURE: Modulator[] = [
  { source: "pressure", target: "size", range: [0.2, 1], mix: "multiply" },
]

test("pressing harder widens a wet stroke along its length, as it does a dry one", async ({
  page,
}) => {
  const samples = run(30, 210, [0.1, 1])
  const wet = await drawn(page, "wet", { dynamics: SIZE_BY_PRESSURE }, samples)
  const dry = await drawn(page, "dry", { dynamics: SIZE_BY_PRESSURE }, samples)

  const wide = (x: number) => thickness(wet.image, wet.empty, x)
  expect(wide(60)).toBeLessThan(wide(120))
  expect(wide(120)).toBeLessThan(wide(190))
  for (const x of [60, 120, 190])
    expect(
      Math.abs(wide(x) - thickness(dry.image, dry.empty, x))
    ).toBeLessThanOrEqual(3)
})

test("pressing harder lays more of a wet brush's colour", async ({ page }) => {
  const { empty, image } = await drawn(
    page,
    "wet",
    {
      dynamics: [
        {
          source: "pressure",
          target: "flow",
          range: [0.02, 0.6],
          mix: "multiply",
        },
      ],
    },
    run(30, 210, [0.1, 1])
  )
  const laid = (x: number) => change(image, empty, x)
  expect(laid(60)).toBeGreaterThan(0)
  expect(laid(60)).toBeLessThan(laid(120))
  expect(laid(120)).toBeLessThan(laid(190))
})

test("roundness dynamics squash the wet dab", async ({ page }) => {
  const dynamics: Modulator[] = [
    {
      source: "pressure",
      target: "roundness",
      range: [0.2, 1],
      mix: "multiply",
    },
  ]
  const light = await drawn(page, "wet", { dynamics }, run(40, 200, 0.1))
  const hard = await drawn(page, "wet", { dynamics }, run(40, 200, 1))
  // The tip is squashed across the stroke, so a squashed one draws thinner.
  expect(thickness(light.image, light.empty, 120)).toBeLessThan(
    thickness(hard.image, hard.empty, 120) - 6
  )
})

test("angle dynamics turn the wet dab", async ({ page }) => {
  // A flat tip lying along the stroke, stood upright by a hard press.
  const brush = {
    roundness: 0.25,
    dynamics: [
      { source: "pressure", target: "angle", range: [0, 0.25], mix: "add" },
    ] satisfies Modulator[],
  }
  const lying = await drawn(page, "wet", brush, run(40, 200, 0.02))
  const upright = await drawn(page, "wet", brush, run(40, 200, 1))
  expect(thickness(lying.image, lying.empty, 120)).toBeLessThan(
    thickness(upright.image, upright.empty, 120) - 6
  )
})

test("a wet brush's dabs close up as dynamics shrink them", async ({
  page,
}) => {
  // At rest the dabs are a radius apart: laid at that pitch, a dab a tenth
  // the size would leave gaps many times its own width.
  const { empty, image } = await drawn(
    page,
    "wet",
    {
      spacing: 0.5,
      dynamics: [
        { source: "pressure", target: "size", range: [0, 1], mix: "multiply" },
      ],
    },
    run(40, 200, 0.12)
  )
  for (let x = 50; x <= 190; x++)
    expect(change(image, empty, x), `column ${x}`).toBeGreaterThan(0)
})

test("a wet brush's dabs are never under a pixel apart", async ({ page }) => {
  await openCanvas(page)
  // A dab shrunk to where its spacing would be a small fraction of a pixel.
  await dispatch(page, {
    type: "setBrush",
    spacing: 0.02,
    dynamics: [
      { source: "pressure", target: "size", range: [0, 1], mix: "multiply" },
    ],
  })
  await setWet(page)
  await page.evaluate(() => {
    const counted = window as unknown as { dabs: number }
    counted.dabs = 0
    window.engine.observeFrames((frame) => (counted.dabs += frame.stamps))
  })
  await penStroke(page, run(40, 200, 0.1))
  await frames(page)
  const dabs = await page.evaluate(
    () => (window as unknown as { dabs: number }).dabs
  )
  expect(dabs).toBeGreaterThan(100)
  // One for each pixel of the path, and one to open it.
  expect(dabs).toBeLessThanOrEqual(161)
})

test("a device with no force sensor draws a wet brush at its settings", async ({
  page,
}) => {
  const dynamics: Modulator[] = [
    { source: "pressure", target: "size", range: [0.2, 1], mix: "multiply" },
    { source: "pressure", target: "flow", range: [0.05, 1], mix: "multiply" },
  ]
  const samples = run(40, 200, 0.5)
  const mapped = await drawn(page, "wet", { dynamics }, samples, "mouse")
  const plain = await drawn(page, "wet", { dynamics: [] }, samples, "mouse")
  expect(mapped.image).toEqual(plain.image)
  // A pen that says how hard it is pressed is listened to.
  const pen = await drawn(page, "wet", { dynamics }, run(40, 200, 0.3))
  expect(thickness(pen.image, pen.empty, 120)).toBeLessThan(
    thickness(plain.image, plain.empty, 120) - 6
  )
})

const PICKUP_BY_PRESSURE: Modulator[] = [
  { source: "pressure", target: "pickup", range: [0, 1], mix: "multiply" },
]
/** Two short dry bars on the row, alike but for where they are. */
const BARS = [
  { from: 60, to: 75 },
  { from: 150, to: 165 },
]
/** The middle of each bar, where a dab that drags pulls its paint away. */
const MIDDLE = BARS.map((bar) => Math.round((bar.from + bar.to) / 2))

/**
 * One stroke that lays nothing along the row, over the two bars: the layer
 * with the bars on it and after the stroke.
 */
async function draggedOverBars(
  page: Page,
  dynamics: Modulator[],
  samples: Sample[],
  pointerType: "pen" | "mouse" = "pen"
) {
  const origin = await openCanvas(page)
  for (const bar of BARS) await stroke(page, origin, bar.from, bar.to)
  const painted = await pixels(page)
  await dispatch(page, { type: "setBrush", dynamics })
  await dispatch(page, { type: "setColor", hex: BLUE })
  // A small flow reveals what pickup retained on the bristles.
  await setWet(page, 0.1, 0.9)
  await penStroke(page, samples, pointerType)
  return { painted, image: await pixels(page) }
}

test("pressing harder drags more paint along a wet stroke's length", async ({
  page,
}) => {
  const samples = run(20, 230, [0.05, 1])
  const mapped = await draggedOverBars(page, PICKUP_BY_PRESSURE, samples)
  const plain = await draggedOverBars(page, [], samples)
  // Light pressure preserves more of the initial blue load over the first red bar.
  const blue = (image: number[], x: number) => image[(ROW * WIDTH + x) * 4 + 2]
  expect(blue(mapped.image, MIDDLE[0])).toBeGreaterThan(
    blue(plain.image, MIDDLE[0]) + 10
  )
  expect(mapped.image).not.toEqual(plain.image)
})

test("a device with no force sensor runs a wet brush's pickup at its setting", async ({
  page,
}) => {
  const samples = run(20, 230, 0.2)
  const mapped = await draggedOverBars(
    page,
    PICKUP_BY_PRESSURE,
    samples,
    "mouse"
  )
  const plain = await draggedOverBars(page, [], samples, "mouse")
  expect(mapped.image).toEqual(plain.image)
  expect(change(plain.image, plain.painted, MIDDLE[1])).toBeGreaterThan(0)
  // A pen that says how lightly it is pressed is listened to.
  const pen = await draggedOverBars(page, PICKUP_BY_PRESSURE, samples)
  expect(pen.image).not.toEqual(plain.image)
})

/**
 * Down to the right and back up, pressing harder all the way: a path on
 * which every way of choosing a frame chooses more than one.
 */
const VEE: Sample[] = [
  ...run(30, 120, [0.1, 0.55]).map((sample, i, all) => ({
    ...sample,
    y: 30 + (60 * i) / (all.length - 1),
  })),
  ...run(122, 210, [0.56, 1]).map((sample, i, all) => ({
    ...sample,
    y: 90 - (60 * (i + 1)) / all.length,
  })),
]

for (const tipSelection of [
  "sequential",
  "random",
  "direction",
  "pressure",
] satisfies TipSelectionMode[])
  test(`choosing by ${tipSelection}, a wet dab is the frame of the tip the brush would have drawn`, async ({
    page,
  }) => {
    /** Which pixels a stroke of the two-frame tip marked. */
    async function marked(kind: "wet" | "dry") {
      await openCanvas(page)
      // A tip whose first frame covers nothing and whose second covers the
      // dab, laid edge to edge: a dab is there or it is not.
      await dispatch(page, {
        type: "registerTexture",
        id: "blank-then-full",
        texture: {
          width: 1,
          height: 1,
          frameCount: 2,
          data: new Uint8Array([0, 255]),
        },
      })
      const empty = await pixels(page)
      await dispatch(page, {
        type: "setBrush",
        tipTextureId: "blank-then-full",
        tipSelection,
        spacing: 1,
      })
      if (kind === "wet") await setWet(page, undefined, 0)
      await penStroke(page, VEE)
      const image = await pixels(page)
      return Array.from({ length: WIDTH * HEIGHT }, (_, i) =>
        change(image, empty, i % WIDTH, Math.floor(i / WIDTH)) > 0 ? 1 : 0
      )
    }
    const wet = await marked("wet")
    const dry = await marked("dry")
    const covered = dry.reduce<number>((sum, on) => sum + on, 0)
    const apart = dry.reduce<number>(
      (sum, on, i) => sum + (on === wet[i] ? 0 : 1),
      0
    )
    // Some dabs drew and some did not, and the wet stroke's are the same
    // ones, give or take the pixels along their edges.
    expect(covered).toBeGreaterThan(24 * 24)
    expect(covered).toBeLessThan(8 * 24 * 24)
    expect(apart).toBeLessThan(covered * 0.05)
  })

/** The bar painted beside the box, which holds none, and a wet blue brush. */
async function openPainted(page: Page, flow: number) {
  const origin = await openCanvas(page)
  await select(page)
  await dispatch(page, { type: "invertSelection" })
  await stroke(page, origin, BAR.from, BAR.to)
  await dispatch(page, { type: "deselect" })
  const painted = await pixels(page)
  await dispatch(page, { type: "setColor", hex: BLUE })
  await setWet(page, flow)
  return { origin, painted }
}

test("a wet stroke across the selection's edge changes nothing outside it, and carries outside paint in", async ({
  page,
}) => {
  // A lightly loaded brush from the bar into the box.
  const { origin, painted } = await openPainted(page, 0.1)
  await select(page)
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)
  expect(pick(mixed, outBox)).toEqual(pick(painted, outBox))
  // The red in the box was picked up outside the selection.
  expect(change(mixed, painted, 130)).toBeGreaterThan(0)
  const [r, g, b] = mixed.slice((ROW * WIDTH + 130) * 4)
  const [r0, g0, b0] = painted.slice((ROW * WIDTH + 130) * 4)
  expect(r - g).toBeGreaterThan(r0 - g0)
  expect(r - b).toBeGreaterThan(r0 - b0)
})

test("a wet stroke lays its colour inside the selection and not outside it", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page, 0.5)
  await setWet(page, 1, 0)
  await select(page)
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)

  expect(pick(mixed, outBox)).toEqual(pick(painted, outBox))
  const [r, , b] = mixed.slice((ROW * WIDTH + 150) * 4)
  expect(b).toBeGreaterThan(r)
})

test("along a feathered edge a wet stroke lays in proportion to the selection's strength", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const empty = await pixels(page)
  // Thin enough that the dabs over a pixel do not fill it between them.
  await setWet(page, 0.03, 0)
  await select(page)
  await dispatch(page, { type: "featherSelection", radius: 8 })
  const mask = await coverage(page)
  await stroke(page, origin, 60, 150)
  const laid = await pixels(page)

  // Where nothing is selected, nothing changed.
  expect(pick(laid, (x, y) => mask[y * WIDTH + x] === 0)).toEqual(
    pick(empty, (x, y) => mask[y * WIDTH + x] === 0)
  )
  // Up the feather's skirt, the more of a pixel is selected the more of the
  // colour it took, and none took all of it.
  const at = (x: number) => mask[ROW * WIDTH + x]
  const skirt = Array.from({ length: BOX.x + 8 }, (_, x) => x).filter(
    (x) => at(x) > 8 && at(x) < 200
  )
  expect(skirt.length).toBeGreaterThan(4)
  const taken = skirt.map((x) => change(laid, empty, x))
  expect(taken[0]).toBeGreaterThan(0)
  expect(taken).toEqual([...taken].sort((a, b) => a - b))
  expect(taken[taken.length - 1]).toBeGreaterThan(taken[0])
  expect(taken[taken.length - 1]).toBeLessThan(change(laid, empty, 145))
})

test("a wet stroke wholly outside the selection changes nothing and is not a step", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page, 0.5)
  await select(page)
  const before = await steps(page)
  // Stopping short of the box by more than the dab's reach.
  await idleDrag(page, origin, 15, 70)
  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
})

test("a wet stroke in a selection is one undo step, and redo brings it back", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page, 0.3)
  await select(page)
  const selected = await page.evaluate(
    () => window.engine.getSnapshot().selection
  )
  const mask = await coverage(page)
  const before = await steps(page)
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)
  expect(mixed).not.toEqual(painted)
  expect(await steps(page)).toBe(before + 1)

  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(painted)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection)
  ).toEqual(selected)
  expect(await coverage(page)).toEqual(mask)
  await dispatch(page, { type: "redo" })
  expect(await pixels(page)).toEqual(mixed)
})

test("a wet stroke in a selection cancelled mid-stroke leaves the layer unchanged", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page, 0.3)
  await select(page)
  const before = await steps(page)

  await page.mouse.move(origin.x + 80, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + 160, origin.y + ROW, { steps: 30 })
  // The stroke is in the layer while the pen is still down.
  expect(await pixels(page)).not.toEqual(painted)
  await dispatch(page, { type: "undo" })
  await page.mouse.up()

  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
  // And the selection still takes a stroke afterwards.
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)
  expect(pick(mixed, inBox)).not.toEqual(pick(painted, inBox))
  expect(pick(mixed, outBox)).toEqual(pick(painted, outBox))
})

test("a vector layer is not painted by a wet brush", async ({ page }) => {
  const origin = await openCanvas(page)
  await stroke(page, origin, BAR.from, BAR.to)
  await dispatch(page, { type: "addVectorLayer" })
  const before = await pixels(page)
  const stepsBefore = await steps(page)

  await dispatch(page, { type: "setColor", hex: BLUE })
  await setWet(page)
  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(before)
  expect(await steps(page)).toBe(stepsBefore)
})

test("on a vector layer a wet brush says the layer holds shapes", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Brush editor" }).click()
  const editor = page.getByRole("region", { name: "Brush editor" })
  await editor.getByRole("tab", { name: "Rendering" }).click()
  await editor.getByRole("switch", { name: "Wet" }).click()
  await expect(editor.getByRole("switch", { name: "Wet" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await page.getByRole("button", { name: "Add vector layer" }).click()

  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByText(/holds\s+shapes/)).toBeVisible()
})

test("a wet brush with scatter and colour jitter set draws as if they were absent", async ({
  page,
}) => {
  const errors: Error[] = []
  page.on("pageerror", (error) => errors.push(error))
  const samples = run(40, 200, [0.3, 1])
  const plain = await drawn(page, "wet", {}, samples)
  const thrown = await drawn(
    page,
    "wet",
    {
      scatter: { amount: 2, count: 3, axes: "both" },
      color: { hue: 0.5, saturation: 0.5, lightness: 0.5 },
      dynamics: [
        { source: "random", target: "scatter", range: [0, 2], mix: "multiply" },
        { source: "random", target: "hue", range: [-1, 1], mix: "add" },
        { source: "pressure", target: "lightness", range: [-1, 1], mix: "add" },
      ],
    },
    samples
  )
  expect(thrown.image).not.toEqual(thrown.empty)
  expect(thrown.image).toEqual(plain.image)
  expect(errors).toEqual([])
})

test("textured bristles retain separate colours as size, angle and roundness change", async ({
  page,
}) => {
  await openCanvas(page)
  await dispatch(page, { type: "setBrush", radius: 20, feather: 0 })
  await penStroke(page, run(30, 100, 1, 40))
  await dispatch(page, { type: "setColor", hex: BLUE })
  await penStroke(page, run(30, 100, 1, 80))
  await dispatch(page, {
    type: "registerTexture",
    id: "two-bristles",
    texture: {
      width: 3,
      height: 1,
      data: new Uint8Array([255, 0, 255]),
    },
  })
  await dispatch(page, {
    type: "setBrush",
    radius: 30,
    spacing: 0.125,
    tipTextureId: "two-bristles",
    wet: { pickup: 1 },
    flow: 1,
    dynamics: [
      { source: "pressure", target: "pickup", range: [1, 0], mix: "multiply" },
      { source: "pressure", target: "flow", range: [0, 1], mix: "multiply" },
      { source: "pressure", target: "size", range: [0.67, 1], mix: "multiply" },
      { source: "pressure", target: "angle", range: [0.125, 0.25], mix: "add" },
      {
        source: "pressure",
        target: "roundness",
        range: [0.4, 0.8],
        mix: "multiply",
      },
    ],
  })
  const send = async (type: string, x: number, pressure: number) =>
    page.evaluate(
      ({ type, x, pressure }) => {
        const canvas = document.querySelector("canvas")!
        const box = canvas.getBoundingClientRect()
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "pen",
            isPrimary: true,
            bubbles: true,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: box.left + x,
            clientY: box.top + 60,
            pressure,
          })
        )
      },
      { type, x, pressure }
    )
  await send("pointerdown", 70, 0.01)
  await frames(page)
  await send("pointerrawupdate", 70, 1)
  await frames(page)
  for (let x = 72; x <= 180; x += 2) await send("pointerrawupdate", x, 1)
  await send("pointerup", 180, 0)
  await frames(page)
  const image = await pixels(page)
  const at = (y: number) =>
    image.slice((y * WIDTH + 165) * 4, (y * WIDTH + 165) * 4 + 4)
  expect(at(40)[0]).toBeGreaterThan(at(40)[2] + 60)
  expect(at(80)[2]).toBeGreaterThan(at(80)[0] + 60)
})
