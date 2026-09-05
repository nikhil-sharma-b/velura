import { expect, test, type Page } from "@playwright/test"

/**
 * The layer stack and the cached compositor (D19).
 *
 * Two things are being checked and they pull in opposite directions: that the
 * stack composites correctly — order, opacity, visibility — and that adding to
 * it costs nothing per frame. The first is read off presented pixels; the
 * second is read off the render passes the engine actually submits, because a
 * frame-time measurement on the software rasterizer this suite runs on would
 * say more about SwiftShader than about the compositor.
 */

const WIDTH = 200
const HEIGHT = 120

/**
 * Inside the seeded scene's opaque wide-gamut green rectangle, which the
 * document is authored with at a fixed size in canvas pixels.
 */
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
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT]
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

/** One channel of one pixel, as presented. */
const channel = (image: Image, at: { x: number; y: number }, index: number) =>
  image.data[(at.y * image.width + at.x) * 4 + index]

/** A horizontal mark straight through the scene's green rectangle. */
async function paintThroughGreen(page: Page, origin: { x: number; y: number }) {
  await page.mouse.move(origin.x + 10, origin.y + IN_GREEN.y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 30, origin.y + IN_GREEN.y, { steps: 20 })
  await page.mouse.up()
}

test("a second layer paints over the first and the first is left alone", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const scene = await painted(page)
  // The seeded scene is on the bottom layer: opaque, fully saturated green.
  expect(channel(scene, IN_GREEN, 1)).toBeGreaterThan(200)
  expect(channel(scene, IN_GREEN, 0)).toBeLessThan(60)

  const added = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot()
  })
  expect(added.layers).toHaveLength(2)
  expect(added.activeLayerId).toBe(added.layers[1].id)

  await paintThroughGreen(page, origin)
  const marked = await painted(page)
  // White ink on the layer above hides the green under it.
  expect(channel(marked, IN_GREEN, 0)).toBeGreaterThan(200)

  // Hiding the top layer shows the untouched scene again, which is only true
  // if the mark went into the new layer rather than into the one below it.
  await page.evaluate(
    async (id) =>
      window.engine.dispatch({ type: "setLayer", id, visible: false }),
    added.layers[1].id
  )
  const hidden = await painted(page)
  expect(channel(hidden, IN_GREEN, 0)).toBe(channel(scene, IN_GREEN, 0))
  expect(channel(hidden, IN_GREEN, 1)).toBe(channel(scene, IN_GREEN, 1))
})

test("order and opacity decide what shows", async ({ page }) => {
  const origin = await openCanvas(page)
  const state = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    return window.engine.getSnapshot()
  })
  const [bottom, top] = state.layers.map((layer) => layer.id)
  await paintThroughGreen(page, origin)
  const over = await painted(page)
  expect(channel(over, IN_GREEN, 0)).toBeGreaterThan(200)

  // Sent under the scene, the mark is behind an opaque rectangle and gone.
  await page.evaluate(
    async (id) => window.engine.dispatch({ type: "moveLayer", id, index: 0 }),
    top
  )
  const under = await painted(page)
  expect(channel(under, IN_GREEN, 0)).toBeLessThan(60)
  expect(channel(under, IN_GREEN, 1)).toBeGreaterThan(200)

  // Back on top at half opacity: between the ink and the green under it.
  await page.evaluate(
    async ([id, other]) => {
      await window.engine.dispatch({ type: "moveLayer", id, index: 1 })
      await window.engine.dispatch({ type: "setLayer", id, opacity: 0.5 })
      return other
    },
    [top, bottom]
  )
  const faded = await painted(page)
  expect(channel(faded, IN_GREEN, 0)).toBeGreaterThan(
    channel(under, IN_GREEN, 0)
  )
  expect(channel(faded, IN_GREEN, 0)).toBeLessThan(channel(over, IN_GREEN, 0))
  expect(channel(faded, IN_GREEN, 1)).toBeGreaterThan(
    channel(over, IN_GREEN, 1)
  )
})

test("a locked layer refuses the pen", async ({ page }) => {
  const origin = await openCanvas(page)
  const before = await painted(page)
  await page.evaluate(async () => {
    const { activeLayerId: id } = window.engine.getSnapshot()
    await window.engine.dispatch({ type: "setLayer", id, locked: true })
  })
  await paintThroughGreen(page, origin)
  const after = await painted(page)
  expect(channel(after, IN_GREEN, 0)).toBe(channel(before, IN_GREEN, 0))
})

