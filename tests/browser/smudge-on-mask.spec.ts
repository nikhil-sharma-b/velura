import { expect, test, type Page } from "@playwright/test"
import type { SceneCommand, VectorObject } from "../../engine"

/**
 * Smudge on a layer's mask (smudge 04), through the engine's command seam and
 * the pixels it presents: while a mask is being painted a drag smears the
 * mask, so what it hides and shows is pushed along the stroke, and the
 * layer's own pixels are left as they were.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and smudged along. */
const ROW = 60
/** Where the painted bar starts and stops. */
const BAR = { from: 40, to: 200 }
/** The part of the bar the mask is painted over, and so hides. */
const HIDDEN = { from: 40, to: 110 }

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

const dispatch = (
  page: Page,
  command: Parameters<typeof window.engine.dispatch>[0]
) => page.evaluate((command) => window.engine.dispatch(command), command)

const settle = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )

async function pixels(page: Page) {
  await settle(page)
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

/** A drag with the pen left down at its end. */
async function press(page: Page, origin: Origin, from: number, to: number) {
  await page.mouse.move(origin.x + from, origin.y + ROW)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
}

async function drag(page: Page, origin: Origin, from: number, to: number) {
  await press(page, origin, from, to)
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

/**
 * Gives the active layer a mask hiding the bar's left part, and leaves that
 * mask being painted with smudge in the hand.
 */
async function maskLeft(page: Page, origin: Origin) {
  const id = await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
    await window.engine.dispatch({ type: "setTool", tool: "brush" })
    return id
  })
  await stroke(page, origin, HIDDEN.from, HIDDEN.to)
  await dispatch(page, { type: "setTool", tool: "smudge" })
  return id
}

/**
 * A bar painted on a layer of its own, its left part hidden by a mask that is
 * being painted, smudge in the hand. `shown` is the picture before the mask.
 */
async function openMasked(page: Page, documentId?: string) {
  const origin = await openCanvas(page, documentId)
  await dispatch(page, { type: "addLayer" })
  await stroke(page, origin, BAR.from, BAR.to)
  const shown = await pixels(page)
  const id = await maskLeft(page, origin)
  return { origin, id, shown, masked: await pixels(page) }
}

/** The picture with the layer's mask switched off: the layer's own pixels. */
async function unmasked(page: Page, id: string) {
  await dispatch(page, { type: "setMaskEnabled", id, enabled: false })
  return pixels(page)
}

test("the mask hides the bar's left part and shows its right", async ({
  page,
}) => {
  const { shown, masked } = await openMasked(page)
  expect(distance(rgba(masked, 70), rgba(shown, 70))).toBeGreaterThan(100)
  expect(rgba(masked, 160)).toEqual(rgba(shown, 160))
})

test("a smudge on a mask changes the mask and leaves the layer's own pixels", async ({
  page,
}) => {
  const { origin, id, shown, masked } = await openMasked(page)
  await stroke(page, origin, 90, 160)
  expect(await pixels(page)).not.toEqual(masked)
  expect(await unmasked(page, id)).toEqual(shown)
})

test("dragging from a hidden area into a revealed one carries the hiding along", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  await stroke(page, origin, 90, 160)
  const smudged = await pixels(page)
  // Just past the mask's edge the bar was showing, and is now partly hidden.
  expect(distance(rgba(smudged, 135), rgba(masked, 135))).toBeGreaterThan(60)
  // Well away from the stroke the mask is as it was.
  expect(rgba(smudged, 190)).toEqual(rgba(masked, 190))
})

test("dragging from a revealed area into a hidden one carries the showing along", async ({
  page,
}) => {
  const { origin, shown, masked } = await openMasked(page)
  await stroke(page, origin, 150, 80)
  const smudged = await pixels(page)
  // Inside the hidden part, the bar comes back towards what the layer holds.
  expect(distance(rgba(smudged, 105), rgba(shown, 105))).toBeLessThan(
    distance(rgba(masked, 105), rgba(shown, 105)) - 60
  )
})

test("the picture follows a mask smudge while the pen is still down", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  await press(page, origin, 90, 160)
  const during = await pixels(page)
  expect(distance(rgba(during, 135), rgba(masked, 135))).toBeGreaterThan(60)
  await page.mouse.up()
})

test("one undo restores the mask, and redo brings the smudge back", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  const before = await steps(page)
  await stroke(page, origin, 90, 160)
  expect(await steps(page)).toBe(before + 1)
  const smudged = await pixels(page)

  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(masked)
  await dispatch(page, { type: "redo" })
  expect(await pixels(page)).toEqual(smudged)
})

test("a mask smudge cancelled mid-stroke leaves the mask unchanged", async ({
  page,
}) => {
  const { origin, masked } = await openMasked(page)
  const before = await steps(page)
  await press(page, origin, 90, 160)
  expect(await pixels(page)).not.toEqual(masked)
  // Putting the tool down takes the stroke in flight back.
  await dispatch(page, { type: "setTool", tool: "brush" })
  await page.mouse.up()
  expect(await pixels(page)).toEqual(masked)
  expect(await steps(page)).toBe(before)
})

