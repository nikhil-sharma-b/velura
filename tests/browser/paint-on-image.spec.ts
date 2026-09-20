import { expect, test, type Page } from "@playwright/test"

/**
 * Turning a placed image into a layer the pen accepts. The refusal is right by
 * default — a stray mark on a reference is rarely meant — so this is the door
 * through it: said once, in the open, and kept afterwards.
 */

const WIDTH = 200
const HEIGHT = 120

/**
 * A point the test stroke passes through, inside the seeded scene's opaque
 * green rectangle and under the placed image.
 */
const MARKED = { x: 20, y: 10 }

type Image = { width: number; data: number[] }

async function openDocument(page: Page, documentId?: string) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, id]) => {
      window.remountEngine(
        id ? { persistence: { documentId: id as string } } : undefined
      )
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT, documentId ?? ""] as const
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
    return { width: pixels.width, data: Array.from(pixels.data) }
  })
}

const channel = (image: Image, at: { x: number; y: number }, index: number) =>
  image.data[(at.y * image.width + at.x) * 4 + index]

/** Places an opaque red rectangle over the whole canvas. */
async function placeRed(page: Page): Promise<string> {
  return page.evaluate(
    async ([width, height]) => {
      const pixels = new Uint8ClampedArray(width * height * 4)
      for (let at = 0; at < pixels.length; at += 4) {
        pixels[at] = 255
        pixels[at + 3] = 255
      }
      await window.engine.dispatch({
        type: "placeImage",
        name: "Reference",
        image: { width, height, pixels },
      })
      return window.engine.getSnapshot().activeLayerId
    },
    [WIDTH, HEIGHT] as const
  )
}

async function stroke(page: Page, origin: { x: number; y: number }) {
  await page.mouse.move(origin.x + 10, origin.y + MARKED.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 60, origin.y + MARKED.y, { steps: 20 })
  await page.mouse.up()
}

const isImageLayer = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const layer = window.engine
      .getSnapshot()
      .layers.find((node) => node.id === layerId)
    return layer?.kind === "raster" && layer.image
  }, id)

test("a converted image layer takes the brush and the eraser", async ({
  page,
}) => {
  const origin = await openDocument(page)
  const placed = await placeRed(page)

  // Refused first: the picture is the picture until the artist says otherwise.
  await stroke(page, origin)
  expect(channel(await painted(page), MARKED, 0)).toBeGreaterThan(200)

  await page.evaluate(
    (id) => window.engine.dispatch({ type: "makeLayerPaintable", id }),
    placed
  )
  expect(await isImageLayer(page, placed)).toBe(false)

  await stroke(page, origin)
  expect(channel(await painted(page), MARKED, 0)).toBeLessThan(128)

  // And the eraser takes the photograph's own pixels away: the scene below
  // shows through where the image was.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  await stroke(page, origin)
  const erased = await painted(page)
  expect(channel(erased, MARKED, 1)).toBeGreaterThan(200)
})

test("converting is one step to take back, and the pen is refused again", async ({
  page,
}) => {
  const origin = await openDocument(page)
  const placed = await placeRed(page)
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "makeLayerPaintable", id }),
    placed
  )
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))

  expect(await isImageLayer(page, placed)).toBe(true)
  await stroke(page, origin)
  expect(channel(await painted(page), MARKED, 0)).toBeGreaterThan(200)
})

test("a converted layer keeps its name, settings and mask", async ({
  page,
}) => {
  await openDocument(page)
  const placed = await placeRed(page)
  const kept = await page.evaluate(async (id) => {
    await window.engine.dispatch({
      type: "setLayer",
      id,
      opacity: 0.5,
      blend: "multiply",
      clip: true,
    })
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "makeLayerPaintable", id })
    const layer = window.engine
      .getSnapshot()
      .layers.find((node) => node.id === id)!
    return {
      name: layer.name,
      opacity: layer.opacity,
      blend: layer.blend,
      clip: layer.clip,
      hasMask: !!layer.mask,
      index: window.engine
        .getSnapshot()
        .layers.findIndex((node) => node.id === id),
    }
  }, placed)
  expect(kept).toEqual({
    name: "Reference",
    opacity: 0.5,
    blend: "multiply",
    clip: true,
    hasMask: true,
    index: 1,
  })
})

test("a duplicate of an unconverted image layer is still an image layer", async ({
  page,
}) => {
  await openDocument(page)
  const placed = await placeRed(page)
  const copy = await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "duplicateLayer", id })
    return window.engine.getSnapshot().activeLayerId
  }, placed)
  expect(await isImageLayer(page, copy)).toBe(true)
})

test("the conversion survives closing and reopening the document", async ({
  page,
}) => {
  const documentId = `doc-${Math.random().toString(36).slice(2)}`
  await openDocument(page, documentId)
  const placed = await placeRed(page)
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "makeLayerPaintable", id })
    await window.engine.save()
  }, placed)

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openDocument(page, documentId)
  await page.waitForFunction(
    (id) => window.engine.getSnapshot().layers.some((l) => l.id === id),
    placed
  )
  expect(await isImageLayer(page, placed)).toBe(false)
})
