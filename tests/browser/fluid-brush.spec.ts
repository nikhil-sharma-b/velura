import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * A fluid brush (fluid brushes 01 and 02), through the engine's command seam
 * and the pixels it presents: a stroke lays paint into the layer's wet
 * surface, shown inside the layer, where it stays wet and moves until it
 * dries by itself or is told to. Drying settles it into the layer as one
 * undo step, and changes nothing on screen.
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
const FLUID = { water: 0.5, drying: 0.5, bleed: 0.5, edge: 0.5, granulation: 0 }

type Origin = { x: number; y: number }

async function openCanvas(
  page: Page,
  width = WIDTH,
  height = HEIGHT,
  manualFluidClock = true
): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour, manualFluidClock]) => {
      window.remountEngine({ manualFluidClock })
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
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [width, height, BLUE, manualFluidClock] as const
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

const rgba = (image: number[], x: number, y = ROW, width = WIDTH) =>
  image.slice((y * width + x) * 4, (y * width + x) * 4 + 4)

/** How far two pixels are apart, summed over their channels. */
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)

/**
 * How far a stroke's last dabs reach back from where the pen lifts: they are
 * laid as it lifts (architecture §6.2), so a frame with the pen down has not
 * got them yet.
 */
const TAIL = 24

/**
 * The box of pixels left of `until` where a channel of one picture is over
 * one from the other's: a layer stores half floats, so a channel may round
 * the other way. Null when there are none.
 */
function differing(a: number[], b: number[], until: number) {
  const box = { left: Infinity, top: Infinity, right: -1, bottom: -1 }
  for (let index = 0; index < a.length; index++) {
    if (Math.abs(a[index] - b[index]) <= 1) continue
    const x = Math.floor(index / 4) % WIDTH
    const y = Math.floor(index / 4 / WIDTH)
    if (x >= until) continue
    box.left = Math.min(box.left, x)
    box.top = Math.min(box.top, y)
    box.right = Math.max(box.right, x)
    box.bottom = Math.max(box.bottom, y)
  }
  return box.right < 0 ? null : box
}

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

const setColour = (page: Page, hex: string) =>
  page.evaluate((hex) => window.engine.dispatch({ type: "setColor", hex }), hex)

/** Makes the brush fluid, or with null takes that away. */
const setFluid = (page: Page, fluid: typeof FLUID | null) =>
  page.evaluate(
    (fluid) => window.engine.dispatch({ type: "setBrush", fluid }),
    fluid
  )

const undo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "undo" }))

async function penDown(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  await page.mouse.move(origin.x + from, origin.y + row)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + row, { steps: 30 })
}

/** A drag with a fluid brush: its paint is wet, and in no tile yet. */
async function wash(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  await penDown(page, origin, from, to, row)
  await page.mouse.up()
  // The last dabs are laid by the frame after the pen lifts.
  await frames(page)
}

const isWet = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().wet)

/** Runs the simulation on by so many steps. */
const advance = (page: Page, steps: number) =>
  page.evaluate(
    (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
    steps
  )

/** Runs the simulation on until paint has settled by itself. */
async function untilSettled(page: Page) {
  const before = await steps(page)
  for (let i = 0; i < 200 && (await steps(page)) === before; i++) {
    await advance(page, 20)
    // History reads the settled tiles back after the frame.
    await frames(page)
  }
  expect(await steps(page)).toBeGreaterThan(before)
}

/** Dries everything wet, waited for as the undo step it lands as. */
async function dryNow(page: Page) {
  const before = await steps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "dryNow" }))
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
      n,
    before
  )
}

/**
 * A drag that is expected to land as one undo step, waited for: a fluid
 * brush's paint is dried at once, so the step is the stroke.
 */
async function stroke(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  const before = await steps(page)
  await wash(page, origin, from, to, row)
  await page.evaluate(() => window.engine.dispatch({ type: "dryNow" }))
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
      n,
    before
  )
}

