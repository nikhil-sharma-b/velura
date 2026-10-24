import { expect, test, type Page } from "@playwright/test"

/**
 * Smudging inside the selection (smudge 03), through the engine's command
 * seam and the pixels it presents: the selection limits what a smear writes
 * and not what it reads, so paint outside can be dragged in while nothing
 * outside changes, a soft edge takes the smear in proportion, and a stroke
 * that reaches nothing selected is not a step.
 */

const WIDTH = 240
const HEIGHT = 120
/** The row the paint is laid on and smudged along. */
const ROW = 60
/** The selected box, which every crossing stroke enters by its left edge. */
const BOX = { x: 120, y: 30, width: 60, height: 60 }
/**
 * The drag that paints the bar. It runs on into the box, but is painted with
 * everything except the box selected: the paint stops flush against the
 * box's left edge and the box itself holds none.
 */
const BAR = { from: 40, to: 150 }

type Origin = { x: number; y: number }

async function openCanvas(page: Page): Promise<Origin> {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height]) => {
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
      await window.engine.dispatch({ type: "setBrush", radius: 12 })
      await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

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

/** The selection's coverage, one byte per document pixel. */
const coverage = (page: Page) =>
  page.evaluate(async () =>
    Array.from((await window.engine.readSelection())!.data)
  )

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

const dispatch = (
  page: Page,
  command: Parameters<typeof window.engine.dispatch>[0]
) => page.evaluate((command) => window.engine.dispatch(command), command)

const select = (page: Page, box = BOX) =>
  dispatch(page, { type: "selectShape", shape: "rect", ...box })

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

/** A canvas with the bar painted on a layer of its own, smudge in the hand. */
async function openPainted(page: Page) {
  const origin = await openCanvas(page)
  await select(page)
  await dispatch(page, { type: "invertSelection" })
  await stroke(page, origin, BAR.from, BAR.to)
  await dispatch(page, { type: "deselect" })
  await dispatch(page, { type: "setTool", tool: "smudge" })
  return { origin, painted: await pixels(page) }
}

const inBox = (x: number, y: number) =>
  x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height

const outBox = (x: number, y: number) => !inBox(x, y)

/** Every channel of the pixels the predicate picks. */
function pick(image: number[], wanted: (x: number, y: number) => boolean) {
  const out: number[] = []
  for (let y = 0; y < HEIGHT; y++)
    for (let x = 0; x < WIDTH; x++)
      if (wanted(x, y))
        out.push(...image.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 4))
  return out
}

/** How far one pixel is apart in two images, summed over its channels. */
function change(a: number[], b: number[], x: number, y = ROW) {
  let sum = 0
  for (let c = 0; c < 4; c++) {
    const i = (y * WIDTH + x) * 4 + c
    sum += Math.abs(a[i] - b[i])
  }
  return sum
}

test("a smudge across the selection's edge changes nothing outside it, and carries outside paint in", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page)
  await select(page)
  // From the bar, outside the box, into the box.
  await stroke(page, origin, 80, 160)
  const smudged = await pixels(page)

  expect(pick(smudged, outBox)).toEqual(pick(painted, outBox))
  // The box held no paint: what is in it now was read from outside.
  const [r, g, b] = smudged.slice((ROW * WIDTH + 130) * 4)
  const [r0, g0, b0] = painted.slice((ROW * WIDTH + 130) * 4)
  expect(change(smudged, painted, 130)).toBeGreaterThan(0)
  expect(r - g).toBeGreaterThan(r0 - g0)
  expect(r - b).toBeGreaterThan(r0 - b0)
})

test("inside the selection a smudge smears as it does with nothing selected", async ({
  page,
}) => {
  const { origin } = await openPainted(page)
  await stroke(page, origin, 80, 160)
  const free = await pixels(page)
  await dispatch(page, { type: "undo" })

  // Wide enough to hold every pixel the stroke reaches.
  await select(page, { x: 20, y: 10, width: 200, height: 100 })
  await stroke(page, origin, 80, 160)
  expect(await pixels(page)).toEqual(free)
})

