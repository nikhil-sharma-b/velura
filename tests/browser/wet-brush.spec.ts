import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * A wet brush (live brushes 02), through the engine's command seam and the
 * pixels it presents: a stroke lays the current colour and drags the paint
 * already on the active layer along with it, and is one undo step.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and dragged along. */
const ROW = 60
/** Where the painted bar starts and stops. */
const BAR = { from: 40, to: 100 }
const RED = "#d0202a"
const BLUE = "#1040e0"
/** Blue as the canvas presents it, laid whole. */
const BLUE_PIXEL = [16, 64, 224, 255]
/** What a brush is made wet with here. */
const PICKUP = 0.5

type Origin = { x: number; y: number }

async function openCanvas(
  page: Page,
  documentId?: string,
  width = WIDTH
): Promise<Origin> {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, documentId, colour]) => {
      window.remountEngine(
        documentId ? { persistence: { documentId } } : undefined
      )
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
      // An eighth of the diameter between dabs: a quarter of the radius,
      // which is where smudge's own dabs fall. Wet, the brush's floor holds
      // them a pixel further apart, at four (live brushes 10).
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.125,
      })
      await window.engine.dispatch({ type: "setColor", hex: colour })
    },
    [width, HEIGHT, documentId, RED] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const addLayer = (page: Page) =>
  page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot().activeLayerId
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

const rgba = (image: number[], x: number, y = ROW) =>
  image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4)

/** How far two pixels are apart, summed over their channels. */
const distance = (a: number[], b: number[]) =>
  a.reduce((sum, channel, index) => sum + Math.abs(channel - b[index]), 0)

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

const setTool = (page: Page, tool: "brush" | "eraser" | "smudge") =>
  page.evaluate(
    (tool) => window.engine.dispatch({ type: "setTool", tool }),
    tool
  )

const setColour = (page: Page, hex: string) =>
  page.evaluate((hex) => window.engine.dispatch({ type: "setColor", hex }), hex)

/** Makes the brush wet, or with null dries it again. */
const setWet = (page: Page, wet: { pickup: number } | null, flow?: number) =>
  page.evaluate(
    ([wet, flow]) => window.engine.dispatch({ type: "setBrush", wet, flow }),
    [wet, flow] as const
  )

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

/** A dry bar of the current colour. */
const paintBar = (page: Page, origin: Origin) =>
  stroke(page, origin, BAR.from, BAR.to)

test("a wet stroke on an empty layer lays the current colour", async ({
  page,
}) => {
  // What the colour looks like laid dry, at the brush's full flow.
  const dryOrigin = await openCanvas(page)
  await addLayer(page)
  await stroke(page, dryOrigin, 40, 180)
  const dry = await pixels(page)

  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setWet(page, { pickup: PICKUP })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brush.rendering.wet)
  ).toEqual({ pickup: PICKUP })
  await stroke(page, origin, 40, 180)
  const wet = await pixels(page)

  // A clean load lays the current colour, then picks up transparency and thins.
  expect(distance(rgba(wet, 45), rgba(dry, 45))).toBeLessThan(
    distance(rgba(wet, 175), rgba(dry, 175))
  )
  expect(rgba(wet, 45)[0]).toBeGreaterThan(rgba(wet, 45)[2] + 20)
  expect(distance(rgba(wet, 175), rgba(empty, 175))).toBeLessThan(8)
  // And nothing has reached beyond the dab.
  expect(rgba(wet, 110, ROW - 20)).toEqual(rgba(empty, 110, ROW - 20))
  expect(rgba(wet, 215)).toEqual(rgba(empty, 215))
})

test("a wet stroke dragged out of one colour carries it into the next", async ({
  page,
}) => {
  /** A thin blue wet stroke out of where the bar is, with or without it. */
  async function strokeOver(ground: "bar" | "empty") {
    const origin = await openCanvas(page)
    await addLayer(page)
    if (ground === "bar") await paintBar(page, origin)
    await setColour(page, BLUE)
    await setWet(page, { pickup: 0.1 }, 0.05)
    await stroke(page, origin, 70, 180)
    return pixels(page)
  }
  const overRed = await strokeOver("bar")
  const overNothing = await strokeOver("empty")
  const red = rgba(overRed, 50)

  // Past the bar's end the stroke over red holds red the other does not.
  for (const x of [125, 140])
    expect(distance(rgba(overRed, x), red)).toBeLessThan(
      distance(rgba(overNothing, x), red) - 20
    )
  // More of it nearer the bar than further along.
  expect(distance(rgba(overRed, 120), red)).toBeLessThan(
    distance(rgba(overRed, 170), red)
  )
  // The reservoir still carries visible red more than a tip diameter beyond the bar.
})