test("a fluid stroke on an empty layer lays the current colour", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, FLUID)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brush.rendering.fluid)
  ).toEqual(FLUID)
  const before = await steps(page)
  await stroke(page, origin, 40, 180)
  const painted = await pixels(page)

  // Blue, along the stroke and nowhere else.
  for (const x of [50, 110, 170]) {
    const [r, g, b] = rgba(painted, x)
    expect(b).toBeGreaterThan(r + 100)
    expect(b).toBeGreaterThan(g + 100)
  }
  expect(rgba(painted, 110, ROW - 20)).toEqual(rgba(empty, 110, ROW - 20))
  expect(rgba(painted, 215)).toEqual(rgba(empty, 215))

  // One step, which one undo takes back.
  expect(await steps(page)).toBe(before + 1)
  await undo(page)
  expect(await pixels(page)).toEqual(empty)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await pixels(page)).toEqual(painted)
})

test("the frame shown while the pen is down is the picture left when it dries", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, FLUID)
  const before = await steps(page)
  await penDown(page, origin, 40, 180)
  const wet = await pixels(page)
  // The paint shows, and nothing has reached the layer or history yet.
  expect(distance(rgba(wet, 110), rgba(empty, 110))).toBeGreaterThan(200)
  expect(await steps(page)).toBe(before)
  await page.mouse.up()
  // Lifting the pen leaves the paint wet: still shown, still in no step.
  expect(differing(await pixels(page), wet, 180 - TAIL)).toBe(null)
  expect(await isWet(page)).toBe(true)
  expect(await steps(page)).toBe(before)
  await dryNow(page)
  expect(await isWet(page)).toBe(false)
  expect(differing(await pixels(page), wet, 180 - TAIL)).toBe(null)
})

test("a cancelled fluid stroke leaves the layer and history as they were", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, FLUID)
  const before = await steps(page)
  await penDown(page, origin, 40, 180)
  // Choosing another tool with the pen down drops the mark in flight.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  await page.mouse.up()
  expect(await pixels(page)).toEqual(empty)
  expect(await steps(page)).toBe(before)
})

test("a fluid stroke over paint glazes it and leaves the rest of it alone", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await stroke(page, origin, 20, 130)
  const ground = await pixels(page)
  await setColour(page, YELLOW)
  await setFluid(page, FLUID)
  // Thin enough to be a film: at full flow the dabs pile up opaque.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setBrush", flow: 0.2 })
  )
  // Out of the blue and on over the empty layer beside it.
  await stroke(page, origin, 70, 210)
  const glazed = await pixels(page)

  // Yellow over blue reads green, and darker than the same yellow laid on
  // nothing.
  const [r, g, b] = rgba(glazed, 100)
  expect(g).toBeGreaterThan(r + 20)
  expect(g).toBeGreaterThan(b + 20)
  const sum = (pixel: number[]) => pixel[0] + pixel[1] + pixel[2]
  const alone = rgba(glazed, 170)
  expect(alone[0]).toBeGreaterThan(alone[2] + 40)
  expect(sum(rgba(glazed, 100))).toBeLessThan(sum(alone) - 60)
  // The blue the glaze did not reach is the blue that was there.
  expect(rgba(glazed, 30)).toEqual(rgba(ground, 30))
  expect(rgba(glazed, 100, ROW - 20)).toEqual(rgba(ground, 100, ROW - 20))
  // And one undo gives the ground back whole.
  await undo(page)
  expect(await pixels(page)).toEqual(ground)
})

test("a fluid stroke changes only the active layer", async ({ page }) => {
  const origin = await openCanvas(page)
  const show = (id: string, visible: boolean) =>
    page.evaluate(
      ([id, visible]) =>
        window.engine.dispatch({ type: "setLayer", id, visible }),
      [id, visible] as const
    )
  await addLayer(page)
  await stroke(page, origin, 20, 200)
  const middle = await addLayer(page)
  await addLayer(page)
  await setColour(page, "#20a040")
  await stroke(page, origin, 120, 220)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    middle
  )
  const whole = await pixels(page)
  await show(middle, false)
  const others = await pixels(page)
  await show(middle, true)

  await setColour(page, YELLOW)
  await setFluid(page, FLUID)
  await stroke(page, origin, 80, 160)
  expect(await pixels(page)).not.toEqual(whole)
  await show(middle, false)
  expect(await pixels(page)).toEqual(others)
})

