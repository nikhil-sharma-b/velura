import { expect, test, type Page } from "@playwright/test"

import type { SceneCommand, VectorObject } from "../../engine"

/**
 * Vector layers (19), through the engine's command seam and the pixels it
 * presents: a layer of shapes drawn from their geometry into the layer's own
 * pixels, so it composites like paint — blend modes, masks and clipping
 * included — stays exactly as sharp however the view moves, undoes edit by
 * edit, and shows in its thumbnail.
 */

const WIDTH = 200
const HEIGHT = 120

type Image = { width: number; height: number; data: number[] }

async function openCanvas(
  page: Page,
  documentId?: string
): Promise<{ x: number; y: number }> {
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
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    },
    [WIDTH, HEIGHT, documentId] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function pixels(page: Page): Promise<Image> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () => {
    const read = await window.engine.readPixels()
    return {
      width: read.width,
      height: read.height,
      data: Array.from(read.data),
    }
  })
}

function at(image: Image, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return image.data.slice(offset, offset + 4)
}

const steps = (page: Page) =>
  page.evaluate(() => window.engine.historyUsage().steps)

async function addVectorLayer(page: Page): Promise<string> {
  return page.evaluate(async () => {
    await window.engine.dispatch({ type: "addVectorLayer" })
    return window.engine.getSnapshot().activeLayerId
  })
}

/** Edits a layer's shapes, and waits for the step to be recorded. */
async function edit(page: Page, id: string, commands: SceneCommand[]) {
  const before = await steps(page)
  await page.evaluate(
    ([id, commands]) =>
      window.engine.dispatch({ type: "editVectorLayer", id, commands }),
    [id, commands] as const
  )
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

function rect(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  style: Partial<VectorObject["style"]> = {}
): VectorObject {
  return {
    id,
    geometry: { kind: "rect", ...box },
    transform: [1, 0, 0, 1, 0, 0],
    style: {
      fill: { color: "#d0402a", opacity: 1, rule: "nonzero" },
      stroke: null,
      ...style,
    },
  }
}

test("a vector layer is added by command, selected, and holds shapes", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  const blank = await pixels(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 40, y: 20, width: 60, height: 40 }) },
  ])
  const layer = await page.evaluate(
    (id) => window.engine.getSnapshot().layers.find((node) => node.id === id),
    id
  )
  expect(layer).toMatchObject({ kind: "vector", objects: 1 })
  const drawn = await pixels(page)
  // Inside the rectangle is its colour; outside is what was there before.
  expect(at(drawn, 70, 40)).toEqual([208, 64, 42, 255])
  expect(at(drawn, 20, 40)).toEqual(at(blank, 20, 40))
  expect(at(drawn, 110, 40)).toEqual(at(blank, 110, 40))
})

/** Drags the rectangle tool from one document point to another. */
async function drag(
  page: Page,
  origin: { x: number; y: number },
  from: [number, number],
  to: [number, number]
) {
  const before = await steps(page)
  await page.mouse.move(origin.x + from[0], origin.y + from[1])
  await page.mouse.down()
  await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

test("the rectangle tool draws a filled rectangle, and an outlined one", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addVectorLayer(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "rectangle" })
    await window.engine.dispatch({ type: "setColor", hex: "#2a6ad0" })
  })
  await drag(page, origin, [20, 20], [90, 100])
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setColor", hex: "#d0402a" })
    await window.engine.dispatch({
      type: "setShapeStyle",
      fill: false,
      stroke: true,
      strokeWidth: 6,
    })
  })
  await drag(page, origin, [110, 20], [180, 100])
  const image = await pixels(page)
  expect(at(image, 50, 60)).toEqual([42, 106, 208, 255])
  // The outline is on the edge and the inside is left as it was.
  expect(at(image, 145, 20)).toEqual([208, 64, 42, 255])
  expect(at(image, 145, 60)).toEqual(at(image, 195, 60))
  const layer = await page.evaluate(() =>
    window.engine.getSnapshot().layers.at(-1)
  )
  expect(layer).toMatchObject({ kind: "vector", objects: 2 })
  await expect(page.locator("canvas")).toHaveScreenshot("rectangle-tool.png")
})

test("a click with the rectangle tool, or a drag on a paint layer, draws nothing", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "rectangle" })
  )
  const before = await pixels(page)
  // On the paint layer the tool is refused.
  await page.mouse.move(origin.x + 20, origin.y + 20)
  await page.mouse.down()
  await page.mouse.move(origin.x + 90, origin.y + 90, { steps: 4 })
  await page.mouse.up()
  await addVectorLayer(page)
  const added = await steps(page)
  await page.mouse.click(origin.x + 50, origin.y + 50)
  await page.waitForTimeout(100)
  expect(await steps(page)).toBe(added)
  expect(await pixels(page)).toEqual(before)
})