test("at no pickup a wet brush covers and drags nothing", async ({ page }) => {
  /** A blue wet stroke at full flow out of where the bar is, with or without it. */
  async function strokeOver(ground: "bar" | "empty") {
    const origin = await openCanvas(page)
    await addLayer(page)
    if (ground === "bar") await paintBar(page, origin)
    await setColour(page, BLUE)
    await setWet(page, { pickup: 0 }, 1)
    await stroke(page, origin, 70, 180)
    return pixels(page)
  }
  const overRed = await strokeOver("bar")
  const overNothing = await strokeOver("empty")
  // Inside the bar the stroke covers: what is there is the brush's blue.
  expect(distance(rgba(overRed, 90), BLUE_PIXEL)).toBeLessThan(12)
  // Past the bar's end no red came along: the stroke is the one drawn on
  // nothing, pixel for pixel.
  const clear = BAR.to + 12 + 2
  for (let x = clear; x < WIDTH; x++)
    for (let y = ROW - 14; y <= ROW + 14; y++)
      expect(rgba(overRed, x, y)).toEqual(rgba(overNothing, x, y))
})

test("at no pickup and no flow a wet brush changes nothing and is not a step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  const before = await steps(page)
  await setWet(page, { pickup: 0 }, 0)
  await idleDrag(page, origin, 70, 180)
  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
})

test("at high pickup and low flow a wet brush mostly blends", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const red = rgba(await pixels(page), 50)
  await setColour(page, BLUE)
  await setWet(page, { pickup: 0.9 }, 0.05)
  await stroke(page, origin, 70, 180)
  const image = await pixels(page)
  // Where it ran over red it is still nearer red than the colour it laid.
  for (const x of [80, 95])
    expect(distance(rgba(image, x), red)).toBeLessThan(
      distance(rgba(image, x), BLUE_PIXEL)
    )
})

test("at no flow a wet brush lays nothing and drags as smudge does", async ({
  page,
}) => {
  /** A drag out of the bar, by a wet brush that lays nothing or by smudge. */
  async function draggedBy(tool: "brush" | "smudge") {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    const painted = await pixels(page)
    await setColour(page, BLUE)
    // At a radius of 16 the two fall into step: an eighth of the brush's
    // diameter is its spacing floor of four pixels (live brushes 10), and
    // a quarter of smudge's radius is the same.
    if (tool === "brush") {
      await page.evaluate(() =>
        window.engine.dispatch({ type: "setBrush", radius: 16 })
      )
      await setWet(page, { pickup: PICKUP }, 0)
    } else
      await page.evaluate(
        (strength) =>
          window.engine.dispatch({ type: "setSmudge", radius: 16, strength }),
        PICKUP
      )
    await setTool(page, tool)
    await stroke(page, origin, 80, 160)
    return { painted, dragged: await pixels(page) }
  }
  // A brush with no flow has no colour to trade, so it has no reservoir: it
  // is a blender, and reads the pixel behind as smudge does.
  const wet = await draggedBy("brush")
  const smudged = await draggedBy("smudge")
  expect(wet.dragged).not.toEqual(wet.painted)
  expect(wet.dragged).toEqual(smudged.dragged)
})

test("a wet dab whose flow the graph takes to zero changes neither paint nor history", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  const before = await steps(page)
  // A brush with flow of its own keeps its reservoir: with every dab's flow
  // scaled away it loads its bristles and gives nothing back.
  await setWet(page, { pickup: PICKUP }, 1)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "setBrush",
      dynamics: [
        { source: "velocity", target: "flow", range: [0, 0], mix: "multiply" },
      ],
    })
  )
  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
})

test("at no flow a wet brush leaves an empty layer and its history alone", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  const before = await steps(page)
  await setWet(page, { pickup: PICKUP }, 0)
  await idleDrag(page, origin, 40, 180)
  expect(await pixels(page)).toEqual(empty)
  expect(await steps(page)).toBe(before)
})

