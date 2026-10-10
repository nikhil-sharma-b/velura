import { expect, test, type Page } from "@playwright/test"

/**
 * Smudge (smudge 01), through the engine's command seam and the pixels it
 * presents: a drag moves the paint already on the active layer, transparency
 * included, lays down nothing of its own, and is one undo step.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and smudged along. */
const ROW = 60
/** Where the painted bar starts and stops. */
const BAR = { from: 40, to: 100 }

type Origin = { x: number; y: number }

async function openCanvas(page: Page, documentId?: string): Promise<Origin> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, documentId]) => {
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
      await window.engine.dispatch({ type: "setBrush", radius: 12 })
      await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
    },
    [WIDTH, HEIGHT, documentId] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

const addLayer = (page: Page) =>
  page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot().activeLayerId
  })

async function pixels(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
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

const setTool = (page: Page, tool: "brush" | "smudge") =>
  page.evaluate(
    (tool) => window.engine.dispatch({ type: "setTool", tool }),
    tool
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
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

const paintBar = (page: Page, origin: Origin) =>
  stroke(page, origin, BAR.from, BAR.to)

test("smudging out of paint carries its colour along the stroke", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  // Well past the bar's round end, nothing is painted yet.
  expect(rgba(painted, 130)).toEqual(rgba(empty, 130))

  await setTool(page, "smudge")
  await stroke(page, origin, 80, 160)
  const smudged = await pixels(page)

  // Paint has been pulled into what was empty, towards its own colour.
  const paint = rgba(painted, 80)
  expect(distance(rgba(smudged, 130), paint)).toBeLessThan(
    distance(rgba(empty, 130), paint)
  )
  // And more of it nearer where the stroke began than where it ended.
  expect(distance(rgba(smudged, 120), paint)).toBeLessThan(
    distance(rgba(smudged, 155), paint)
  )
})

test("smudging from an empty area into paint carries transparency in", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  const empty = await pixels(page)
  await paintBar(page, origin)
  const painted = await pixels(page)

  await setTool(page, "smudge")
  await stroke(page, origin, 160, 70)
  const smudged = await pixels(page)

  // Inside the bar, near the end the stroke came in by, paint has thinned
  // towards what shows through an empty layer.
  expect(distance(rgba(smudged, 100), rgba(empty, 100))).toBeLessThan(
    distance(rgba(painted, 100), rgba(empty, 100))
  )
})

test("a smudge lays down nothing of its own", async ({ page }) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
  )
  const empty = await pixels(page)
  await setTool(page, "smudge")
  const before = await steps(page)

  // Over a layer that has never held a pixel.
  await idleDrag(page, origin, 40, 180)
  expect(await pixels(page)).toEqual(empty)
  expect(await steps(page)).toBe(before)

  // And over the empty part of one that holds paint elsewhere.
  await setTool(page, "brush")
  await stroke(page, origin, 20, 40)
  const painted = await pixels(page)
  await setTool(page, "smudge")
  const paintedSteps = await steps(page)
  await idleDrag(page, origin, 120, 220)
  await page.evaluate(() => window.engine.save())
  expect(await pixels(page)).toEqual(painted)
  // Nothing moved, so there is nothing for undo to take back.
  expect(await steps(page)).toBe(paintedSteps)
})

test("a smudge changes only the active layer", async ({ page }) => {
  const origin = await openCanvas(page)
  const colour = (hex: string) =>
    page.evaluate(
      (hex) => window.engine.dispatch({ type: "setColor", hex }),
      hex
    )
  const show = (id: string, visible: boolean) =>
    page.evaluate(
      ([id, visible]) =>
        window.engine.dispatch({ type: "setLayer", id, visible }),
      [id, visible] as const
    )
  // Paint under the smudge's path on the layer below, the one smudged, and
  // the one above.
  await addLayer(page)
  await colour("#1040e0")
  await stroke(page, origin, 20, 200)
  const middle = await addLayer(page)
  await colour("#d0202a")
  await paintBar(page, origin)
  await addLayer(page)
  await colour("#20a040")
  await stroke(page, origin, 120, 220)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    middle
  )
  const whole = await pixels(page)
  await show(middle, false)
  const others = await pixels(page)
  await show(middle, true)

  await setTool(page, "smudge")
  await stroke(page, origin, 80, 160)
  expect(await pixels(page)).not.toEqual(whole)
  await show(middle, false)
  expect(await pixels(page)).toEqual(others)
})