test("paint is refused on a vector layer, but its mask takes paint", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    {
      type: "add",
      object: rect("a", { x: 20, y: 20, width: 160, height: 80 }),
    },
  ])
  const before = await pixels(page)
  const recorded = await steps(page)
  await page.mouse.move(origin.x + 30, origin.y + 60)
  await page.mouse.down()
  await page.mouse.move(origin.x + 170, origin.y + 60, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  expect(await steps(page)).toBe(recorded)
  expect(await pixels(page)).toEqual(before)
})

test("the eraser takes whole objects it touches from a vector layer, as one step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const id = await addVectorLayer(page)
  const blank = await pixels(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 40, height: 40 }) },
    {
      type: "add",
      object: rect("b", { x: 120, y: 20, width: 40, height: 40 }),
    },
  ])
  const drawn = await pixels(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  const recorded = await steps(page)
  // A swipe across one corner of "a" alone, never reaching "b".
  await page.mouse.move(origin.x + 10, origin.y + 70)
  await page.mouse.down()
  await page.mouse.move(origin.x + 30, origin.y + 50, { steps: 4 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    recorded
  )
  expect(await steps(page)).toBe(recorded + 1)
  const erased = await pixels(page)
  expect(at(erased, 40, 40)).toEqual(at(blank, 40, 40))
  expect(at(erased, 140, 40)).toEqual([208, 64, 42, 255])

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(drawn)
})

test("a locked vector layer keeps its objects from the eraser", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 40, height: 40 }) },
  ])
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "setLayer", id, locked: true })
    await window.engine.dispatch({ type: "setTool", tool: "eraser" })
  }, id)
  const before = await pixels(page)
  const recorded = await steps(page)
  await page.mouse.move(origin.x + 30, origin.y + 40)
  await page.mouse.down()
  await page.mouse.move(origin.x + 50, origin.y + 40, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(150)
  expect(await steps(page)).toBe(recorded)
  expect(await pixels(page)).toEqual(before)
})

test("each edit is one step, undone and redone in turn", async ({ page }) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  const states = [await pixels(page)]
  const red = rect("a", { x: 20, y: 20, width: 80, height: 60 })
  const blue = rect(
    "b",
    { x: 60, y: 40, width: 80, height: 60 },
    { fill: { color: "#2a6ad0", opacity: 1, rule: "nonzero" } }
  )
  const edits: SceneCommand[][] = [
    [{ type: "add", object: red }],
    [{ type: "add", object: blue }],
    [{ type: "update", id: "a", patch: { transform: [1, 0, 0, 1, 30, 10] } }],
    [{ type: "reorder", id: "a", index: 1 }],
    [{ type: "remove", id: "b" }],
  ]
  for (const commands of edits) {
    await edit(page, id, commands)
    states.push(await pixels(page))
  }
  // Every edit changed the picture.
  for (let i = 1; i < states.length; i++)
    expect(states[i]).not.toEqual(states[i - 1])
  for (let i = states.length - 2; i >= 0; i--) {
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
    expect(await pixels(page)).toEqual(states[i])
  }
  for (let i = 1; i < states.length; i++) {
    await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
    expect(await pixels(page)).toEqual(states[i])
  }
})

test("removing, duplicating and undoing keep a layer's shapes", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 60, height: 60 }) },
  ])
  const drawn = await pixels(page)
  const copy = await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "duplicateLayer", id })
    const copy = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "removeLayer", id })
    return copy
  }, id)
  // The copy alone draws what the original did.
  expect(await pixels(page)).toEqual(drawn)
  await page.evaluate(
    (copy) => window.engine.dispatch({ type: "removeLayer", id: copy }),
    copy
  )
  expect(await pixels(page)).not.toEqual(drawn)
  for (const _ of [1, 2]) {
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
    expect(await pixels(page)).toEqual(drawn)
  }
  // And undoing the duplicate itself leaves the original, still drawn.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(drawn)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await pixels(page)).toEqual(drawn)
})