test("a wet stroke changes only the active layer", async ({ page }) => {
  const origin = await openCanvas(page)
  const show = (id: string, visible: boolean) =>
    page.evaluate(
      ([id, visible]) =>
        window.engine.dispatch({ type: "setLayer", id, visible }),
      [id, visible] as const
    )
  // Paint under the stroke's path on the layer below, the one painted wet,
  // and the one above.
  await addLayer(page)
  await setColour(page, BLUE)
  await stroke(page, origin, 20, 200)
  const middle = await addLayer(page)
  await setColour(page, RED)
  await paintBar(page, origin)
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

  await setWet(page, { pickup: PICKUP }, 0.3)
  await stroke(page, origin, 80, 160)
  expect(await pixels(page)).not.toEqual(whole)
  await show(middle, false)
  expect(await pixels(page)).toEqual(others)
})

test("a locked layer is not painted by a wet brush", async ({ page }) => {
  const origin = await openCanvas(page)
  const layer = await addLayer(page)
  await paintBar(page, origin)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, locked: true }),
    layer
  )
  const before = await pixels(page)
  const stepsBefore = await steps(page)

  await setColour(page, BLUE)
  await setWet(page, { pickup: PICKUP })
  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(before)
  expect(await steps(page)).toBe(stepsBefore)
})

test("a wet stroke is one undo step, and redo brings it back", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  const before = await steps(page)

  await setColour(page, BLUE)
  await setWet(page, { pickup: PICKUP }, 0.3)
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)
  expect(mixed).not.toEqual(painted)
  expect(await steps(page)).toBe(before + 1)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(painted)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await pixels(page)).toEqual(mixed)
})

test("the first wet stroke on a layer is undone to an empty layer", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await setWet(page, { pickup: PICKUP })
  await stroke(page, origin, 40, 180)
  expect(await pixels(page)).not.toEqual(empty)
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(empty)
})

for (const ground of ["paint", "an empty layer"] as const)
  test(`a wet stroke over ${ground} cancelled mid-stroke leaves the layer unchanged`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    if (ground === "paint") await paintBar(page, origin)
    const start = await pixels(page)
    const before = await steps(page)

    await setColour(page, BLUE)
    await setWet(page, { pickup: PICKUP }, 0.3)
    await page.mouse.move(origin.x + 80, origin.y + ROW)
    await page.mouse.down()
    await page.mouse.move(origin.x + 160, origin.y + ROW, { steps: 30 })
    // The stroke is in the layer while the pen is still down.
    expect(await pixels(page)).not.toEqual(start)
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
    await page.mouse.up()

    expect(await pixels(page)).toEqual(start)
    expect(await steps(page)).toBe(before)
    // And the layer still takes a stroke afterwards.
    await stroke(page, origin, 80, 160)
    expect(await pixels(page)).not.toEqual(start)
  })

test("a wet stroke survives a reload", async ({ page }) => {
  const documentId = `wet-${Date.now()}-${Math.random()}`
  const origin = await openCanvas(page, documentId)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  await setColour(page, BLUE)
  await setWet(page, { pickup: PICKUP }, 0.3)
  await stroke(page, origin, 80, 160)
  const mixed = await pixels(page)
  expect(mixed).not.toEqual(painted)
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openCanvas(page, documentId)
  expect(await pixels(page)).toEqual(mixed)
})

test("the eraser erases as it always has while the brush is wet", async ({
  page,
}) => {
  /** The bar with an eraser drawn through it, the brush wet or dry. */
  async function erasedWith(wet: { pickup: number } | null) {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    await setWet(page, wet)
    await setTool(page, "eraser")
    await stroke(page, origin, 60, 140)
    return pixels(page)
  }
  expect(await erasedWith({ pickup: 0.9 })).toEqual(await erasedWith(null))
})

test("a brush made dry again draws as it did before it was wet", async ({
  page,
}) => {
  async function barDrawn(madeWet: boolean) {
    const origin = await openCanvas(page)
    await addLayer(page)
    if (madeWet) {
      await setWet(page, { pickup: PICKUP })
      await setWet(page, null)
    }
    await paintBar(page, origin)
    return pixels(page)
  }
  expect(await barDrawn(true)).toEqual(await barDrawn(false))
})