test("the dab takes the shape of the brush's tip", async ({ page }) => {
  // A point the round dab reaches and a tip squashed flat does not.
  const off = { x: 125, y: ROW - 9 }
  async function smudgedWith(roundness: number) {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    const painted = await pixels(page)
    await page.evaluate(
      (roundness) => window.engine.dispatch({ type: "setBrush", roundness }),
      roundness
    )
    await setTool(page, "smudge")
    await stroke(page, origin, 80, 160)
    const smudged = await pixels(page)
    return {
      onPath: distance(rgba(smudged, off.x), rgba(painted, off.x)),
      offPath: distance(
        rgba(smudged, off.x, off.y),
        rgba(painted, off.x, off.y)
      ),
    }
  }
  const round = await smudgedWith(1)
  const flat = await smudgedWith(0.2)
  expect(round.onPath).toBeGreaterThan(0)
  expect(round.offPath).toBeGreaterThan(0)
  expect(flat.onPath).toBeGreaterThan(0)
  expect(flat.offPath).toBe(0)
})

test("a smudge stroke is one undo step, and redo brings it back", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  const before = await steps(page)

  await setTool(page, "smudge")
  await stroke(page, origin, 80, 160)
  const smudged = await pixels(page)
  expect(smudged).not.toEqual(painted)
  expect(await steps(page)).toBe(before + 1)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(painted)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await pixels(page)).toEqual(smudged)
})

for (const [name, command] of [
  ["putting the tool down", { type: "setTool", tool: "brush" }],
  ["undo", { type: "undo" }],
] as const)
  test(`a smudge cancelled mid-stroke by ${name} leaves the layer unchanged`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await addLayer(page)
    await paintBar(page, origin)
    const painted = await pixels(page)
    const before = await steps(page)

    await setTool(page, "smudge")
    await page.mouse.move(origin.x + 80, origin.y + ROW)
    await page.mouse.down()
    await page.mouse.move(origin.x + 160, origin.y + ROW, { steps: 30 })
    // The smear is in the layer while the pen is still down.
    expect(await pixels(page)).not.toEqual(painted)
    await page.evaluate((command) => window.engine.dispatch(command), command)
    await page.mouse.up()

    expect(await pixels(page)).toEqual(painted)
    expect(await steps(page)).toBe(before)
  })

test("a smudged layer survives a reload", async ({ page }) => {
  const documentId = `smudge-${Date.now()}-${Math.random()}`
  const origin = await openCanvas(page, documentId)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  await setTool(page, "smudge")
  await stroke(page, origin, 80, 160)
  const smudged = await pixels(page)
  expect(smudged).not.toEqual(painted)
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openCanvas(page, documentId)
  expect(await pixels(page)).toEqual(smudged)
})

test("a vector layer is not smudged, and the tool stays in the hand", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  await page.evaluate(() => window.engine.dispatch({ type: "addVectorLayer" }))
  const before = await pixels(page)
  const stepsBefore = await steps(page)

  await setTool(page, "smudge")
  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(before)
  expect(await steps(page)).toBe(stepsBefore)
  expect(await page.evaluate(() => window.engine.getSnapshot().tool)).toBe(
    "smudge"
  )
})

test("a locked layer is not smudged", async ({ page }) => {
  const origin = await openCanvas(page)
  const id = await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, locked: true }),
    id
  )
  const before = await steps(page)

  await setTool(page, "smudge")
  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
})

/**
 * Smudge's own size and strength (smudge 02), and what a pen's pressure does
 * to the strength.
 */
