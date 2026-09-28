import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * The lassos and the ways a new shape meets the selection already there
 * (09): add, subtract and intersect, through the engine's command seam and
 * through the pen with its modifiers.
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

const at = (mask: NonNullable<Mask>, x: number, y: number) =>
  mask.data[y * mask.width + x]

const selection = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().selection)

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

async function afterStep(page: Page, before: number) {
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/** An ellipse, then a rectangle across its right side in `mode`. */
async function combine(page: Page, mode: "add" | "subtract" | "intersect") {
  await page.evaluate(async (mode) => {
    await window.engine.dispatch({
      type: "selectShape",
      shape: "ellipse",
      x: 20,
      y: 20,
      width: 100,
      height: 80,
    })
    await window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 80,
      y: 40,
      width: 90,
      height: 60,
      mode,
    })
  }, mode)
}

test("a lasso outline matches its golden", async ({ page }) => {
  await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "selectLasso",
      points: [
        { x: 20, y: 10 },
        { x: 180, y: 30 },
        { x: 100, y: 60 },
        { x: 170, y: 110 },
        { x: 30, y: 100 },
      ],
    })
  )
  expect(maskImage((await readMask(page))!)).toMatchSnapshot("lasso-mask.png")
})

for (const mode of ["add", "subtract", "intersect"] as const)
  test(`${mode} matches its golden`, async ({ page }) => {
    await openCanvas(page)
    await combine(page, mode)
    expect(maskImage((await readMask(page))!)).toMatchSnapshot(
      `${mode}-mask.png`
    )
  })

test("each combine is one undo step back to the selection before it", async ({
  page,
}) => {
  await openCanvas(page)
  await combine(page, "subtract")
  const subtracted = await readMask(page)
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await selection(page)).toEqual({
    bounds: { x: 20, y: 20, width: 100, height: 80 },
  })
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await readMask(page)).toEqual(subtracted)
})

test("the freehand lasso fills the outline the pen drew", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "lasso" })
  )
  const before = await steps(page)
  await page.mouse.move(origin.x + 20, origin.y + 20)
  await page.mouse.down()
  await page.mouse.move(origin.x + 120, origin.y + 20, { steps: 6 })
  await page.mouse.move(origin.x + 120, origin.y + 90, { steps: 6 })
  await page.mouse.move(origin.x + 20, origin.y + 90, { steps: 6 })
  // Let go short of the start: the lasso closes the outline itself.
  await page.mouse.up()
  await afterStep(page, before)
  const bounds = (await selection(page))!.bounds
  expect(bounds.x).toBeGreaterThanOrEqual(19)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(121)
  expect(bounds.height).toBeGreaterThan(60)
  const mask = (await readMask(page))!
  expect(at(mask, 70, 55)).toBe(255)
  expect(at(mask, 150, 55)).toBe(0)
})

test("the polygonal lasso closes on its first point or a double-click", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "polygonLasso" })
  )
  const click = (x: number, y: number) =>
    page.mouse.click(origin.x + x, origin.y + y)

  let before = await steps(page)
  await click(20, 20)
  await click(150, 20)
  await click(20, 100)
  // Nothing is selected until the outline is closed.
  expect(await steps(page)).toBe(before)
  await click(22, 21)
  await afterStep(page, before)
  let mask = (await readMask(page))!
  expect(at(mask, 40, 40)).toBe(255)
  expect(at(mask, 120, 90)).toBe(0)

  before = await steps(page)
  await click(100, 30)
  await click(180, 30)
  await page.mouse.dblclick(origin.x + 180, origin.y + 110)
  await afterStep(page, before)
  mask = (await readMask(page))!
  expect(at(mask, 160, 60)).toBe(255)
  // A new outline replaced the old one.
  expect(at(mask, 40, 40)).toBe(0)
})

test("a polygon too small to close, or undone, leaves the selection alone", async ({
  page,
}) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  const origin = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    })
    await window.engine.dispatch({ type: "setTool", tool: "polygonLasso" })
  })
  const kept = await readMask(page)
  const before = await steps(page)
  await page.mouse.dblclick(origin.x + 100, origin.y + 60)
  await page.mouse.click(origin.x + 120, origin.y + 20)
  await page.mouse.click(origin.x + 180, origin.y + 20)
  await page.mouse.click(origin.x + 180, origin.y + 100)
  // Undo drops the outline in progress and nothing beneath it.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  await page.mouse.click(origin.x + 121, origin.y + 21)
  expect(await steps(page)).toBe(before)
  expect(await readMask(page)).toEqual(kept)
  expect(errors).toEqual([])
})

test("Shift adds, Alt subtracts, both intersect, and Alt does not sample", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setColor", hex: "#123456" })
    await window.engine.dispatch({ type: "setTool", tool: "rectSelect" })
  })
  const drag = async (
    modifiers: ("Shift" | "Alt")[],
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => {
    const before = await steps(page)
    for (const key of modifiers) await page.keyboard.down(key)
    await page.mouse.move(origin.x + x0, origin.y + y0)
    await page.mouse.down()
    await page.mouse.move(origin.x + x1, origin.y + y1, { steps: 6 })
    await page.mouse.up()
    for (const key of modifiers) await page.keyboard.up(key)
    await afterStep(page, before)
    return (await readMask(page))!
  }

  let mask = await drag([], 10, 10, 60, 60)
  mask = await drag(["Shift"], 100, 10, 150, 60)
  // Held from the start, Shift added rather than squaring.
  expect(at(mask, 30, 30)).toBe(255)
  expect(at(mask, 120, 30)).toBe(255)

  mask = await drag(["Alt"], 30, 0, 130, 40)
  expect(at(mask, 20, 20)).toBe(255)
  expect(at(mask, 40, 20)).toBe(0)
  expect(at(mask, 40, 50)).toBe(255)
  expect(await page.evaluate(() => window.engine.getSnapshot().color.hex)).toBe(
    "#123456"
  )

  mask = await drag(["Shift", "Alt"], 0, 45, 200, 120)
  expect(at(mask, 20, 20)).toBe(0)
  expect(at(mask, 40, 50)).toBe(255)
  expect(at(mask, 120, 50)).toBe(255)
  expect(at(mask, 80, 50)).toBe(0)
})

test("each selection family has one rail slot that swaps on a second press", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const pressed = (name: string) =>
    expect(page.getByRole("button", { name, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true"
    )

  await page.getByRole("button", { name: "Lasso tool", exact: true }).click()
  await pressed("Lasso tool")
  await page.getByRole("button", { name: "Lasso tool", exact: true }).click()
  await pressed("Polygonal lasso tool")

  // The slot remembers, and follows the keys as well as the pointer.
  await page.keyboard.press("Shift+M")
  await pressed("Ellipse select tool")
  await expect(
    page.getByRole("button", { name: "Polygonal lasso tool", exact: true })
  ).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("l")
  await pressed("Lasso tool")
  await page.getByRole("button", { name: "Ellipse select tool" }).click()
  await pressed("Ellipse select tool")
})