test("a pickup outside [0, 1] is refused", async ({ page }) => {
  await openCanvas(page)
  const refused = (pickup: number) =>
    page.evaluate(
      (pickup) =>
        window.engine
          .dispatch({ type: "setBrush", wet: { pickup } })
          .then(() => false)
          .catch(() => true),
      pickup
    )
  expect(await refused(-0.1)).toBe(true)
  expect(await refused(1.1)).toBe(true)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brush.rendering)
  ).not.toHaveProperty("wet")
})

test("golden: a wet stroke across a two-colour ground", async ({ page }) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  // The procedural disc, so the picture owes nothing to a shipped tip.
  await stroke(page, origin, 30, 110)
  await setColour(page, BLUE)
  await stroke(page, origin, 140, 210)
  await setColour(page, "#f0c020")
  await setWet(page, { pickup: 0.8 }, 0.03)
  await stroke(page, origin, 40, 200)
  await frames(page)
  const image = await page.evaluate(async () => {
    const { width, height, data } = await window.engine.readPixels()
    return { width, height, data: Array.from(data) }
  })
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("wet-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })
})

test("a reservoir exhausts its brush colour over a coloured ground", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await stroke(page, origin, 20, 220)
  const ground = rgba(await pixels(page), 190)
  await setColour(page, BLUE)
  await setWet(page, { pickup: 1 }, 0.2)
  await stroke(page, origin, 40, 200)
  const image = await pixels(page)
  expect(distance(rgba(image, 190), ground)).toBeLessThan(15)
  expect(distance(rgba(image, 45), ground)).toBeGreaterThan(25)
})

test("every stroke starts with the current colour after pickup and cancellation", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  await setColour(page, BLUE)
  await setWet(page, { pickup: 1 }, 1)
  await stroke(page, origin, 50, 90)
  await setColour(page, "#20a040")
  await stroke(page, origin, 180, 180)
  expect(
    distance(rgba(await pixels(page), 180), [32, 160, 64, 255])
  ).toBeLessThan(8)
  await page.mouse.move(origin.x + 60, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + 90, origin.y + ROW, { steps: 10 })
  await setTool(page, "eraser")
  await page.mouse.up()
  await setTool(page, "brush")
  await setColour(page, BLUE)
  await stroke(page, origin, 215, 215)
  expect(distance(rgba(await pixels(page), 215), BLUE_PIXEL)).toBeLessThan(8)
})

test("golden: a reservoir stroke carries red across a blue ground", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  // The procedural disc, so the picture owes nothing to a shipped tip.
  await stroke(page, origin, 30, 110)
  await setColour(page, BLUE)
  await stroke(page, origin, 140, 210)
  await setColour(page, RED)
  await setWet(page, { pickup: 0.15 }, 0.03)
  await stroke(page, origin, 40, 200)
  await frames(page)
  const image = await page.evaluate(async () => {
    const { width, height, data } = await window.engine.readPixels()
    return { width, height, data: Array.from(data) }
  })
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("reservoir-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })
})

for (const tool of ["brush", "smudge"] as const)
  test(`${tool}: blue and yellow pass through green`, async ({ page }) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    await setColour(page, "#ffff00")
    await stroke(page, origin, 110, 210)
    await setColour(page, "#0000ff")
    await stroke(page, origin, 30, 90)
    if (tool === "brush") await setWet(page, { pickup: 0.15 }, 0.3)
    else {
      await page.evaluate(() =>
        window.engine.dispatch({ type: "setSmudge", radius: 12, strength: 0.5 })
      )
      await setTool(page, "smudge")
    }
    await stroke(page, origin, 70, 190)
    const image = await pixels(page)
    // A visible green transition, rather than the grey of a light mix.
    const green = Array.from({ length: 90 }, (_, i) =>
      rgba(image, 100 + i)
    ).filter(([r, g, b]) => g > r + 25 && g > b + 25 && g > 60)
    expect(green.length).toBeGreaterThan(3)
    const png = new PNG({ width: WIDTH, height: HEIGHT })
    png.data = Buffer.from(image)
    expect(PNG.sync.write(png)).toMatchSnapshot(
      `${tool}-pigment-transition.png`,
      {
        maxDiffPixelRatio: 0.01,
      }
    )
  })

