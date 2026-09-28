import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * The document's selection (07), through the engine's command seam: the mask
 * it holds on the GPU, the bounds the snapshot reports, undo and redo, and
 * the marching ants that outline it on screen and nowhere else.
 */

const WIDTH = 200
const HEIGHT = 120

async function openCanvas(page: Page): Promise<{ x: number; y: number }> {
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
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

type Mask = { width: number; height: number; data: number[] } | null

const readMask = (page: Page): Promise<Mask> =>
  page.evaluate(async () => {
    const mask = await window.engine.readSelection()
    return mask && { ...mask, data: Array.from(mask.data) }
  })

/** A mask as a greyscale image: white selected, black not. */
function maskImage(mask: NonNullable<Mask>): Buffer {
  const png = new PNG({ width: mask.width, height: mask.height })
  mask.data.forEach((value, index) => {
    png.data[index * 4] = value
    png.data[index * 4 + 1] = value
    png.data[index * 4 + 2] = value
    png.data[index * 4 + 3] = 255
  })
  return PNG.sync.write(png)
}

const selection = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().selection)

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

async function painted(page: Page): Promise<number[]> {
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

test("rectangle, ellipse and inverted masks match their goldens", async ({
  page,
}) => {
  await openCanvas(page)
  expect(await selection(page)).toBeNull()
  expect(await readMask(page)).toBeNull()

  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 20,
      y: 15,
      width: 90,
      height: 60,
    })
  )
  expect(await selection(page)).toEqual({
    bounds: { x: 20, y: 15, width: 90, height: 60 },
  })
  expect(maskImage((await readMask(page))!)).toMatchSnapshot("rect-mask.png")

  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "ellipse",
      x: 50,
      y: 20,
      width: 120,
      height: 80,
    })
  )
  expect(await selection(page)).toEqual({
    bounds: { x: 50, y: 20, width: 120, height: 80 },
  })
  expect(maskImage((await readMask(page))!)).toMatchSnapshot("ellipse-mask.png")

  await page.evaluate(() => window.engine.dispatch({ type: "invertSelection" }))
  expect(await selection(page)).toEqual({
    bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  })
  expect(maskImage((await readMask(page))!)).toMatchSnapshot(
    "inverted-ellipse-mask.png"
  )
})

test("select all, deselect and invert", async ({ page }) => {
  await openCanvas(page)
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  const all = (await readMask(page))!
  expect(all.data.every((value) => value === 255)).toBe(true)
  expect(await selection(page)).toEqual({
    bounds: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  })

  // Everything inverted is nothing.
  await page.evaluate(() => window.engine.dispatch({ type: "invertSelection" }))
  expect(await selection(page)).toBeNull()
  expect(await readMask(page)).toBeNull()

  // Nothing inverted is everything.
  await page.evaluate(() => window.engine.dispatch({ type: "invertSelection" }))
  expect(await selection(page)).not.toBeNull()
  await page.evaluate(() => window.engine.dispatch({ type: "deselect" }))
  expect(await selection(page)).toBeNull()

  // Selecting what is already selected is not a step either.
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  const selected = await steps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  expect(await steps(page)).toBe(selected)
  await page.evaluate(() => window.engine.dispatch({ type: "deselect" }))

  // Deselecting nothing is not a step.
  const before = await steps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "deselect" }))
  expect(await steps(page)).toBe(before)
})

test("selection changes undo and redo, each one step", async ({ page }) => {
  await openCanvas(page)
  const start = await steps(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    })
  )
  const rect = await readMask(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "ellipse",
      x: 60,
      y: 20,
      width: 80,
      height: 80,
    })
  )
  const ellipse = await readMask(page)
  await page.evaluate(() => window.engine.dispatch({ type: "invertSelection" }))
  const inverted = await readMask(page)
  expect(await steps(page)).toBe(start + 3)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await readMask(page)).toEqual(ellipse)
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await readMask(page)).toEqual(rect)
  expect((await selection(page))!.bounds).toEqual({
    x: 10,
    y: 10,
    width: 40,
    height: 30,
  })
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await readMask(page)).toBeNull()
  expect(await selection(page)).toBeNull()

  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await readMask(page)).toEqual(rect)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await readMask(page)).toEqual(inverted)
})

test("undoing a layer step leaves the selection alone", async ({ page }) => {
  await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 10,
      y: 10,
      width: 40,
      height: 30,
    })
    await window.engine.dispatch({ type: "addLayer" })
    await window.engine.dispatch({ type: "undo" })
  })
  expect((await selection(page))!.bounds).toEqual({
    x: 10,
    y: 10,
    width: 40,
    height: 30,
  })
})