const setSmudge = (
  page: Page,
  settings: { radius?: number; strength?: number }
) =>
  page.evaluate(
    (settings) => window.engine.dispatch({ type: "setSmudge", ...settings }),
    settings
  )

/**
 * A drag along the row as one device's own events, so the same path can be
 * drawn by a pen at a chosen pressure and by a mouse.
 */
async function deviceDrag(
  page: Page,
  pointerType: "pen" | "mouse",
  pressure: number,
  from: number,
  to: number,
  liftPressure = pressure
) {
  await page.evaluate(
    ([pointerType, pressure, from, to, row, liftPressure]) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (type: string, x: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: bounds.left + x,
            clientY: bounds.top + row,
            pressure: type === "pointerup" ? liftPressure : pressure,
          })
        )
      send("pointerdown", from)
      for (let step = 1; step <= 40; step++)
        send("pointerrawupdate", from + ((to - from) * step) / 40)
      send("pointerup", to)
    },
    [pointerType, pressure, from, to, ROW, liftPressure] as const
  )
}

/** A painted bar, smudged out of its end by one device, as pixels. */
async function smudgedBy(
  page: Page,
  settings: { radius?: number; strength?: number },
  pointerType: "pen" | "mouse",
  pressure: number,
  liftPressure = pressure
) {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  await setTool(page, "smudge")
  await setSmudge(page, settings)
  const before = await steps(page)
  await deviceDrag(page, pointerType, pressure, 80, 160, liftPressure)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  return { painted, smudged: await pixels(page) }
}

/** How far short of the bar's own colour a point past its end is left. */
const short = (run: { painted: number[]; smudged: number[] }, x = 140) =>
  distance(rgba(run.smudged, x), rgba(run.painted, 80))

test("a higher strength carries paint further along the same stroke", async ({
  page,
}) => {
  const low = await smudgedBy(page, { strength: 0.5 }, "mouse", 0.5)
  const high = await smudgedBy(page, { strength: 0.95 }, "mouse", 0.5)
  expect(short(high)).toBeLessThan(short(low))
})

test("at zero strength a stroke leaves the layer unchanged", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)
  await setTool(page, "smudge")
  await setSmudge(page, { strength: 0 })
  const before = await steps(page)

  await idleDrag(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(painted)
  // Nothing moved, so there is nothing for undo to take back.
  expect(await steps(page)).toBe(before)
})

test("a light pen stroke carries paint less far than a hard one", async ({
  page,
}) => {
  const light = await smudgedBy(page, { strength: 0.95 }, "pen", 0.3)
  const hard = await smudgedBy(page, { strength: 0.95 }, "pen", 1)
  expect(short(hard)).toBeLessThan(short(light))
})

test("full pen pressure reaches the strength setting and no more, which is where a mouse runs", async ({
  page,
}) => {
  const pen = await smudgedBy(page, { strength: 0.7 }, "pen", 1)
  // A mouse has no sensor, so what it reports as pressure is not read.
  const mouse = await smudgedBy(page, { strength: 0.7 }, "mouse", 0.5)
  expect(pen.smudged).toEqual(mouse.smudged)
  // And neither reaches what a higher setting does.
  const higher = await smudgedBy(page, { strength: 0.95 }, "pen", 1)
  expect(short(higher)).toBeLessThan(short(pen))
})

test("a pen that reports no pressure smudges at the strength setting, as a mouse does", async ({
  page,
}) => {
  // A pen with no force sensor: the browser fills in 0.5 while it is down
  // (smudge 07), which is not half a press. It lifts on zero, as every
  // device does, and that is not a reading either.
  const sensorless = await smudgedBy(page, { strength: 0.7 }, "pen", 0.5, 0)
  const mouse = await smudgedBy(page, { strength: 0.7 }, "mouse", 0.5)
  expect(sensorless.smudged).toEqual(mouse.smudged)
})