test("mixing the same paint preserves its colour", async ({ page }) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await stroke(page, origin, 20, 220)
  const before = rgba(await pixels(page), 100)
  await setWet(page, { pickup: 0.5 }, 0.5)
  await stroke(page, origin, 40, 180)
  expect(distance(rgba(await pixels(page), 100), before)).toBeLessThan(3)
})

for (const flow of [0, 1])
  test(`colour jitter leaves picked paint unchanged at flow ${flow}`, async ({
    page,
  }) => {
    async function dragged(jitter: boolean) {
      const origin = await openCanvas(page)
      await addLayer(page)
      await stroke(page, origin, 20, 220)
      await setColour(page, BLUE)
      await setWet(page, { pickup: 1 }, flow)
      await page.evaluate(
        (jitter) =>
          window.engine.dispatch({
            type: "setBrush",
            dynamics: jitter
              ? [
                  {
                    source: "random",
                    target: "hue",
                    range: [0.3, 0.3],
                    mix: "replace",
                  },
                ]
              : [],
          }),
        jitter
      )
      // A full-strength blender over uniform paint can be a no-op,
      // with no undo step to wait for. This check concerns its pixels.
      if (flow === 0) {
        await idleDrag(page, origin, 40, 200)
        await page.evaluate(() => window.engine.save())
      } else await stroke(page, origin, 40, 200)
      return pixels(page)
    }
    const plain = await dragged(false)
    const jittered = await dragged(true)
    if (flow === 0) expect(jittered).toEqual(plain)
    else {
      // The clean load differs at the start, but full pickup replaces it
      // with the same red ground. Carried paint receives no HSL adjustment.
      expect(rgba(jittered, 40)).not.toEqual(rgba(plain, 40))
      expect(rgba(jittered, 190)).toEqual(rgba(plain, 190))
    }
  })
test("a brush can keep its load between strokes and be cleaned by hand", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await paintBar(page, origin)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
    await window.engine.dispatch({ type: "setBrush", wet: { pickup: 0.5 } })
    await window.engine.dispatch({
      type: "setCleanBrushAfterStroke",
      enabled: false,
    })
  })
  await stroke(page, origin, 45, 85)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(true)
  await addLayer(page)
  await stroke(page, origin, 140, 180)
  const carried = await pixels(page)
  await page.evaluate(() => window.engine.dispatch({ type: "cleanBrush" }))
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(false)
  await addLayer(page)
  await stroke(page, origin, 140, 180)
  const clean = await pixels(page)
  expect(distance(rgba(carried, 145), rgba(clean, 145))).toBeGreaterThan(30)
})

/** Leave a blue brush holding the red ground it picked up. */
async function dirtyBrush(page: Page, documentId?: string) {
  const origin = await openCanvas(page, documentId)
  await paintBar(page, origin)
  await setColour(page, BLUE)
  await setWet(page, { pickup: PICKUP })
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setCleanBrushAfterStroke", enabled: false })
  )
  await stroke(page, origin, 45, 85)
  return origin
}

test("cancelling a stroke restores the dirty load, and undo and redo leave it alone", async ({
  page,
}) => {
  let origin = await dirtyBrush(page)
  await addLayer(page)
  await stroke(page, origin, 140, 180)
  const expected = await pixels(page)

  origin = await dirtyBrush(page)
  const before = await pixels(page)
  await page.mouse.move(origin.x + 160, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + 200, origin.y + ROW, { steps: 15 })
  await frames(page)
  await setTool(page, "eraser")
  await page.mouse.up()
  await setTool(page, "brush")
  expect(await pixels(page)).toEqual(before)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(true)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "undo" })
    await window.engine.dispatch({ type: "redo" })
  })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(true)
  await addLayer(page)
  await stroke(page, origin, 140, 180)
  expect(await pixels(page)).toEqual(expected)
})