test("the selection stays as layers are switched", async ({ page }) => {
  await openCanvas(page)
  const first = await page.evaluate(
    () => window.engine.getSnapshot().activeLayerId
  )
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    await window.engine.dispatch({
      type: "selectShape",
      shape: "ellipse",
      x: 30,
      y: 20,
      width: 60,
      height: 60,
    })
  })
  const mask = await readMask(page)
  const bounds = await selection(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    first
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().activeLayerId)
  ).toBe(first)
  expect(await selection(page)).toEqual(bounds)
  expect(await readMask(page)).toEqual(mask)
})

test("marching ants reach the screen and never the layers", async ({
  page,
}) => {
  await openCanvas(page)
  const canvas = page.locator("canvas")
  const blank = await painted(page)
  const bare = PNG.sync.read(await canvas.screenshot())
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 40,
      y: 30,
      width: 80,
      height: 50,
    })
  )
  // The export is the artwork: no outline in it.
  expect(await painted(page)).toEqual(blank)
  // On screen, the outline changes pixels, and only near the selection.
  const outlined = PNG.sync.read(await canvas.screenshot())
  let changed = 0
  let stray = 0
  for (let index = 0; index < bare.data.length; index += 4) {
    if (
      bare.data[index] === outlined.data[index] &&
      bare.data[index + 1] === outlined.data[index + 1] &&
      bare.data[index + 2] === outlined.data[index + 2]
    )
      continue
    changed++
    const pixel = index / 4
    const x = pixel % outlined.width
    const y = Math.floor(pixel / outlined.width)
    const onEdge =
      x >= 38 &&
      x <= 121 &&
      y >= 28 &&
      y <= 81 &&
      !(x > 42 && x < 117 && y > 32 && y < 77)
    if (!onEdge) stray++
  }
  expect(changed).toBeGreaterThan(50)
  expect(stray).toBe(0)
})

test("the rectangle tool drags out a selection, square with Shift", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "rectSelect" })
  )
  const drag = async (dx: number, dy: number, square = false) => {
    const before = await steps(page)
    await page.mouse.move(origin.x + 20, origin.y + 20)
    await page.mouse.down()
    // Shift pressed once the drag is under way constrains it; held as the
    // pen goes down it would add to the selection instead (09).
    if (square) await page.keyboard.down("Shift")
    await page.mouse.move(origin.x + 20 + dx, origin.y + 20 + dy, {
      steps: 8,
    })
    await page.mouse.up()
    if (square) await page.keyboard.up("Shift")
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      before
    )
    return (await selection(page))!.bounds
  }
  const free = await drag(80, 40)
  expect(free.width).toBeGreaterThan(free.height * 1.5)

  const square = await drag(80, 40, true)
  expect(square.width).toBe(square.height)
  expect(square.width).toBeGreaterThan(free.height * 1.5)

  // A click without a drag lets the selection go.
  const before = await steps(page)
  await page.mouse.click(origin.x + 150, origin.y + 100)
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  expect(await selection(page)).toBeNull()
})

test("the ellipse tool leaves the layers untouched", async ({ page }) => {
  const origin = await openCanvas(page)
  const blank = await painted(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "ellipseSelect" })
  )
  const before = await steps(page)
  await page.mouse.move(origin.x + 30, origin.y + 30)
  await page.mouse.down()
  await page.mouse.move(origin.x + 110, origin.y + 90, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  const mask = (await readMask(page))!
  const { bounds } = (await selection(page))!
  // Solid at its centre, empty at its box's corner.
  const at = (x: number, y: number) => mask.data[y * mask.width + x]
  expect(
    at(
      Math.floor(bounds.x + bounds.width / 2),
      Math.floor(bounds.y + bounds.height / 2)
    )
  ).toBe(255)
  expect(at(bounds.x, bounds.y)).toBe(0)
  expect(await painted(page)).toEqual(blank)
})

test("a new artwork starts with nothing selected", async ({ page }) => {
  await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "selectAll" })
    await window.engine.dispatch({ type: "clearDocument" })
  })
  expect(await selection(page)).toBeNull()
  expect(await readMask(page)).toBeNull()
  expect(await page.evaluate(() => window.engine.getSnapshot().status)).toBe(
    "ready"
  )
})