for (const [name, patch] of [
  ["opacity", { opacity: 0.4 }],
  ["blend mode", { blend: "multiply" }],
  ["mask", { mask: true }],
  ["a blend mode above it", { above: "overlay" }],
] as const)
  test(`the layer's ${name} applies to wet paint as to the settled result`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    // Something under the layer for a blend mode to work against.
    await addLayer(page)
    await setColour(page, "#d0202a")
    await stroke(page, origin, 20, 220)
    const layer = await addLayer(page)
    if ("mask" in patch) {
      // A mask hiding the middle of the stroke's path.
      await page.evaluate(
        (id) => window.engine.dispatch({ type: "addMask", id }),
        layer
      )
      await page.evaluate(
        (id) => window.engine.dispatch({ type: "selectMask", id }),
        layer
      )
      await stroke(page, origin, 100, 130)
      await page.evaluate(
        (id) => window.engine.dispatch({ type: "selectLayer", id }),
        layer
      )
    } else if ("above" in patch) {
      const above = await addLayer(page)
      await setColour(page, "#20a040")
      await stroke(page, origin, 100, 200)
      await page.evaluate(
        ([id, blend]) =>
          window.engine.dispatch({ type: "setLayer", id, blend }),
        [above, patch.above] as const
      )
      await page.evaluate(
        (id) => window.engine.dispatch({ type: "selectLayer", id }),
        layer
      )
    } else
      await page.evaluate(
        ([id, patch]) =>
          window.engine.dispatch({ type: "setLayer", id, ...patch }),
        [layer, patch] as const
      )
    const ground = await pixels(page)
    await setColour(page, BLUE)
    await setFluid(page, FLUID)
    await penDown(page, origin, 60, 180)
    const wet = await pixels(page)
    expect(distance(rgba(wet, 80), rgba(ground, 80))).toBeGreaterThan(40)
    await page.mouse.up()
    await frames(page)
    await dryNow(page)
    expect(differing(await pixels(page), wet, 180 - TAIL)).toBe(null)
  })

test("a fluid stroke crossing tile borders shows no seam", async ({ page }) => {
  const width = 600
  const origin = await openCanvas(page, width, 400)
  await addLayer(page)
  await setFluid(page, FLUID)
  // Tiles are 256 px. This stroke runs along the border between two rows of
  // them, half of it in each, and across two borders between columns.
  const row = 256
  await stroke(page, origin, 150, 560, row)
  const painted = await pixels(page)
  const at = (x: number, y: number) => rgba(painted, x, y, width)
  expect(at(200, row)[2]).toBeGreaterThan(at(200, row)[0] + 100)
  // Along the stroke, the columns either side of a border are the column
  // far from one.
  for (const border of [256, 512])
    for (let x = border - 3; x <= border + 2; x++)
      for (const y of [row - 8, row - 1, row, row + 7])
        expect(distance(at(x, y), at(200, y))).toBeLessThanOrEqual(3)
  // Across it, the stroke is the same either side of the border it runs on.
  for (const x of [200, 256, 400, 512])
    for (let reach = 0; reach < 14; reach++)
      expect(
        distance(at(x, row - 1 - reach), at(x, row + reach))
      ).toBeLessThanOrEqual(3)
})

test("a fluid brush on a layer mask paints as the brush otherwise is", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const layer = await addLayer(page)
  await stroke(page, origin, 20, 220)
  for (const type of ["addMask", "selectMask"] as const)
    await page.evaluate(([type, id]) => window.engine.dispatch({ type, id }), [
      type,
      layer,
    ] as const)
  const masked = async (fluid: typeof FLUID | null) => {
    await setFluid(page, fluid)
    await stroke(page, origin, 80, 160)
    const image = await pixels(page)
    await undo(page)
    return image
  }
  expect(await masked(FLUID)).toEqual(await masked(null))
})