for (const change of [
  "colour",
  "brush",
  "size",
  "automatic cleaning",
  "mask",
] as const) {
  test(`${change} cleans a retained brush load`, async ({ page }) => {
    const origin = await dirtyBrush(page)
    await page.evaluate(async (change) => {
      if (change === "colour")
        await window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
      if (change === "brush")
        await window.engine.dispatch({ type: "setBrush", id: "another-brush" })
      if (change === "size")
        await window.engine.dispatch({ type: "setBrush", radius: 15 })
      if (change === "automatic cleaning")
        await window.engine.dispatch({
          type: "setCleanBrushAfterStroke",
          enabled: true,
        })
      if (change === "mask") {
        const id = window.engine.getSnapshot().activeLayerId
        await window.engine.dispatch({ type: "addMask", id })
        await window.engine.dispatch({ type: "selectMask", id })
      }
    }, change)
    expect(
      await page.evaluate(() => window.engine.getSnapshot().brushDirty)
    ).toBe(false)
    if (change !== "mask") {
      await addLayer(page)
      await stroke(page, origin, 180, 180)
      expect(distance(rgba(await pixels(page), 180), BLUE_PIXEL)).toBeLessThan(
        8
      )
    }
  })
}

test("reload discards the dirty brush and restores automatic cleaning", async ({
  page,
}) => {
  const documentId = `dirty-${Date.now()}-${Math.random()}`
  await dirtyBrush(page, documentId)
  await page.evaluate(() => window.engine.save())
  await page.reload()
  await openCanvas(page, documentId)
  expect(
    await page.evaluate(() => ({
      dirty: window.engine.getSnapshot().brushDirty,
      clean: window.engine.getSnapshot().cleanBrushAfterStroke,
    }))
  ).toEqual({ dirty: false, clean: true })
})

test("switching to a mask cancels the stroke before cleaning its old load", async ({
  page,
}) => {
  const origin = await dirtyBrush(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "addMask",
      id: window.engine.getSnapshot().activeLayerId,
    })
  })
  await page.mouse.move(origin.x + 150, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + 190, origin.y + ROW, { steps: 15 })
  await frames(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "selectMask",
      id: window.engine.getSnapshot().activeLayerId,
    })
    await window.engine.dispatch({ type: "setTool", tool: "eraser" })
  })
  await page.mouse.up()
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(false)
})

test("importing a document clears the load and its dirty indicator", async ({
  page,
}) => {
  await dirtyBrush(page)
  await page.evaluate(async () => {
    const bytes = await window.engine.exportDocument()
    await window.engine.importDocument(bytes)
  })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(false)
})

test("colour jitter does not refill or recolour a retained dirty load", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await stroke(page, origin, 20, 220)
  await setColour(page, BLUE)
  await setWet(page, { pickup: 1 }, 1)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "setBrush",
      dynamics: [
        { source: "random", target: "hue", range: [0.3, 0.3], mix: "replace" },
      ],
    })
    await window.engine.dispatch({
      type: "setCleanBrushAfterStroke",
      enabled: false,
    })
  })
  await stroke(page, origin, 40, 200)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().brushDirty)
  ).toBe(true)
  await addLayer(page)
  await stroke(page, origin, 180, 180)
  const retained = rgba(await pixels(page), 180)
  expect(distance(retained, [208, 32, 42, 255])).toBeLessThan(8)
  await page.evaluate(() => window.engine.dispatch({ type: "cleanBrush" }))
  await addLayer(page)
  await stroke(page, origin, 180, 180)
  expect(distance(rgba(await pixels(page), 180), retained)).toBeGreaterThan(30)
})

for (const tool of ["brush", "smudge"] as const) {
  test(`${tool} samples visible artwork onto an empty layer without changing the ground`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const groundId = await addLayer(page)
    await paintBar(page, origin)
    const ground = await pixels(page)
    const targetId = await addLayer(page)
    expect(
      await page.evaluate(() => window.engine.getSnapshot().sampleAllLayers)
    ).toBe(false)
    await setColour(page, BLUE)
    if (tool === "brush") await setWet(page, { pickup: 0.8 })
    else {
      await setTool(page, "smudge")
      await page.evaluate(() =>
        window.engine.dispatch({ type: "setSmudge", radius: 12, strength: 1 })
      )
    }
    await page.evaluate(() =>
      window.engine.dispatch({ type: "setSampleAllLayers", enabled: true })
    )
    await stroke(page, origin, 60, 150)
    const painted = await pixels(page)
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
    expect(await pixels(page)).toEqual(ground)
    await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
    expect(await pixels(page)).toEqual(painted)
    if (tool === "brush")
      expect(distance(rgba(painted, 108), rgba(ground, 108))).toBeGreaterThan(
        10
      )
    await page.evaluate(
      (id) => window.engine.dispatch({ type: "setLayer", id, visible: false }),
      targetId
    )
    expect(await pixels(page)).toEqual(ground)
    await page.evaluate(
      async ([groundId, targetId]) => {
        await window.engine.dispatch({
          type: "setLayer",
          id: groundId,
          visible: false,
        })
        await window.engine.dispatch({
          type: "setLayer",
          id: targetId,
          visible: true,
        })
      },
      [groundId, targetId]
    )
    const isolated = await pixels(page)
    const pigment = rgba(isolated, 90)
    expect(pigment[0]).toBeGreaterThan(pigment[2])
  })
}