test("a pen held at a steady pressure away from the stand-in still softens the smudge", async ({
  page,
}) => {
  const steady = await smudgedBy(page, { strength: 0.7 }, "pen", 0.4)
  const mouse = await smudgedBy(page, { strength: 0.7 }, "mouse", 0.5)
  expect(short(mouse)).toBeLessThan(short(steady))
})

test("the smudge's size is its own: a larger one reaches further off the path", async ({
  page,
}) => {
  // Inside the bar's height past its end, where a small dab does not reach.
  const off = { x: 125, y: ROW - 9 }
  const moved = (run: { painted: number[]; smudged: number[] }) =>
    distance(rgba(run.smudged, off.x, off.y), rgba(run.painted, off.x, off.y))
  const small = await smudgedBy(page, { radius: 4 }, "mouse", 0.5)
  expect(moved(small)).toBe(0)
  const large = await smudgedBy(page, { radius: 20 }, "mouse", 0.5)
  expect(moved(large)).toBeGreaterThan(0)
})

test("smudge and brush keep their sizes apart, through a change of tool", async ({
  page,
}) => {
  await openCanvas(page)
  const sizes = () =>
    page.evaluate(() => {
      const { brush, smudge } = window.engine.getSnapshot()
      return { brush: brush.shape.radius, smudge }
    })
  await setTool(page, "smudge")
  await setSmudge(page, { radius: 30, strength: 0.4 })
  expect(await sizes()).toEqual({
    brush: 12,
    smudge: { radius: 30, strength: 0.4 },
  })

  await setTool(page, "brush")
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setBrush", radius: 5 })
  )
  await setTool(page, "smudge")
  expect(await sizes()).toEqual({
    brush: 5,
    smudge: { radius: 30, strength: 0.4 },
  })
})

test("a smudge setting the tool cannot hold is refused", async ({ page }) => {
  await openCanvas(page)
  for (const settings of [{ strength: 1.5 }, { strength: -0.1 }, { radius: 0 }])
    await expect(setSmudge(page, settings)).rejects.toThrow()
  expect(await page.evaluate(() => window.engine.getSnapshot().smudge)).toEqual(
    { radius: 16, strength: 0.9 }
  )
})

/**
 * The tool on the real studio: where it sits in the rail, the key that picks
 * it, and what it says on a layer it cannot work on.
 */
async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  return page.getByRole("img", { name: "Drawing canvas" })
}

test("the smudge tool sits after the eraser and says what it works on", async ({
  page,
}) => {
  await openStudio(page)
  const tools = page
    .getByRole("group", { name: "Paint tools" })
    .getByRole("button")
  await expect(tools).toHaveCount(3)
  await expect(tools.nth(1)).toHaveAccessibleName("Eraser tool")
  await expect(tools.nth(2)).toHaveAccessibleName("Smudge tool")

  const smudge = page.getByRole("button", { name: "Smudge tool" })
  await expect(smudge).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("s")
  await expect(smudge).toHaveAttribute("aria-pressed", "true")

  await smudge.hover()
  const tooltip = page.getByRole("tooltip")
  await expect(tooltip).toContainText("Works on paint layers")
  await expect(tooltip).toContainText("S")
})

test("on a vector layer the smudge tool stays in the hand and says the layer holds shapes", async ({
  page,
}) => {
  const canvas = await openStudio(page)
  await page.getByRole("button", { name: "Add vector layer" }).click()
  const smudge = page.getByRole("button", { name: "Smudge tool" })
  await smudge.click()
  await expect(smudge).toHaveAttribute("aria-pressed", "true")

  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByText(/holds\s+shapes/)).toBeVisible()
  await expect(smudge).toHaveAttribute("aria-pressed", "true")
})

const quick = (page: Page, label: string) =>
  page.getByRole("button", { name: new RegExp(`^${label}:`) })

/** Types a value into the setting whose popover is opened from the rail. */
async function setQuick(page: Page, label: string, value: string) {
  await quick(page, label).click()
  const field = page.getByRole("textbox", { name: label, exact: true })
  await field.fill(value)
  await field.press("Enter")
  await page.keyboard.press("Escape")
}

