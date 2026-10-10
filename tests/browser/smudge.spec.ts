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