test("a document's shapes survive export and import", async ({ page }) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    {
      type: "add",
      object: rect(
        "a",
        { x: 30, y: 20, width: 90, height: 70 },
        {
          stroke: {
            color: "#1b1b1b",
            opacity: 1,
            width: 5,
            cap: "butt",
            join: "round",
          },
        }
      ),
    },
  ])
  const drawn = await pixels(page)
  const layers = await page.evaluate(async () => {
    const bytes = await window.engine.exportDocument()
    await window.engine.dispatch({ type: "clearDocument" })
    await window.engine.importDocument(bytes)
    return window.engine.getSnapshot().layers
  })
  expect(layers.at(-1)).toMatchObject({ kind: "vector", objects: 1 })
  expect(await pixels(page)).toEqual(drawn)
})

test("a document's shapes come back when it is reopened on this device", async ({
  page,
}) => {
  const documentId = `vector-${Date.now()}`
  await openCanvas(page, documentId)
  const saved = async () =>
    page.evaluate(async (documentId) => {
      await window.engine.save()
      return window.tileCountFor(documentId)
    }, documentId)
  const paintTiles = await saved()
  const id = await addVectorLayer(page)
  await edit(page, id, shapes)
  const drawn = await pixels(page)
  // Saved with the document's tree: a vector layer's pixels are a cache of
  // its shapes, and no tile of them is written.
  expect(await saved()).toBe(paintTiles)
  await openCanvas(page, documentId)
  const layers = await page.evaluate(() => window.engine.getSnapshot().layers)
  expect(layers.at(-1)).toMatchObject({ kind: "vector", objects: 1 })
  expect(await pixels(page)).toEqual(drawn)
})

test("rasterising turns shapes into paint as one step, and undo brings them back", async ({
  page,
}) => {
  const documentId = `rasterise-${Date.now()}`
  await openCanvas(page, documentId)
  const saved = async () =>
    page.evaluate(async (documentId) => {
      await window.engine.save()
      return window.tileCountFor(documentId)
    }, documentId)
  const id = await addVectorLayer(page)
  await edit(page, id, shapes)
  const drawn = await pixels(page)
  const vectorTiles = await saved()
  const layer = () =>
    page.evaluate(
      (id) => window.engine.getSnapshot().layers.find((node) => node.id === id),
      id
    )

  const before = await steps(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "rasteriseLayer", id }),
    id
  )
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps === n + 1,
    before
  )
  expect(await layer()).toMatchObject({ kind: "raster", image: false })
  expect(await pixels(page)).toEqual(drawn)
  // Paint now: its pixels are the layer, saved as tiles like any paint.
  expect(await saved()).toBeGreaterThan(vectorTiles)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await layer()).toMatchObject({ kind: "vector", objects: 1 })
  expect(await pixels(page)).toEqual(drawn)
  expect(await saved()).toBe(vectorTiles)

  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await layer()).toMatchObject({ kind: "raster" })
  expect(await pixels(page)).toEqual(drawn)

  // Reopened, the paint is what was saved.
  await saved()
  await openCanvas(page, documentId)
  expect(await layer()).toMatchObject({ kind: "raster" })
  expect(await pixels(page)).toEqual(drawn)
})

/** Paint across the canvas on the layer below: what the shapes meet. */
async function paintBelow(page: Page, origin: { x: number; y: number }) {
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setBrush", radius: 18 })
    await window.engine.dispatch({ type: "setColor", hex: "#3aa84a" })
    await window.engine.dispatch({ type: "addLayer" })
  })
  const before = await steps(page)
  await page.mouse.move(origin.x + 20, origin.y + 60)
  await page.mouse.down()
  await page.mouse.move(origin.x + 180, origin.y + 60, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
}

const shapes: SceneCommand[] = [
  {
    type: "add",
    object: rect(
      "a",
      { x: 40, y: 25, width: 120, height: 70 },
      {
        fill: { color: "#d0402a", opacity: 0.8, rule: "nonzero" },
        stroke: {
          color: "#2a6ad0",
          opacity: 1,
          width: 6,
          cap: "butt",
          join: "miter",
        },
      }
    ),
  },
]

test("a vector layer composites through a blend mode", async ({ page }) => {
  const origin = await openCanvas(page)
  await paintBelow(page, origin)
  const id = await addVectorLayer(page)
  await edit(page, id, shapes)
  const normal = await pixels(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, blend: "multiply" }),
    id
  )
  const multiplied = await pixels(page)
  expect(multiplied).not.toEqual(normal)
  // Where nothing is below, multiply over white is the colour itself.
  expect(at(multiplied, 100, 35)).toEqual(at(normal, 100, 35))
  await expect(page.locator("canvas")).toHaveScreenshot("vector-multiply.png")
})

