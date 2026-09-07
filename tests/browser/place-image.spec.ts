import { expect, test, type Page } from "@playwright/test"

/**
 * Bringing a picture into the document (D3): a reference, a scan, a plate to
 * paint over. It arrives on a layer of its own, so everything the stack
 * already does — hiding it, moving it under the paint, taking it back — works
 * on it without the image being a special kind of thing.
 */

const WIDTH = 200
const HEIGHT = 120

/** Inside the seeded scene's opaque green rectangle. */
const IN_GREEN = { x: 20, y: 10 }

type Image = { width: number; data: number[] }

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
    [WIDTH, HEIGHT]
  )
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

/** Places an opaque red rectangle of the size given, centred. */
async function placeRed(
  page: Page,
  size: { width: number; height: number }
): Promise<string> {
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
    [size.width, size.height]
  )
}

test("an image comes in on its own layer, above the paint", async ({
  page,
}) => {
  await openCanvas(page)
  const scene = await painted(page)
  expect(channel(scene, IN_GREEN, 1)).toBeGreaterThan(200)

  const placed = await placeRed(page, { width: WIDTH, height: HEIGHT })
  const withImage = await painted(page)
  expect(channel(withImage, IN_GREEN, 0)).toBeGreaterThan(200)
  expect(channel(withImage, IN_GREEN, 1)).toBeLessThan(60)

  const snapshot = await page.evaluate(() => window.engine.getSnapshot())
  expect(snapshot.layers).toHaveLength(2)
  expect(snapshot.layers[1].id).toBe(placed)
  // The file names the layer: the panel has to say which picture this is.
  expect(snapshot.layers[1].name).toBe("Reference")
  expect(snapshot.activeLayerId).toBe(placed)

  // Hidden, the scene under it is exactly as it was — the image went onto a
  // layer of its own rather than into the artist's paint.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "setLayer", id, visible: false }),
    placed
  )
  const hidden = await painted(page)
  expect(channel(hidden, IN_GREEN, 1)).toBe(channel(scene, IN_GREEN, 1))
})

test("placing an image is one step to take back", async ({ page }) => {
  await openCanvas(page)
  const scene = await painted(page)
  await placeRed(page, { width: WIDTH, height: HEIGHT })
  expect(channel(await painted(page), IN_GREEN, 0)).toBeGreaterThan(200)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  const undone = await painted(page)
  expect(channel(undone, IN_GREEN, 0)).toBe(channel(scene, IN_GREEN, 0))
  expect(channel(undone, IN_GREEN, 1)).toBe(channel(scene, IN_GREEN, 1))
  expect(
    (await page.evaluate(() => window.engine.getSnapshot())).layers
  ).toHaveLength(1)

  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(channel(await painted(page), IN_GREEN, 0)).toBeGreaterThan(200)
})

test("an image smaller than the canvas is centred at its own size", async ({
  page,
}) => {
  await openCanvas(page)
  await placeRed(page, { width: 20, height: 20 })
  const image = await painted(page)
  // Centred: the middle is the red image, which has no green in it, while
  // the corner is untouched scene.
  expect(channel(image, { x: WIDTH / 2, y: HEIGHT / 2 }, 1)).toBeLessThan(60)
  expect(channel(image, { x: 2, y: 2 }, 1)).toBeGreaterThan(200)
})