test("along a feathered edge the smudge fades with the selection's strength", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page)
  // Out of the empty box and back over the bar's end, dragging emptiness
  // into the paint beside the box.
  await stroke(page, origin, 160, 80)
  const free = await pixels(page)
  await dispatch(page, { type: "undo" })

  await select(page)
  await dispatch(page, { type: "featherSelection", radius: 8 })
  const mask = await coverage(page)
  await stroke(page, origin, 160, 80)
  const smudged = await pixels(page)

  // Where nothing is selected, nothing changed.
  expect(pick(smudged, (x, y) => mask[y * WIDTH + x] === 0)).toEqual(
    pick(painted, (x, y) => mask[y * WIDTH + x] === 0)
  )
  // The paint under the feather's skirt, outside the box, lost part of
  // itself: some, and less than it loses with nothing holding the smear back.
  const at = (x: number) => mask[ROW * WIDTH + x]
  const skirt = Array.from({ length: BOX.x }, (_, x) => x).filter(
    (x) => at(x) > 0 && at(x) < 128
  )
  expect(skirt.length).toBeGreaterThan(2)
  for (const x of skirt) {
    expect(change(smudged, painted, x)).toBeGreaterThan(0)
    expect(change(smudged, painted, x)).toBeLessThan(change(free, painted, x))
  }
  // And the more of a pixel is selected, the more of the smear it took.
  const taken = skirt.map((x) => change(smudged, painted, x))
  expect(taken).toEqual([...taken].sort((a, b) => a - b))
  expect(taken[taken.length - 1]).toBeGreaterThan(taken[0])
})

test("with the selection inverted, the smudge changes only what is now selected", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page)
  await select(page)
  await dispatch(page, { type: "invertSelection" })
  // Out of the box, where nothing is painted, and back over the bar's end.
  await stroke(page, origin, 160, 80)
  const smudged = await pixels(page)

  expect(pick(smudged, inBox)).toEqual(pick(painted, inBox))
  expect(pick(smudged, outBox)).not.toEqual(pick(painted, outBox))
})

test("a smudge wholly outside the selection changes nothing and is not a step", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page)
  // Over the bar's start, stopping short of the box by more than the dab's
  // reach: a stroke that smears when nothing holds it back.
  await stroke(page, origin, 15, 70)
  expect(await pixels(page)).not.toEqual(painted)
  await dispatch(page, { type: "undo" })
  await select(page)
  const before = await steps(page)

  await drag(page, origin, 15, 70)
  await settle(page)
  expect(await pixels(page)).toEqual(painted)
  expect(await steps(page)).toBe(before)
})

test("undoing a smudge made inside a selection restores the layer and keeps the selection", async ({
  page,
}) => {
  const { origin, painted } = await openPainted(page)
  await select(page)
  const selected = await page.evaluate(
    () => window.engine.getSnapshot().selection
  )
  const mask = await coverage(page)
  await stroke(page, origin, 80, 160)
  expect(await pixels(page)).not.toEqual(painted)

  await dispatch(page, { type: "undo" })
  expect(await pixels(page)).toEqual(painted)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().selection)
  ).toEqual(selected)
  expect(await coverage(page)).toEqual(mask)
})

test("a smudge over the unselected hole of an inverted selection changes nothing and is not a step", async ({
  page,
}) => {
  const { origin } = await openPainted(page)
  // A mark inside the box, and a smudge small enough to stay inside it too.
  await dispatch(page, { type: "setTool", tool: "brush" })
  await stroke(page, origin, 140, 160)
  await dispatch(page, { type: "setTool", tool: "smudge" })
  await dispatch(page, { type: "setSmudge", radius: 6 })
  const marked = await pixels(page)
  await stroke(page, origin, 135, 170)
  expect(await pixels(page)).not.toEqual(marked)
  await dispatch(page, { type: "undo" })

  await select(page)
  await dispatch(page, { type: "invertSelection" })
  const before = await steps(page)
  await drag(page, origin, 135, 170)
  // History takes its steps in order, so once the deselect is counted a
  // step from the smudge would have been counted before it.
  await dispatch(page, { type: "deselect" })
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  expect(await steps(page)).toBe(before + 1)
  expect(await pixels(page)).toEqual(marked)
})