test("a vector layer's mask hides part of it", async ({ page }) => {
  const origin = await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, shapes)
  const shown = await pixels(page)
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "setBrush", radius: 12 })
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
  }, id)
  const before = await steps(page)
  await page.mouse.move(origin.x + 20, origin.y + 60)
  await page.mouse.down()
  await page.mouse.move(origin.x + 180, origin.y + 60, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  const masked = await pixels(page)
  expect(at(masked, 100, 60)).not.toEqual(at(shown, 100, 60))
  expect(at(masked, 100, 35)).toEqual(at(shown, 100, 35))
  await expect(page.locator("canvas")).toHaveScreenshot("vector-mask.png")
})

test("a vector layer clips to the layer below", async ({ page }) => {
  const origin = await openCanvas(page)
  await paintBelow(page, origin)
  const id = await addVectorLayer(page)
  await edit(page, id, shapes)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, clip: true }),
    id
  )
  const clipped = await pixels(page)
  // Above the paint the shape shows; beyond it, only the paper does.
  expect(at(clipped, 100, 60)).not.toEqual([255, 255, 255, 255])
  expect(at(clipped, 100, 30)).toEqual([255, 255, 255, 255])
  await expect(page.locator("canvas")).toHaveScreenshot("vector-clip.png")
})

test("shapes stay exactly as sharp after zooming, and redrawing loses nothing", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  // Off the pixel grid on purpose, so every edge is antialiased.
  const box = { x: 30.3, y: 20.6, width: 100.5, height: 60.25 }
  await edit(page, id, [
    {
      type: "add",
      object: rect("a", box, {
        fill: { color: "#000000", opacity: 1, rule: "nonzero" },
      }),
    },
  ])
  const drawn = await pixels(page)
  // Each edge crosses from paper to ink within the one pixel it falls in:
  // the left at x = 30.3, the right at x = 130.8.
  const row = 50
  const red = (x: number) => at(drawn, x, row)[0]
  expect(red(29)).toBe(255)
  expect(red(30)).toBeGreaterThan(0)
  expect(red(30)).toBeLessThan(255)
  expect(red(31)).toBe(0)
  expect(red(129)).toBe(0)
  expect(red(130)).toBeGreaterThan(0)
  expect(red(130)).toBeLessThan(255)
  expect(red(131)).toBe(255)
  await page.evaluate(async () => {
    for (const factor of [4, 4, 0.5, 2, 1 / 32])
      await window.engine.dispatch({ type: "zoomView", factor })
    await window.engine.dispatch({ type: "resetView" })
  })
  expect(await pixels(page)).toEqual(drawn)
  // Moved away and back is drawn again from the geometry, not resampled.
  for (const transform of [
    [1.7, 0.4, -0.4, 1.7, 13.1, -7.9],
    [1, 0, 0, 1, 0, 0],
  ] as const)
    await edit(page, id, [{ type: "update", id: "a", patch: { transform } }])
  expect(await pixels(page)).toEqual(drawn)
})

test("object selection styles, duplicate, reorder, transform and clear undo through the facade", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 40, height: 40 }) },
    {
      type: "add",
      object: rect("b", { x: 100, y: 20, width: 40, height: 40 }),
    },
  ])
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "selectVectorRegion",
      region: { x: 30, y: 30 },
    })
    await window.engine.dispatch({ type: "setColor", hex: "#2a6ad0" })
  })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorSelection)
  ).toEqual(["a"])
  expect(at(await pixels(page), 30, 30)).toEqual([42, 106, 208, 255])
  expect(at(await pixels(page), 110, 30)).toEqual([208, 64, 42, 255])
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "duplicateVectorObjects" })
    await window.engine.dispatch({ type: "reorderVectorObjects", to: "back" })
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({
      type: "adjustVectorTransform",
      matrix: [1, 0, 0, 1, 0, 50],
      snap: false,
    })
    await window.engine.dispatch({ type: "commitVectorTransform" })
  })
  expect(at(await pixels(page), 40, 90)).toEqual([42, 106, 208, 255])
  const beforeClear = await pixels(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "clearLayer", id }),
    id
  )
  expect(at(await pixels(page), 40, 90)).toEqual([255, 255, 255, 255])
  expect(at(await pixels(page), 30, 30)).toEqual([42, 106, 208, 255])
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(beforeClear)
})