test("a brush is not made fluid and wet together, or fluid out of range", async ({
  page,
}) => {
  await openCanvas(page)
  const refused = (brush: object) =>
    page.evaluate(
      (brush) =>
        window.engine
          .dispatch({ type: "setBrush", ...brush })
          .then(() => false)
          .catch(() => true),
      brush
    )
  expect(await refused({ fluid: FLUID, wet: { pickup: 0.5 } })).toBe(true)
  expect(await refused({ fluid: { ...FLUID, water: 1.5 } })).toBe(true)
  expect(await refused({ fluid: { ...FLUID, bleed: -0.1 } })).toBe(true)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brush.rendering)
  ).not.toHaveProperty("fluid")
  await setFluid(page, FLUID)
  expect(await refused({ wet: { pickup: 0.5 } })).toBe(true)
  // Taking fluid away gives back the brush that never had it.
  await setFluid(page, null)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brush.rendering)
  ).not.toHaveProperty("fluid")
})

test("golden: a fluid stroke across a two-colour ground", async ({ page }) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  // The procedural disc, so the picture owes nothing to a shipped tip.
  await setColour(page, "#d0202a")
  await stroke(page, origin, 30, 110)
  await setColour(page, BLUE)
  await stroke(page, origin, 140, 210)
  await setColour(page, YELLOW)
  await setFluid(page, FLUID)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setBrush", flow: 0.2 })
  )
  await stroke(page, origin, 40, 200)
  await frames(page)
  const image = await page.evaluate(async () => {
    const { width, height, data } = await window.engine.readPixels()
    return { width, height, data: Array.from(data) }
  })
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("fluid-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })
})

// ── The simulation (fluid brushes 02) ──

/** A brush whose paint is dry within two hundred steps. */
const QUICK = { ...FLUID, drying: 1 }

/** The brush's size, and how much pigment each of its dabs carries. */
const setTip = (page: Page, radius: number, flow: number) =>
  page.evaluate(
    ([radius, flow]) =>
      window.engine.dispatch({ type: "setBrush", radius, flow }),
    [radius, flow] as const
  )

/**
 * A blue wash with a touch of yellow laid into it while it is wet, and the
 * same touch laid on dry paper beside it, left to move for `count` steps.
 */
const TOUCH = { wet: 110, dry: 200, radius: 6, length: 8 }
async function touchedWash(page: Page, count: number) {
  const origin = await openCanvas(page)
  await addLayer(page)
  await setFluid(page, FLUID)
  // A thin wash, and a touch strong enough to show in it.
  await setTip(page, 30, 0.1)
  await wash(page, origin, 40, 140)
  await setColour(page, YELLOW)
  await setTip(page, TOUCH.radius, 1)
  for (const x of [TOUCH.wet, TOUCH.dry])
    await wash(page, origin, x - TOUCH.length / 2, x + TOUCH.length / 2)
  await advance(page, count)
  return pixels(page)
}

test("a colour laid into a wet wash spreads further than on dry paper, and mixes as pigment", async ({
  page,
}) => {
  const image = await touchedWash(page, 100)
  const empty = [255, 255, 255, 255]
  // The wash as it is far from the touch: what a row holds with no yellow.
  const plain = (y: number) => rgba(image, 60, y)
  // How many pixels of a column differ from what is there with no yellow.
  const reach = (x: number, without: (y: number) => number[]) => {
    let rows = 0
    for (let y = 0; y < HEIGHT; y++)
      if (distance(rgba(image, x, y), without(y)) > 12) rows++
    return rows
  }
  const inWash = reach(TOUCH.wet, plain)
  const onPaper = reach(TOUCH.dry, () => empty)
  expect(onPaper).toBeGreaterThan(TOUCH.radius)
  expect(inWash).toBeGreaterThan(onPaper + 6)

  // Past the dab's own rim the yellow that bled into the blue reads green.
  // Pigment mixed: the yellow has taken red out of the blue, where light
  // mixed would have added its own and gone grey.
  const y = ROW + TOUCH.radius + 3
  const [r, g] = rgba(image, TOUCH.wet, y)
  const [plainR, plainG] = plain(y)
  expect(g).toBeGreaterThan(r + 15)
  expect(g - r).toBeGreaterThan(plainG - plainR + 12)
  expect(r).toBeLessThan(plainR - 20)
})

