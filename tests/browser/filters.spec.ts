import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

import type { Filter } from "../../engine"

/**
 * Filters (18), through the engine's command seam and the pixels it
 * presents: a preview shows the filter, cancel puts every pixel back, apply
 * is one step that undo takes back, and with a selection nothing outside it
 * changes and its feathered edge takes a share.
 */

const WIDTH = 200
const HEIGHT = 120
const BOX = { x: 40, y: 20, width: 60, height: 60 }

type Image = { width: number; height: number; data: number[] }

const FILTERS: Filter[] = [
  { kind: "hsl", hue: 120, saturation: 40, lightness: 10 },
  { kind: "brightnessContrast", brightness: 30, contrast: 60 },
  { kind: "blur", radius: 8 },
]

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
      await window.engine.dispatch({ type: "setBrush", radius: 10 })
      await window.engine.dispatch({ type: "addLayer" })
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function painted(page: Page): Promise<Image> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () => {
    const pixels = await window.engine.readPixels()
    return {
      width: pixels.width,
      height: pixels.height,
      data: Array.from(pixels.data),
    }
  })
}

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

const activeId = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().activeLayerId)

async function stroke(
  page: Page,
  origin: { x: number; y: number },
  hex: string,
  y: number
) {
  await page.evaluate(
    (hex) => window.engine.dispatch({ type: "setColor", hex }),
    hex
  )
  const before = await steps(page)
  await page.mouse.move(origin.x + 10, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 150, origin.y + y, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

/** Three bands of colour across the box, so every filter has work to do. */
async function paintBands(page: Page, origin: { x: number; y: number }) {
  await stroke(page, origin, "#d0402a", 30)
  await stroke(page, origin, "#2a6ad0", 50)
  await stroke(page, origin, "#3aa84a", 70)
}

async function preview(page: Page, filter: Filter) {
  const id = await activeId(page)
  await page.evaluate(
    ([id, filter]) =>
      window.engine
        .dispatch({ type: "beginFilter", id, kind: filter.kind })
        .then(() => window.engine.dispatch({ type: "previewFilter", filter })),
    [id, filter] as const
  )
}

async function apply(page: Page) {
  const before = await steps(page)
  await page.evaluate(() => window.engine.dispatch({ type: "applyFilter" }))
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

const inside = (x: number, y: number) =>
  x >= BOX.x && x < BOX.x + BOX.width && y >= BOX.y && y < BOX.y + BOX.height

/** Every pixel of `image` the predicate picks. */
function pixels(image: Image, pick: (x: number, y: number) => boolean) {
  const out: number[] = []
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (pick(x, y))
        for (let c = 0; c < 4; c++)
          out.push(image.data[(y * image.width + x) * 4 + c])
  return out
}

function png(image: Image): Buffer {
  const out = new PNG({ width: image.width, height: image.height })
  out.data.set(image.data)
  return PNG.sync.write(out)
}

for (const filter of FILTERS) {
  test(`${filter.kind}: preview shows it, cancel puts it back, apply is one step`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await paintBands(page, origin)
    const original = await painted(page)

    await preview(page, filter)
    const previewed = await painted(page)
    expect(previewed).not.toEqual(original)
    expect(
      await page.evaluate(() => window.engine.getSnapshot().filter?.filter)
    ).toEqual(filter)

    const stepsBefore = await steps(page)
    await page.evaluate(() => window.engine.dispatch({ type: "cancelFilter" }))
    expect(await painted(page)).toEqual(original)
    expect(await steps(page)).toBe(stepsBefore)
    expect(
      await page.evaluate(() => window.engine.getSnapshot().filter)
    ).toBeNull()

    await preview(page, filter)
    await apply(page)
    const applied = await painted(page)
    expect(applied).toEqual(previewed)
    expect(await steps(page)).toBe(stepsBefore + 1)
    expect(png(applied)).toMatchSnapshot(`${filter.kind}.png`)

    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
    expect(await painted(page)).toEqual(original)
    await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
    expect(await painted(page)).toEqual(applied)
  })

  test(`${filter.kind}: within a feathered selection, nothing outside changes`, async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await paintBands(page, origin)
    await page.evaluate(async (box) => {
      await window.engine.dispatch({
        type: "selectShape",
        shape: "rect",
        ...box,
      })
      await window.engine.dispatch({ type: "featherSelection", radius: 6 })
    }, BOX)
    const original = await painted(page)

    await preview(page, filter)
    await apply(page)
    const applied = await painted(page)
    // The feather reaches out past the box, so the far side is what is
    // promised to be untouched.
    const far = (x: number, y: number) =>
      x < BOX.x - 8 ||
      x >= BOX.x + BOX.width + 8 ||
      y < BOX.y - 8 ||
      y >= BOX.y + BOX.height + 8
    expect(pixels(applied, far)).toEqual(pixels(original, far))
    expect(pixels(applied, inside)).not.toEqual(pixels(original, inside))
    expect(png(applied)).toMatchSnapshot(`${filter.kind}-in-selection.png`)
  })
}

test("each preview starts from the layer as it was, not from the last one", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await paintBands(page, origin)
  await preview(page, { kind: "blur", radius: 6 })
  const once = await painted(page)
  for (const radius of [2, 12, 6])
    await page.evaluate(
      (radius) =>
        window.engine.dispatch({
          type: "previewFilter",
          filter: { kind: "blur", radius },
        }),
      radius
    )
  expect(await painted(page)).toEqual(once)
})