test("ellipse, line and polygon tools render independent fill and stroke styles", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await addVectorLayer(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "setShapeStyle",
      fillColor: "#2a6ad0",
      strokeColor: "#d0402a",
      stroke: true,
      strokeWidth: 6,
      strokeCap: "round",
      strokeJoin: "bevel",
    })
    await window.engine.dispatch({ type: "setTool", tool: "ellipse" })
  })
  await drag(page, origin, [10, 10], [70, 80])
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "line" })
  )
  await drag(page, origin, [90, 15], [170, 15])
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "polygon" })
  )
  for (const [x, y] of [
    [100, 45],
    [175, 45],
    [140, 100],
    [100, 45],
  ]) {
    await page.mouse.click(origin.x + x, origin.y + y)
    await page.waitForTimeout(50)
  }
  const image = await pixels(page)
  expect(at(image, 40, 40)).toEqual([42, 106, 208, 255])
  expect(at(image, 120, 15)).toEqual([208, 64, 42, 255])
  expect(at(image, 140, 65)).toEqual([42, 106, 208, 255])
  await expect(page.locator("canvas")).toHaveScreenshot(
    "vector-shape-styles.png"
  )
})

test("click and marquee select objects; shared snapping, alignment and cancelled transforms keep geometry", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 40, height: 40 }) },
    {
      type: "add",
      object: rect("b", { x: 100, y: 20, width: 40, height: 40 }),
    },
  ])
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "objectSelect" })
  )
  await page.mouse.click(origin.x + 30, origin.y + 30)
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorSelection[0] === "a"
  )
  await page.mouse.move(origin.x + 10, origin.y + 10)
  await page.mouse.down()
  await page.mouse.move(origin.x + 150, origin.y + 70, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorSelection.length === 2
  )
  const original = await pixels(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({
      type: "adjustVectorTransform",
      matrix: [1, 0, 0, 1, 10, 40],
      snap: false,
    })
    await window.engine.dispatch({ type: "cancelVectorTransform" })
  })
  expect(await pixels(page)).toEqual(original)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "selectVectorObjects", ids: ["a"] })
    await window.engine.dispatch({ type: "beginVectorTransform" })
    if (
      !window.engine.getSnapshot().vectorTransform?.snapTargets.x.includes(100)
    )
      throw new Error("Object snap targets must use the painted edge at 100.")
    await window.engine.dispatch({
      type: "adjustVectorTransform",
      matrix: [1, 0, 0, 1, -18, 0],
      snap: true,
    })
    await window.engine.dispatch({ type: "commitVectorTransform" })
  })
  expect(at(await pixels(page), 1, 30)).toEqual([208, 64, 42, 255])
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "alignVectorObjects",
      anchor: "bottom",
      to: "canvas",
    })
    await window.engine.dispatch({
      type: "setShapeStyle",
      fill: false,
      stroke: true,
      strokeWidth: 4,
      strokeColor: "#2a6ad0",
      strokeCap: "square",
      strokeJoin: "round",
    })
  })
  expect(at(await pixels(page), 20, 100)).toEqual([255, 255, 255, 255])
  expect(at(await pixels(page), 0, 100)).toEqual([42, 106, 208, 255])
  await expect(page.locator("canvas")).toHaveScreenshot(
    "vector-selected-outline.png"
  )
})

test("undo abandons an object transform; target removal and rasterisation close its session", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await addVectorLayer(page)
  await edit(page, id, [
    { type: "add", object: rect("a", { x: 20, y: 20, width: 40, height: 40 }) },
  ])
  const original = await pixels(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "selectVectorObjects", ids: ["a"] })
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({
      type: "adjustVectorTransform",
      matrix: [1, 0, 0, 1, 50, 0],
      snap: false,
    })
    await window.engine.dispatch({ type: "undo" })
  })
  expect(await pixels(page)).toEqual(original)
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({
      type: "adjustVectorTransform",
      matrix: [1, 0, 0, 1, 50, 0],
      snap: false,
    })
    await window.engine.dispatch({ type: "setLayer", id, locked: true })
    await window.engine.dispatch({ type: "commitVectorTransform" })
  }, id)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorTransform)
  ).toBeNull()
  expect(await pixels(page)).toEqual(original)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, locked: false }),
    id
  )
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({ type: "rasteriseLayer", id })
  }, id)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorTransform)
  ).toBeNull()
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "undo" })
    await window.engine.dispatch({ type: "selectVectorObjects", ids: ["a"] })
    await window.engine.dispatch({ type: "beginVectorTransform" })
    await window.engine.dispatch({ type: "removeLayer", id })
  }, id)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorTransform)
  ).toBeNull()
})