test("the same strokes and the same step count give the same pixels", async ({
  page,
}) => {
  const first = await touchedWash(page, 120)
  expect(await touchedWash(page, 120)).toEqual(first)
  // And the paint has moved: the count is what the picture depends on.
  expect(await touchedWash(page, 20)).not.toEqual(first)
})

test("a wash left alone settles by itself, into the picture it last showed", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, QUICK)
  const before = await steps(page)
  await wash(page, origin, 40, 180)
  await advance(page, 60)
  expect(await isWet(page)).toBe(true)
  expect(await steps(page)).toBe(before)

  let last = await pixels(page)
  for (let i = 0; i < 100 && (await isWet(page)); i++) {
    last = await pixels(page)
    await advance(page, 5)
  }
  expect(await isWet(page)).toBe(false)
  const settled = await pixels(page)
  expect(differing(settled, last, WIDTH)).toBe(null)
  expect(distance(rgba(settled, 110), rgba(empty, 110))).toBeGreaterThan(200)

  // The settle is one step: one undo takes the passage back.
  await page.waitForFunction(
    (n) =>
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
      n,
    before
  )
  expect(await steps(page)).toBe(before + 1)
  await undo(page)
  expect(await pixels(page)).toEqual(empty)
})

test("dry now settles everything at once and changes nothing on screen", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await setFluid(page, FLUID)
  const before = await steps(page)
  await wash(page, origin, 30, 100)
  await setColour(page, YELLOW)
  await wash(page, origin, 80, 200)
  // Part way: water standing, pigment still on the move.
  await advance(page, 40)
  const wet = await pixels(page)
  await dryNow(page)
  expect(await isWet(page)).toBe(false)
  expect(differing(await pixels(page), wet, WIDTH)).toBe(null)
  expect(await steps(page)).toBe(before + 1)
  // Dry paint stays where it is however long the clock runs.
  await advance(page, 50)
  expect(differing(await pixels(page), wet, WIDTH)).toBe(null)
})

test("dried paint under a later wash does not move", async ({ page }) => {
  /** A thin yellow wash left to move, over blue dried first or over nothing. */
  const washed = async (overBlue: boolean) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    await setFluid(page, FLUID)
    if (overBlue) await stroke(page, origin, 20, 110)
    const ground = await pixels(page)
    await setColour(page, YELLOW)
    await page.evaluate(() =>
      window.engine.dispatch({ type: "setBrush", flow: 0.2 })
    )
    await wash(page, origin, 70, 210)
    await advance(page, 300)
    await dryNow(page)
    return { ground, glazed: await pixels(page) }
  }
  const alone = await washed(false)
  const { ground, glazed } = await washed(true)

  // The overlap mixed, read at the wash's rim where its yellow has gathered,
  // and the blue the wash never reached is untouched.
  const [r, g, b] = rgba(glazed, 95, ROW - 11)
  expect(g).toBeGreaterThan(r + 20)
  expect(g).toBeGreaterThan(b + 20)
  expect(rgba(glazed, 30)).toEqual(rgba(ground, 30))
  // The wash carried no blue along: past the blue's end it is, to the
  // pixel, the wash that never met any.
  for (const x of [135, 150, 190])
    for (const y of [ROW - 8, ROW, ROW + 8])
      expect(distance(rgba(glazed, x, y), rgba(alone.glazed, x, y))).toBe(0)
  // And the blue is all still under there: undo gives it back whole.
  await undo(page)
  expect(await pixels(page)).toEqual(ground)
})

test("undo with paint still wet takes back the stroke, and redo puts it back wet", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, FLUID)
  await wash(page, origin, 40, 180)
  await advance(page, 30)
  const wet = await pixels(page)
  // The stroke found the layer dry, and undone it leaves it so.
  await undo(page)
  expect(await isWet(page)).toBe(false)
  expect(await pixels(page)).toEqual(empty)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await isWet(page)).toBe(true)
  expect(differing(await pixels(page), wet, WIDTH)).toBe(null)
})