test("another command cancels an open filter; settings that change nothing record nothing", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await paintBands(page, origin)
  const original = await painted(page)
  const stepsBefore = await steps(page)

  await preview(page, { kind: "hsl", hue: 90, saturation: 0, lightness: 0 })
  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  expect(
    await page.evaluate(() => window.engine.getSnapshot().filter)
  ).toBeNull()
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await painted(page)).toEqual(original)

  await preview(page, { kind: "blur", radius: 0 })
  await page.evaluate(() => window.engine.dispatch({ type: "applyFilter" }))
  expect(await painted(page)).toEqual(original)
  expect(await steps(page)).toBe(stepsBefore)
})

test("a locked or empty layer is not filtered", async ({ page }) => {
  await openCanvas(page)
  const id = await activeId(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "beginFilter", id, kind: "blur" }),
    id
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().filter)
  ).toBeNull()
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, locked: true }),
    id
  )
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "beginFilter", id, kind: "blur" }),
    id
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().filter)
  ).toBeNull()
})

test("the studio opens a filter from the palette, previews it and applies it", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add layer" }).click()
  await expect(layers.getByText("Layer 2")).toBeVisible()
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const box = (await canvas.boundingBox())!
  const cy = box.y + box.height / 2
  await page.mouse.move(box.x + box.width / 2 - 80, cy)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, cy, { steps: 12 })
  await page.mouse.up()
  const undo = page.getByRole("button", { name: "Undo" })
  const redo = page.getByRole("button", { name: "Redo" })
  await expect(undo).toBeEnabled()
  await page.waitForTimeout(100)
  // The stroke's own strip: the open dialog hides the canvas from the
  // accessibility tree and covers part of it, so the page is clipped.
  const shot = () =>
    page.screenshot({
      clip: {
        x: box.x + box.width / 2 - 120,
        y: cy - 30,
        width: 240,
        height: 60,
      },
    })
  const original = await shot()

  const open = async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await page.getByRole("combobox", { name: "Search commands" }).fill("blur")
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "Gaussian blur" })
    await expect(dialog).toBeVisible()
    const radius = dialog.getByRole("textbox", { name: "Radius" })
    await radius.fill("12")
    await radius.press("Enter")
    await expect.poll(shot).not.toEqual(original)
    return dialog
  }

  // Escape is a cancel: every pixel goes back and nothing is recorded.
  let dialog = await open()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect.poll(shot).toEqual(original)

  dialog = await open()
  const previewed = await shot()
  await dialog.getByRole("button", { name: "Apply" }).click()
  await expect(dialog).toBeHidden()
  expect(await shot()).toEqual(previewed)
  // One undo takes the blur back, and only the blur.
  await undo.click()
  await expect.poll(shot).toEqual(original)
  await expect(redo).toBeEnabled()
  await expect(undo).toBeEnabled()
})