test("with smudge in the hand the options are its size and strength, kept apart from the brush's", async ({
  page,
}) => {
  await openStudio(page)
  const brushSize = await quick(page, "Size").getAttribute("aria-label")
  await expect(quick(page, "Opacity")).toBeVisible()
  await expect(quick(page, "Strength")).toHaveCount(0)

  await page.keyboard.press("s")
  await expect(quick(page, "Size")).toHaveAccessibleName("Size: 32.0 px")
  await expect(quick(page, "Strength")).toHaveAccessibleName("Strength: 90%")
  await expect(quick(page, "Opacity")).toHaveCount(0)

  await setQuick(page, "Size", "60")
  await setQuick(page, "Strength", "45")
  await expect(quick(page, "Size")).toHaveAccessibleName("Size: 60.0 px")
  await expect(quick(page, "Strength")).toHaveAccessibleName("Strength: 45%")

  // The brush's size is where it was, and changing it leaves the smudge's.
  await page.keyboard.press("b")
  await expect(quick(page, "Size")).toHaveAccessibleName(brushSize!)
  await setQuick(page, "Size", "9")
  await page.keyboard.press("s")
  await expect(quick(page, "Size")).toHaveAccessibleName("Size: 60.0 px")
  await expect(quick(page, "Strength")).toHaveAccessibleName("Strength: 45%")
})

test("the size keys change the smudge's size while it is in the hand, and not the brush's", async ({
  page,
}) => {
  await openStudio(page)
  const brushSize = await quick(page, "Size").getAttribute("aria-label")
  await page.keyboard.press("s")
  await page.keyboard.press("]")
  await expect(quick(page, "Size")).not.toHaveAccessibleName("Size: 32.0 px")
  const grown = await quick(page, "Size").getAttribute("aria-label")
  expect(Number.parseFloat(grown!.slice("Size: ".length))).toBeGreaterThan(32)
  await page.keyboard.press("[")
  await expect(quick(page, "Size")).toHaveAccessibleName("Size: 32.0 px")

  await page.keyboard.press("b")
  await expect(quick(page, "Size")).toHaveAccessibleName(brushSize!)
})

test("smudge size and strength come back after a reload", async ({ page }) => {
  await openStudio(page)
  await page.keyboard.press("s")
  await setQuick(page, "Size", "60")
  await setQuick(page, "Strength", "45")
  // Remembered once the hand has settled, as the brush's size is.
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("velura.brushes") ?? "")
    )
    .toContain('"strength":0.45')

  await page.reload()
  await openStudio(page)
  await page.keyboard.press("s")
  await expect(quick(page, "Size")).toHaveAccessibleName("Size: 60.0 px")
  await expect(quick(page, "Strength")).toHaveAccessibleName("Strength: 45%")
})

test("the canvas cursor shows the smudge's size while smudge is in the hand", async ({
  page,
}) => {
  const canvas = await openStudio(page)
  const box = (await canvas.boundingBox())!
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const ring = page.getByTestId("size-cursor")
  await page.mouse.move(at.x, at.y)
  // The brush keeps its dot.
  await expect(ring).toBeHidden()

  // Picked up by its key, the ring is there before the pointer moves.
  await page.keyboard.press("s")
  await expect(ring).toBeVisible()
  const first = (await ring.boundingBox())!
  // Round, and centred on the pointer.
  expect(first.width).toBeCloseTo(first.height, 0)
  expect(first.x + first.width / 2).toBeCloseTo(at.x, 0)
  expect(first.y + first.height / 2).toBeCloseTo(at.y, 0)

  // Twice the size, twice the ring.
  await setQuick(page, "Size", "64")
  await page.mouse.move(at.x, at.y)
  await expect
    .poll(async () => (await ring.boundingBox())!.width / first.width)
    .toBeCloseTo(2, 1)

  await page.keyboard.press("b")
  await expect(ring).toBeHidden()
})