test("sampled artwork is frozen chunk by chunk as the stroke reaches it", async ({
  page,
}) => {
  // Wider than one chunk of the frozen picture (live brushes 21), which is
  // 1024 px: the stroke opens in the first, where there is nothing, and
  // crosses into the second, where the ground is.
  const wide = 1200
  const at = (image: number[], x: number) =>
    image.slice((ROW * wide + x) * 4, (ROW * wide + x) * 4 + 4)
  await page.setViewportSize({ width: wide + 200, height: 400 })
  const origin = await openCanvas(page, undefined, wide)
  // A second painted layer, far from the stroke: with two to flatten the
  // chunks are composited through their window and not copied from one.
  const farId = await addLayer(page)
  await stroke(page, origin, 100, 140)
  const groundId = await addLayer(page)
  await stroke(page, origin, 1030, 1100)
  const ground = await pixels(page)
  const targetId = await addLayer(page)
  await setColour(page, BLUE)
  await setWet(page, { pickup: 0.8 })
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setSampleAllLayers", enabled: true })
  )
  const setVisible = (id: string, visible: boolean) =>
    page.evaluate(
      ([id, visible]) =>
        window.engine.dispatch({ type: "setLayer", id, visible }),
      [id, visible] as const
    )
  await stroke(page, origin, 990, 1080)
  await setVisible(targetId, false)
  expect(await pixels(page)).toEqual(ground)
  await setVisible(targetId, true)
  await setVisible(groundId, false)
  const carried = await pixels(page)
  const pigment = at(carried, 1066)
  expect(pigment[0]).toBeGreaterThan(pigment[2])
  // With every painted layer hidden the same stroke, on a new layer, finds
  // nothing to pick up: no chunk is read as the stroke before left it.
  await setVisible(targetId, false)
  await setVisible(farId, false)
  await addLayer(page)
  await stroke(page, origin, 990, 1080)
  const alone = await pixels(page)
  const unfed = at(alone, 1066)
  expect(unfed[0]).toBeLessThanOrEqual(unfed[2])
})