test("the view moves while paint is wet, and the simulation rebuilds no cache", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  // Marked layers under and over the one painted on: a cache rebuilt is a
  // pass for each of them.
  await page.evaluate(() => window.buildLayerStack(12))
  await setFluid(page, FLUID)
  await wash(page, origin, 60, 180)
  const before = await pixels(page)

  const passes = await page.evaluate(async () => {
    const encoder = GPUCommandEncoder.prototype
    const beginRenderPass = encoder.beginRenderPass
    let passes = 0
    encoder.beginRenderPass = function (
      ...args: Parameters<typeof beginRenderPass>
    ) {
      passes++
      return beginRenderPass.apply(this, args)
    }
    try {
      for (let i = 0; i < 10; i++)
        await window.engine.dispatch({ type: "advanceFluid", steps: 1 })
    } finally {
      encoder.beginRenderPass = beginRenderPass
    }
    return passes
  })
  expect(passes).toBeLessThanOrEqual(20)

  // Pan, zoom and rotate, the paint moving all the while.
  for (const command of [
    { type: "panView", dx: 30, dy: 10 },
    { type: "zoomView", factor: 2 },
    { type: "rotateView", radians: 0.5 },
  ] as const) {
    await page.evaluate((command) => window.engine.dispatch(command), command)
    await advance(page, 5)
    expect(await isWet(page)).toBe(true)
  }
  const moved = await pixels(page)
  expect(moved).not.toEqual(before)
  // Still nothing changes at the moment of drying, in a view that is turned.
  await dryNow(page)
  expect(differing(await pixels(page), moved, WIDTH)).toBe(null)
})

test("with nothing wet no step runs and no frame is asked for", async ({
  page,
}) => {
  // On the engine's own clock: this is about when it runs.
  const origin = await openCanvas(page, WIDTH, HEIGHT, false)
  await addLayer(page)
  await setFluid(page, QUICK)
  await frames(page)
  // Counts the frames the page asks for and the compute passes it runs
  // across thirty frames, watched through a frame callback of the test's own.
  const watch = () =>
    page.evaluate(async () => {
      const request = window.requestAnimationFrame
      const pass = GPUComputePassEncoder.prototype
      const dispatch = pass.dispatchWorkgroups
      const seen = { frames: 0, steps: 0, wet: window.engine.getSnapshot().wet }
      window.requestAnimationFrame = (callback) => {
        seen.frames++
        return request.call(window, callback)
      }
      pass.dispatchWorkgroups = function (
        ...args: Parameters<typeof dispatch>
      ) {
        seen.steps++
        return dispatch.apply(this, args)
      }
      try {
        for (let i = 0; i < 30; i++)
          await new Promise((resolve) => request.call(window, resolve))
      } finally {
        window.requestAnimationFrame = request
        pass.dispatchWorkgroups = dispatch
      }
      return seen
    })
  expect(await watch()).toEqual({ frames: 0, steps: 0, wet: false })

  const before = await steps(page)
  await wash(page, origin, 40, 180)
  const running = await watch()
  expect(running.wet).toBe(true)
  expect(running.steps).toBeGreaterThan(0)
  expect(running.frames).toBeGreaterThan(0)

  // Left alone it dries, and the clock stops with it.
  await page.waitForFunction(
    (n) =>
      !window.engine.getSnapshot().wet &&
      window.engine.historyUsage().steps -
        window.engine.historyUsage().wetSteps >
        n,
    before
  )
  await frames(page)
  expect(await watch()).toEqual({ frames: 0, steps: 0, wet: false })
})