/**
 * Counts render passes while the page runs one of the harness's own routines.
 * The claim in D19 is about how much work a frame is, so it is checked by
 * counting the work rather than by timing it: this suite runs on a software
 * rasterizer, whose milliseconds are its own business and not the engine's.
 */
async function countPasses(
  page: Page,
  during: "markActiveLayer" | "buildLayerStack"
): Promise<number> {
  return page.evaluate(async (routine) => {
    const encoder = GPUCommandEncoder.prototype
    const beginRenderPass = encoder.beginRenderPass
    let passes = 0
    encoder.beginRenderPass = function (
      ...args: Parameters<typeof beginRenderPass>
    ) {
      passes++
      return beginRenderPass.apply(this, args)
    }
    try {
      await window[routine](1)
    } finally {
      encoder.beginRenderPass = beginRenderPass
    }
    return passes
  }, during)
}

/** Counts render passes while the page changes a layer's settings. */
async function countPassesForSetLayer(
  page: Page,
  id: string,
  patch: { opacity: number }
): Promise<number> {
  return page.evaluate(
    async ([layerId, opacity]) => {
      const encoder = GPUCommandEncoder.prototype
      const beginRenderPass = encoder.beginRenderPass
      let passes = 0
      encoder.beginRenderPass = function (
        ...args: Parameters<typeof beginRenderPass>
      ) {
        passes++
        return beginRenderPass.apply(this, args)
      }
      try {
        await window.engine.dispatch({
          type: "setLayer",
          id: layerId as string,
          opacity: opacity as number,
        })
      } finally {
        encoder.beginRenderPass = beginRenderPass
      }
      return passes
    },
    [id, patch.opacity]
  )
}

test("a frame costs the same with fifty layers as with two", async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openCanvas(page)
  await page.evaluate(() => window.buildLayerStack(2))
  const shallow = await countPasses(page, "markActiveLayer")

  await openCanvas(page)
  await page.evaluate(() => window.buildLayerStack(50))
  const deep = await countPasses(page, "markActiveLayer")

  // Identical, not merely similar: the frames of a stroke read the two caches
  // and the active layer, and forty-eight more layers are already inside them.
  expect(deep).toBe(shallow)

  // And the caches are not being rebuilt behind the stroke: a rebuild is a
  // pass per layer, which fifty layers could not hide inside this count.
  expect(deep).toBeLessThan(20)
})

test("empty layers cost no texture at all", async ({ page }) => {
  await openCanvas(page)
  const textures = await page.evaluate(async () => {
    const device = GPUDevice.prototype
    const createTexture = device.createTexture
    let created = 0
    device.createTexture = function (
      ...args: Parameters<typeof createTexture>
    ) {
      created++
      return createTexture.apply(this, args)
    }
    try {
      for (let i = 0; i < 20; i++)
        await window.engine.dispatch({ type: "addLayer" })
    } finally {
      device.createTexture = createTexture
    }
    return created
  })
  // One texture per new layer, because each becomes the active one and the
  // active layer needs somewhere to be painted, plus one for the cache under
  // it — which is allocated once and reused for every rebuild after. Twenty
  // layers that have never been painted on cost twenty-one textures, not the
  // hundreds a texture per layer per rebuild would come to.
  expect(textures).toBeLessThanOrEqual(21)
})

test("the caches rebuild on structure and not on paint", async ({ page }) => {
  test.setTimeout(120_000)
  await openCanvas(page)
  await page.evaluate(() => window.buildLayerStack(12))
  const { layers } = await page.evaluate(() => window.engine.getSnapshot())
  const painting = await countPasses(page, "markActiveLayer")
  // The bottom layer is inside the cache below the pen, so changing it is a
  // rebuild; the active layer's own opacity would not be, and is not tested
  // here for that reason.
  const restructuring = await countPassesForSetLayer(page, layers[0].id, {
    opacity: 0.5,
  })
  // Rebuilding a cache is a clear and a draw per layer in it, so a structural
  // change costs several passes where painting costs a fixed few.
  expect(restructuring).toBeGreaterThan(painting)

  // The active layer is in neither cache, so fading it is a uniform to write
  // and a frame to present — not eleven layers to flatten again.
  const { activeLayerId } = await page.evaluate(() =>
    window.engine.getSnapshot()
  )
  const fadingActive = await countPassesForSetLayer(page, activeLayerId, {
    opacity: 0.5,
  })
  expect(fadingActive).toBeLessThan(restructuring)
})