test("a smudge smears the mask of a vector layer", async ({ page }) => {
  const origin = await openCanvas(page)
  const bar: VectorObject = {
    id: "bar",
    geometry: {
      kind: "rect",
      x: BAR.from,
      y: ROW - 12,
      width: BAR.to - BAR.from,
      height: 24,
    },
    transform: [1, 0, 0, 1, 0, 0],
    style: {
      fill: { color: "#2a6ad0", opacity: 1, rule: "nonzero" },
      stroke: null,
    },
  }
  await page.evaluate(async (object) => {
    await window.engine.dispatch({ type: "addVectorLayer" })
    const id = window.engine.getSnapshot().activeLayerId
    const commands: SceneCommand[] = [{ type: "add", object }]
    await window.engine.dispatch({ type: "editVectorLayer", id, commands })
  }, bar)
  const shown = await pixels(page)
  const id = await maskLeft(page, origin)
  const masked = await pixels(page)

  await stroke(page, origin, 90, 160)
  const smudged = await pixels(page)
  expect(distance(rgba(smudged, 135), rgba(masked, 135))).toBeGreaterThan(60)
  // The shapes are what they were: only the mask over them moved.
  expect(await unmasked(page, id)).toEqual(shown)
})

test("once the mask is no longer being painted, smudge smears the layer's paint", async ({
  page,
}) => {
  const { origin, id, shown } = await openMasked(page)
  await dispatch(page, { type: "selectLayer", id })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().paintingMask)
  ).toBe(false)
  // Out of the bar's right end, where the mask shows everything.
  await stroke(page, origin, 180, 230)
  const paint = await unmasked(page, id)
  expect(paint).not.toEqual(shown)
  expect(distance(rgba(paint, 222), rgba(shown, 222))).toBeGreaterThan(60)
})

test("a smudged mask survives a reload", async ({ page }) => {
  const documentId = `smudge-mask-${Date.now()}-${Math.random()}`
  const { origin, masked } = await openMasked(page, documentId)
  await stroke(page, origin, 90, 160)
  const smudged = await pixels(page)
  expect(smudged).not.toEqual(masked)
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openCanvas(page, documentId)
  expect(await pixels(page)).toEqual(smudged)
})

test("a higher strength carries the mask further along the same stroke", async ({
  page,
}) => {
  const carried = async (strength: number) => {
    const { origin, masked } = await openMasked(page)
    await dispatch(page, { type: "setSmudge", strength })
    await stroke(page, origin, 90, 160)
    const smudged = await pixels(page)
    return distance(rgba(smudged, 135), rgba(masked, 135))
  }
  const soft = await carried(0.3)
  const hard = await carried(0.95)
  expect(hard).toBeGreaterThan(soft)
})

test("a larger smudge reaches further off the path on a mask", async ({
  page,
}) => {
  // Inside the bar's height past the mask's edge, where a small dab does not
  // reach.
  const off = { x: 135, y: ROW - 9 }
  const moved = async (radius: number) => {
    const { origin, masked } = await openMasked(page)
    await dispatch(page, { type: "setSmudge", radius })
    await stroke(page, origin, 90, 160)
    const smudged = await pixels(page)
    return distance(rgba(smudged, off.x, off.y), rgba(masked, off.x, off.y))
  }
  expect(await moved(4)).toBe(0)
  expect(await moved(20)).toBeGreaterThan(0)
})

test("a light pen stroke carries the mask less far than a hard one", async ({
  page,
}) => {
  const carried = async (pressure: number) => {
    const { masked } = await openMasked(page)
    await dispatch(page, { type: "setSmudge", strength: 0.95 })
    const before = await steps(page)
    // The pen's own events, so the stroke carries the pressure asked for.
    await page.evaluate(
      ([pressure, row]) => {
        const canvas = document.querySelector("canvas")!
        const bounds = canvas.getBoundingClientRect()
        const send = (type: string, x: number) =>
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 1,
              pointerType: "pen",
              isPrimary: true,
              bubbles: true,
              cancelable: true,
              buttons: type === "pointerup" ? 0 : 1,
              clientX: bounds.left + x,
              clientY: bounds.top + row,
              pressure,
            })
          )
        send("pointerdown", 90)
        for (let step = 1; step <= 40; step++)
          send("pointerrawupdate", 90 + (70 * step) / 40)
        send("pointerup", 160)
      },
      [pressure, ROW] as const
    )
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      before
    )
    const smudged = await pixels(page)
    return distance(rgba(smudged, 135), rgba(masked, 135))
  }
  const light = await carried(0.3)
  const hard = await carried(1)
  expect(hard).toBeGreaterThan(light)
})

test("a mask smudge stays inside the selection", async ({ page }) => {
  const { origin, masked } = await openMasked(page)
  // Selected from inside the hidden part rightwards; the stroke crosses in
  // from the left.
  const edge = 100
  await dispatch(page, {
    type: "selectShape",
    shape: "rect",
    x: edge,
    y: 0,
    width: WIDTH - edge,
    height: HEIGHT,
  })
  await stroke(page, origin, 90, 170)
  const smudged = await pixels(page)
  for (let y = 0; y < HEIGHT; y++)
    expect(smudged.slice(y * WIDTH * 4, (y * WIDTH + edge) * 4)).toEqual(
      masked.slice(y * WIDTH * 4, (y * WIDTH + edge) * 4)
    )
  expect(distance(rgba(smudged, 135), rgba(masked, 135))).toBeGreaterThan(60)
})

// The tool on the real studio, over a vector layer whose mask is being painted.
test("painting a vector layer's mask, smudge is offered and the layer does not say it holds shapes", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  await page.getByRole("button", { name: "Add vector layer" }).click()
  await page.getByText("Layer properties").click()
  await page.getByRole("button", { name: "Add mask" }).click()
  await page.getByRole("button", { name: "Paint mask" }).click()
  const smudge = page.getByRole("button", { name: "Smudge tool" })
  await smudge.click()
  await expect(smudge).toHaveAttribute("aria-pressed", "true")
  await expect(smudge).not.toHaveClass(/(^|\s)opacity-40/)

  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.up()
  await expect(page.getByText(/holds\s+shapes/)).toBeHidden()
})