test("paint bleeds across a tile border as it does within a tile", async ({
  page,
}) => {
  const width = 600
  /**
   * A wash with a touch of yellow bled into it, the whole of it moved
   * `shift` pixels right and down: the same paint, on other tiles.
   */
  const bled = async (shift: number) => {
    const origin = await openCanvas(page, width, 400)
    await addLayer(page)
    // Bleeding freely, so few steps show it: a step is slow where the GPU
    // is software.
    await setFluid(page, { ...FLUID, bleed: 1 })
    await setTip(page, 30, 0.1)
    await wash(page, origin, 170 + shift, 330 + shift, 256 + shift)
    await setColour(page, YELLOW)
    await setTip(page, TOUCH.radius, 1)
    await wash(page, origin, 242 + shift, 250 + shift, 256 + shift)
    await advance(page, 150)
    const image = await pixels(page)
    return (x: number, y: number) => rgba(image, x + shift, y + shift, width)
  }
  // Tiles are 256 px. Unshifted the touch is on the border between two rows
  // of them and ten pixels short of one between two columns; a quarter tile
  // on, the same paint has no border within its reach.
  const across = await bled(0)
  const within = await bled(64)
  // It has bled over the column border.
  expect(distance(across(262, 256), across(340, 256))).toBeGreaterThan(12)
  // And the picture is the one painted where there is no border to cross,
  // to the paper's grain: a quarter tile on is other paper (fluid brushes 07).
  let worst = 0
  for (let y = 216; y < 296; y++)
    for (let x = 206; x < 290; x++)
      worst = Math.max(worst, distance(across(x, y), within(x, y)))
  expect(worst).toBeLessThanOrEqual(6)
})

test("a body of wet tiles settles as a whole, and apart from another", async ({
  page,
}) => {
  const width = 1100
  const origin = await openCanvas(page, width, 300)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, QUICK)
  const before = await steps(page)
  // One wash over two tiles, and later one a tile's width clear of it.
  await wash(page, origin, 200, 310, 100)
  await advance(page, 100)
  await wash(page, origin, 850, 950, 100)
  const at = (image: number[], x: number, y: number) => rgba(image, x, y, width)

  // The first dries on its own deadline, whole, with the second still wet.
  await untilSettled(page)
  expect(await steps(page)).toBe(before + 1)
  expect(await isWet(page)).toBe(true)
  await untilSettled(page)
  expect(await steps(page)).toBe(before + 2)
  expect(await isWet(page)).toBe(false)
  const both = await pixels(page)

  // One undo takes back the second and none of the first.
  await undo(page)
  const first = await pixels(page)
  expect(at(first, 900, 100)).toEqual(at(empty, 900, 100))
  for (const [x, y] of [
    [220, 100],
    [250, 100],
    [262, 100],
    [300, 100],
  ]) {
    expect(distance(at(first, x, y), at(empty, x, y))).toBeGreaterThan(200)
    expect(at(first, x, y)).toEqual(at(both, x, y))
  }
  // And one more takes back the first from every tile it lay in.
  await undo(page)
  expect(await pixels(page)).toEqual(empty)
})

test("a stroke goes on painting after its paint is dried under the pen", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setFluid(page, FLUID)
  await penDown(page, origin, 40, 100)
  await frames(page)
  await dryNow(page)
  await page.mouse.move(origin.x + 180, origin.y + ROW, { steps: 30 })
  await page.mouse.up()
  await frames(page)
  // What was laid before is in the layer, and what came after is wet on it.
  expect(await isWet(page)).toBe(true)
  const image = await pixels(page)
  for (const x of [60, 150])
    expect(distance(rgba(image, x), rgba(empty, x))).toBeGreaterThan(200)
  await dryNow(page)
  expect(differing(await pixels(page), image, WIDTH)).toBe(null)
})

// ── Edge darkening (fluid brushes 06) ──

/** A wash drawn along the stroke row, and what it is drawn with. */
const WASH = { from: 70, to: 170, radius: 30, flow: 0.1 }

/** How much paint a pixel shows: what has been taken out of white paper. */
const darkness = (pixel: number[]) => 765 - pixel[0] - pixel[1] - pixel[2]

/** The darkest of the pixels from one point to another, both counted. */
function darkest(
  image: number[],
  from: [number, number],
  to: [number, number]
) {
  const count = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]))
  let most = 0
  for (let i = 0; i <= count; i++) {
    const t = count === 0 ? 0 : i / count
    const x = Math.round(from[0] + (to[0] - from[0]) * t)
    const y = Math.round(from[1] + (to[1] - from[1]) * t)
    most = Math.max(most, darkness(rgba(image, x, y)))
  }
  return most
}

/** A wash laid on the active layer at a brush's `edge`, and left to dry. */
async function leftToDry(page: Page, origin: Origin, edge: number) {
  await setColour(page, BLUE)
  await setFluid(page, { ...FLUID, edge })
  await setTip(page, WASH.radius, WASH.flow)
  await wash(page, origin, WASH.from, WASH.to)
  await untilSettled(page)
  return pixels(page)
}