test("a smudge picks the frame of a multi-frame tip as the brush would", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addLayer(page)
  await paintBar(page, origin)
  const painted = await pixels(page)

  // A tip whose first frame covers nothing and whose second covers the dab:
  // taken in turn, every other dab smears; held at the first, none does.
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "registerTexture",
      id: "blank-then-full",
      texture: {
        width: 1,
        height: 1,
        frameCount: 2,
        data: new Uint8Array([0, 255]),
      },
    })
    await window.engine.dispatch({
      type: "setBrush",
      tipTextureId: "blank-then-full",
      tipSelection: "sequential",
    })
  })
  await setTool(page, "smudge")
  await idleDrag(page, origin, 80, 160)

  const smudged = await pixels(page)
  expect(distance(rgba(smudged, 120), rgba(painted, 120))).toBeGreaterThan(0)
})

test("a cancelled smudge that crossed many tiles leaves the layer unchanged", async ({
  page,
}) => {
  test.setTimeout(120_000)
  // Nine tiles a side, the last of each row and column cut short by the
  // canvas, and a stroke that sweeps nearly all of them.
  const SIZE = 2200
  const ROWS = [300, 900, 1500, 2100]
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async (size) => {
    window.remountEngine()
    await window.engine.dispatch({
      type: "resize",
      width: size,
      height: size,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    const state = window.engine.getSnapshot()
    if (state.status !== "ready") throw new Error(state.error ?? state.status)
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    await window.engine.dispatch({ type: "setBrush", radius: 60 })
    await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
    await window.engine.dispatch({ type: "addLayer" })
  }, SIZE)

  /** Pen-down at the first point and a drag through the rest, pen still down. */
  const press = (points: [number, number][]) =>
    page.evaluate(async (points) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (type: string, [x, y]: [number, number]) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "pen",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: 1,
            clientX: bounds.left + x,
            clientY: bounds.top + y,
            pressure: 1,
          })
        )
      const frame = () =>
        new Promise((resolve) => requestAnimationFrame(resolve))
      send("pointerdown", points[0])
      for (let next = 1; next < points.length; next++) {
        const [fromX, fromY] = points[next - 1]
        const [toX, toY] = points[next]
        for (let step = 1; step <= 16; step++) {
          const at: [number, number] = [
            fromX + ((toX - fromX) * step) / 16,
            fromY + ((toY - fromY) * step) / 16,
          ]
          send("pointerrawupdate", at)
          send("pointermove", at)
          if (step % 4 === 0) await frame()
        }
      }
      await frame()
    }, points)
  const lift = () =>
    page.evaluate(async () => {
      document.querySelector("canvas")!.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: 1,
          pointerType: "pen",
          isPrimary: true,
          bubbles: true,
          cancelable: true,
        })
      )
      await new Promise((resolve) => requestAnimationFrame(resolve))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
  /** The whole picture as one number: it is too large to bring across. */
  const picture = () =>
    page.evaluate(async () => {
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
      const { data } = await window.engine.readPixels()
      let hash = 2166136261
      for (let i = 0; i < data.length; i++)
        hash = Math.imul(hash ^ data[i], 16777619)
      return hash >>> 0
    })

  for (const y of ROWS) {
    const before = await steps(page)
    await press([
      [500, y],
      [1800, y],
    ])
    await lift()
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      before
    )
  }
  const painted = await picture()
  const before = await steps(page)

  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "smudge" })
    await window.engine.dispatch({ type: "setSmudge", radius: 150 })
  })
  // Back and forth down the canvas, through the paint and out the far side.
  await press(
    ROWS.flatMap((y, row): [number, number][] =>
      row % 2 === 0
        ? [
            [200, y],
            [2100, y],
          ]
        : [
            [2100, y],
            [200, y],
          ]
    )
  )
  expect(await picture()).not.toBe(painted)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "brush" })
  )
  await lift()

  expect(await picture()).toBe(painted)
  expect(await steps(page)).toBe(before)
})