for (const stack of [
  "hidden",
  "opacity",
  "mask",
  "group",
  "above",
  "multiply",
] as const) {
  test(`sample all layers respects ${stack} in the pickup picture`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    if (stack === "multiply") {
      await addLayer(page)
      await setColour(page, BLUE)
      await paintBar(page, origin)
      await setColour(page, RED)
    }
    const groundId = await addLayer(page)
    await paintBar(page, origin)
    let rootId = groundId
    await page.evaluate(
      async ({ stack, groundId }) => {
        if (stack === "hidden")
          await window.engine.dispatch({
            type: "setLayer",
            id: groundId,
            visible: false,
          })
        if (stack === "opacity")
          await window.engine.dispatch({
            type: "setLayer",
            id: groundId,
            opacity: 0.4,
          })
        if (stack === "mask") {
          await window.engine.dispatch({ type: "addMask", id: groundId })
          await window.engine.dispatch({ type: "selectMask", id: groundId })
          await window.engine.dispatch({ type: "setColor", hex: "#000000" })
        }
        if (stack === "group") {
          await window.engine.dispatch({ type: "addGroup", ids: [groundId] })
          const group = window.engine
            .getSnapshot()
            .layers.find((layer) => layer.kind === "group")!
          await window.engine.dispatch({
            type: "setLayer",
            id: group.id,
            opacity: 0.4,
          })
        }
        if (stack === "multiply")
          await window.engine.dispatch({
            type: "setLayer",
            id: groundId,
            blend: "multiply",
            opacity: 0.4,
          })
      },
      { stack, groundId }
    )
    if (stack === "mask") {
      await stroke(page, origin, 40, 100)
      await page.evaluate(
        (id) => window.engine.dispatch({ type: "selectLayer", id }),
        groundId
      )
    }
    if (stack === "group")
      rootId = await page.evaluate(
        () =>
          window.engine
            .getSnapshot()
            .layers.find((layer) => layer.kind === "group")!.id
      )
    const reference = await pixels(page)
    const targetId = await addLayer(page)
    if (stack === "group")
      await page.evaluate(
        (id) =>
          window.engine.dispatch({
            type: "moveLayer",
            id,
            parentId: null,
            index: 2,
          }),
        targetId
      )
    if (stack === "above")
      await page.evaluate(
        async ({ groundId, targetId }) => {
          await window.engine.dispatch({
            type: "moveLayer",
            id: groundId,
            index: 2,
          })
          await window.engine.dispatch({ type: "selectLayer", id: targetId })
        },
        { groundId, targetId }
      )
    await page.evaluate(async () => {
      await window.engine.dispatch({ type: "setTool", tool: "smudge" })
      await window.engine.dispatch({
        type: "setSmudge",
        radius: 12,
        strength: 1,
      })
      await window.engine.dispatch({
        type: "setSampleAllLayers",
        enabled: true,
      })
    })
    if (stack === "hidden") await idleDrag(page, origin, 60, 90)
    else await stroke(page, origin, 60, 90)
    await page.evaluate(
      (id) => window.engine.dispatch({ type: "setLayer", id, visible: false }),
      rootId
    )
    if (stack === "multiply")
      await page.evaluate(async (targetId) => {
        for (const layer of window.engine.getSnapshot().layers) {
          if (layer.id !== targetId)
            await window.engine.dispatch({
              type: "setLayer",
              id: layer.id,
              visible: false,
            })
        }
      }, targetId)
    const isolated = await pixels(page)
    expect(distance(rgba(isolated, 80), rgba(reference, 80))).toBeLessThan(8)
  })
}

for (const radius of [0.5, 1, 2, 4, 6, 8, 12, 16, 32])
  test(`a blender at radius ${radius} leaves a smear that only thins`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    const painted = await pixels(page)
    await page.evaluate(
      (radius) => window.engine.dispatch({ type: "setBrush", radius }),
      radius
    )
    await setWet(page, { pickup: 0.9 }, 0)
    if (radius < 1) await idleDrag(page, origin, 80, 160)
    else await stroke(page, origin, 80, 160)
    const dragged = await pixels(page)
    const green = (x: number) => rgba(dragged, x)[1]
    // Begin beyond the painted bar's round end; allow two levels of
    // channel rounding, as the smudge spec does. A subpixel tip may not
    // carry paint as far as this point, but must never leave a comb.
    if (radius >= 1) expect(green(113)).toBeLessThan(rgba(painted, 113)[1])
    for (let x = 112; x < 151; x++)
      expect(green(x + 1) - green(x)).toBeGreaterThanOrEqual(-2)
  })

for (const radius of [2, 4, 8, 16])
  test(`a wet brush with flow at radius ${radius} carries picked-up paint beyond the bar`, async ({
    page,
  }, testInfo) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    const painted = await pixels(page)
    await setColour(page, "#ffffff")
    await page.evaluate(
      (radius) => window.engine.dispatch({ type: "setBrush", radius }),
      radius
    )
    await setWet(page, { pickup: 0.9 }, 0.3)
    await stroke(page, origin, 80, 160)
    const dragged = await pixels(page)
    expect(rgba(dragged, 113)[1]).toBeLessThan(rgba(painted, 113)[1])
    // Reservoir brushes are checked too. Record their largest back-step
    // without requiring monotonicity: bristles retain different paint,
    // unlike a blender's direct hand-off (benchmark, live brushes 23).
    let backStep = 0
    for (let x = 112; x < 151; x++)
      backStep = Math.max(
        backStep,
        rgba(dragged, x)[1] - rgba(dragged, x + 1)[1]
      )
    await testInfo.attach("reservoir-smear", {
      body: JSON.stringify({ radius, backStep }),
      contentType: "application/json",
    })
  })
