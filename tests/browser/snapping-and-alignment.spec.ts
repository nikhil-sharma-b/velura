import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Snapping and alignment (15). Alignment is checked through the engine's
 * facade — where the content ends up, and that it is one step — and snapping
 * through the transform box an artist drags, where the guides are shown.
 */

const WIDTH = 200
const HEIGHT = 120

async function openCanvas(page: Page) {
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
}

/** A solid 40 by 30 block with its top left at (20, 10). */
async function block(page: Page, paintable: boolean): Promise<string> {
  return page.evaluate(async (makePaintable) => {
    const width = 40
    const height = 30
    const pixels = new Uint8ClampedArray(width * height * 4).fill(255)
    await window.engine.dispatch({
      type: "placeImage",
      name: "Block",
      image: { width, height, pixels },
      placement: {
        x: 40,
        y: 25,
        width,
        height,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
    })
    const id = window.engine.getSnapshot().activeLayerId
    if (makePaintable)
      await window.engine.dispatch({ type: "makeLayerPaintable", id })
    return id
  }, paintable)
}

/** The layer's content box, as picking it up finds it; then put back down. */
async function contentBox(page: Page, id: string) {
  return page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    const { placement } = window.engine.getSnapshot().layerTransform!
    await window.engine.dispatch({ type: "cancelLayerTransform" })
    return {
      x: placement.x - placement.width / 2,
      y: placement.y - placement.height / 2,
      width: placement.width,
      height: placement.height,
    }
  }, id)
}

const undo = (page: Page) =>
  page.evaluate(() => window.engine.dispatch({ type: "undo" }))

const START = { x: 20, y: 10, width: 40, height: 30 }

const ANCHORS = [
  ["left", { x: 0, y: 10 }],
  ["hcenter", { x: 80, y: 10 }],
  ["right", { x: 160, y: 10 }],
  ["top", { x: 20, y: 0 }],
  ["vcenter", { x: 20, y: 45 }],
  ["bottom", { x: 20, y: 90 }],
] as const

for (const [anchor, corner] of ANCHORS)
  test(`aligning a painted layer ${anchor} to the canvas moves it there as one step`, async ({
    page,
  }) => {
    await openCanvas(page)
    const id = await block(page, true)
    await page.evaluate(
      async ([layerId, to]) =>
        window.engine.dispatch({
          type: "alignLayer",
          id: layerId,
          anchor: to,
          to: "canvas",
        }),
      [id, anchor] as const
    )
    expect(await contentBox(page, id)).toEqual({
      ...corner,
      width: 40,
      height: 30,
    })
    // One step: a single undo puts it back.
    await undo(page)
    expect(await contentBox(page, id)).toEqual(START)
  })

test("aligning to the selection moves the whole layer to its bounds", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await block(page, true)
  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 100,
      y: 50,
      width: 60,
      height: 60,
    })
    await window.engine.dispatch({
      type: "alignLayer",
      id: layerId,
      anchor: "right",
      to: "selection",
    })
    await window.engine.dispatch({
      type: "alignLayer",
      id: layerId,
      anchor: "bottom",
      to: "selection",
    })
    await window.engine.dispatch({ type: "deselect" })
  }, id)
  expect(await contentBox(page, id)).toEqual({
    x: 120,
    y: 80,
    width: 40,
    height: 30,
  })
})

test("aligning to the selection needs one", async ({ page }) => {
  await openCanvas(page)
  const id = await block(page, true)
  await expect(
    page.evaluate(
      (layerId) =>
        window.engine.dispatch({
          type: "alignLayer",
          id: layerId,
          anchor: "left",
          to: "selection",
        }),
      id
    )
  ).rejects.toThrow(/no selection/)
})

test("a placed image aligns by its placement, and stays an image", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await block(page, false)
  const placed = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({
      type: "alignLayer",
      id: layerId,
      anchor: "hcenter",
      to: "canvas",
    })
    await window.engine.dispatch({
      type: "alignLayer",
      id: layerId,
      anchor: "vcenter",
      to: "canvas",
    })
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const { placement } = window.engine.getSnapshot().imageTransform!
    await window.engine.dispatch({ type: "cancelImageTransform" })
    return placement
  }, id)
  expect({ x: placed.x, y: placed.y }).toEqual({ x: 100, y: 60 })
})

test("mid-transform, aligning is one more adjustment of it", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await block(page, true)
  const placement = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginLayerTransform", id: layerId })
    await window.engine.dispatch({
      type: "alignLayer",
      id: layerId,
      anchor: "right",
      to: "canvas",
    })
    return window.engine.getSnapshot().layerTransform!.placement
  }, id)
  expect(placement.x).toBe(180)
  // The drag and the align are one step when put down.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "commitLayerTransform" })
  )
  expect((await contentBox(page, id)).x).toBe(160)
  await undo(page)
  expect(await contentBox(page, id)).toEqual(START)
})

test("a transform knows the canvas's lines and other content's", async ({
  page,
}) => {
  await openCanvas(page)
  await block(page, false)
  const found = await page.evaluate(async () => {
    const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(255)
    await window.engine.dispatch({
      type: "placeImage",
      name: "Small",
      image: { width: 10, height: 10, pixels },
    })
    const small = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "beginImageTransform", id: small })
    const found = window.engine.getSnapshot().imageTransform!.snapTargets
    await window.engine.dispatch({ type: "cancelImageTransform" })
    return found
  })
  expect(found.x).toEqual(expect.arrayContaining([0, 100, 200, 20, 40, 60]))
  expect(found.y).toEqual(expect.arrayContaining([0, 60, 120, 10, 25, 40]))
})

test("snapping can be switched off", async ({ page }) => {
  await openCanvas(page)
  const snapping = await page.evaluate(async () => {
    const before = window.engine.getSnapshot().snapping
    await window.engine.dispatch({ type: "setSnapping", enabled: false })
    return [before, window.engine.getSnapshot().snapping]
  })
  expect(snapping).toEqual([true, false])
})

/** A small opaque red PNG, as a file would arrive. */
function redPng(size: number): Buffer {
  const png = new PNG({ width: size, height: size })
  for (let at = 0; at < png.data.length; at += 4) {
    png.data[at] = 255
    png.data[at + 3] = 255
  }
  return PNG.sync.write(png)
}

test("dragging near a centre line snaps and shows a guide; Ctrl suspends it", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.locator('input[type="file"]').setInputFiles({
    name: "Reference.png",
    mimeType: "image/png",
    buffer: redPng(64),
  })
  await layers
    .getByRole("button", { name: "Move, scale or rotate Reference" })
    .click()
  const box = page.getByTestId("image-transform")
  await expect(box).toBeVisible()

  // Placed centred, so a small drag stays within reach of both centre lines.
  const outline = await box.locator("polygon").boundingBox()
  const centre = {
    x: outline!.x + outline!.width / 2,
    y: outline!.y + outline!.height / 2,
  }
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 2, centre.y + 1, { steps: 2 })
  await expect(page.getByTestId("snap-guide-x")).toBeAttached()
  await expect(page.getByTestId("snap-guide-y")).toBeAttached()
  const snapped = await box.locator("polygon").boundingBox()
  expect(snapped!.x).toBeCloseTo(outline!.x, 0)

  await page.keyboard.down("Control")
  await page.mouse.move(centre.x + 3, centre.y + 1, { steps: 2 })
  await expect(page.getByTestId("snap-guide-x")).not.toBeAttached()
  await page.keyboard.up("Control")
  await page.mouse.up()
  await page.keyboard.press("Escape")
})
