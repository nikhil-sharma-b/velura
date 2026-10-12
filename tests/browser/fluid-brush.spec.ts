import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * A fluid brush (fluid brushes 01), through the engine's command seam and the
 * pixels it presents: a stroke lays paint into the layer's wet surface, shown
 * inside the layer while the pen is down, and settles it into the layer as
 * one undo step when the pen lifts. Nothing simulates yet.
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
  height = HEIGHT
): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, colour]) => {
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
        radius: 12,
        spacing: 0.125,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [width, height, BLUE] as const
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

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

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

/** A drag that is expected to land as one undo step, waited for. */
async function stroke(
  page: Page,
  origin: Origin,
  from: number,
  to: number,
  row = ROW
) {
  const before = await steps(page)
  await penDown(page, origin, from, to, row)
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
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

test("the frame shown while the pen is down is the picture left when it lifts", async ({
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
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
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
    const before = await steps(page)
    await penDown(page, origin, 60, 180)
    const wet = await pixels(page)
    expect(distance(rgba(wet, 80), rgba(ground, 80))).toBeGreaterThan(40)
    await page.mouse.up()
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      before
    )
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