const MIDDLE = (WASH.from + WASH.to) / 2
/** How far either side of a wash's outline its rim is looked for. */
const BAND = 6
const centre = (image: number[]) => darkness(rgba(image, MIDDLE))
/** The rim along the wash's upper side, in one column. */
const side = (image: number[], x = MIDDLE) =>
  darkest(image, [x, ROW - WASH.radius - BAND], [x, ROW - WASH.radius + BAND])
/** The rim round the wash's rounded end, and the wash just inside it. */
const END = WASH.to + WASH.radius
const end = (image: number[]) =>
  darkest(image, [END - BAND, ROW], [END + BAND, ROW])
const insideEnd = (image: number[]) => darkness(rgba(image, END - 3 * BAND))

test("a wash left to dry is darker at its rim than at its centre", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const image = await leftToDry(page, origin, 1)
  expect(centre(image)).toBeGreaterThan(30)
  expect(side(image)).toBeGreaterThan(centre(image) * 1.5)
  // The rounded ends of a stroke rim as its sides do, the one it began with
  // and the one it ended with.
  const START = WASH.from - WASH.radius
  expect(
    darkest(image, [START - BAND, ROW], [START + BAND, ROW])
  ).toBeGreaterThan(darkness(rgba(image, START + 3 * BAND)) * 1.5)
  expect(end(image)).toBeGreaterThan(insideEnd(image) * 1.5)
})

test("with edge at zero a wash dries flat", async ({ page }) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const image = await leftToDry(page, origin, 0)
  expect(centre(image)).toBeGreaterThan(30)
  // To the paper's grain (fluid brushes 07), which a rim is well over.
  expect(Math.abs(side(image) - centre(image))).toBeLessThan(
    centre(image) * 0.25
  )
  // A stroke's end is laid thinner than its middle, and stays so.
  expect(end(image)).toBeLessThan(insideEnd(image) * 1.03)
})

test("the rim follows the wash's own outline, not that of dried paint under it", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  // Dried paint under the left of where the wash goes, ending in its middle.
  await setColour(page, YELLOW)
  await setTip(page, 60, 1)
  await stroke(page, origin, 0, 50)
  const ground = await pixels(page)
  // Where it ends along the stroke row: inside the wash, short of its middle.
  let border = 0
  while (darkness(rgba(ground, border + 1)) > 0) border++
  expect(border).toBeGreaterThan(WASH.from + 2 * BAND)
  expect(border).toBeLessThan(MIDDLE - 2 * BAND)
  const image = await leftToDry(page, origin, 1)

  // Along the wash's middle, where the dried paint ends: no rim on the paper
  // side of it, the wash being as it is further along, to the paper's grain.
  const flat = centre(image)
  for (let x = border + BAND; x < MIDDLE; x++)
    expect(Math.abs(darkness(rgba(image, x)) - flat)).toBeLessThan(flat * 0.2)
  // The wash's own outline rims over dried paint as over paper.
  const under = darkness(rgba(ground, 80))
  expect(side(image, 150)).toBeGreaterThan(flat * 1.5)
  expect(side(ground, 80)).toBe(under)
  // Less of it shows there: paint over paint darkens less than over paper.
  expect(side(image, 80) - under).toBeGreaterThan(
    (darkness(rgba(image, 80)) - under) * 1.25
  )
})

test("a wash that runs off the canvas has no rim along the canvas's edge", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await setColour(page, BLUE)
  await setFluid(page, { ...FLUID, edge: 1 })
  await setTip(page, WASH.radius, WASH.flow)
  // From close enough to the left edge that the stroke's end is off it.
  await wash(page, origin, 4, 120)
  await untilSettled(page)
  const image = await pixels(page)
  expect(darkest(image, [0, ROW], [BAND, ROW])).toBeLessThan(
    darkness(rgba(image, 3 * BAND)) * 1.1
  )
  // Its sides rim all the same.
  expect(side(image, 60)).toBeGreaterThan(darkness(rgba(image, 60)) * 1.5)
})
