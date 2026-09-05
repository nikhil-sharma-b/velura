import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import {
  displayTransform,
  type OutputColorSpace,
} from "../../engine/color/display-transform"
import { BACKGROUND } from "../../engine/doc/scene"

test("initializes the facade and presents opaque pixels", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 65,
      height: 33,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    const pixels = await window.engine.readPixels()
    const alphas = new Set<number>()
    for (let i = 3; i < pixels.data.length; i += 4) alphas.add(pixels.data[i])
    return {
      snapshot: window.engine.getSnapshot(),
      width: pixels.width,
      height: pixels.height,
      alphas: [...alphas],
      // Rows below the hardcoded shape are untouched backdrop.
      lastRow: Array.from(pixels.data.slice(-65 * 4)),
    }
  })
  expect(result.snapshot.status).toBe("ready")
  expect([result.width, result.height]).toEqual([65, 33])
  expect(result.alphas).toEqual([255])
  expect(result.lastRow).toEqual(
    Array.from({ length: 65 }, () => [24, 24, 27, 255]).flat()
  )
})

test("resizing preserves the presented backdrop and snapshots only change with state", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({ type: "initialize" })
    let notifications = 0
    const unsubscribe = engine.subscribe(() => {
      notifications++
    })
    await engine.dispatch({
      type: "resize",
      width: 21,
      height: 15,
      devicePixelRatio: 2,
    })
    const resized = engine.getSnapshot()
    await engine.dispatch({
      type: "resize",
      width: 21,
      height: 15,
      devicePixelRatio: 2,
    })
    const stable = resized === engine.getSnapshot()
    const pixels = await engine.readPixels()
    unsubscribe()
    engine.dispose()
    return {
      width: pixels.width,
      height: pixels.height,
      lastPixel: Array.from(pixels.data.slice(-4)),
      stable,
      notifications,
    }
  })
  expect(result).toEqual({
    width: 42,
    height: 30,
    lastPixel: [24, 24, 27, 255],
    stable: true,
    notifications: 1,
  })
})

test("disposing during initialization cannot disturb a replacement on the same canvas", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const old = window.engine
    const pending = old.dispatch({ type: "initialize" })
    window.remountEngine()
    await window.engine.dispatch({ type: "initialize" })
    await pending
    const pixels = await window.engine.readPixels()
    return {
      old: old.getSnapshot().status,
      current: window.engine.getSnapshot().status,
      pixel: Array.from(pixels.data.slice(0, 4)),
    }
  })
  expect(result).toEqual({
    old: "disposed",
    current: "ready",
    pixel: [24, 24, 27, 255],
  })
})

test("a resize during startup is painted before the engine reports ready", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const popErrorScope = GPUDevice.prototype.popErrorScope
    GPUDevice.prototype.popErrorScope = async function () {
      const error = await popErrorScope.call(this)
      document.documentElement.dataset.validationPending = "true"
      await new Promise<void>((resolve) =>
        window.addEventListener("test-resume-validation", () => resolve(), {
          once: true,
        })
      )
      return error
    }
  })
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(() => {
    void window.engine.dispatch({ type: "initialize" })
  })
  await page.waitForFunction(
    () => document.documentElement.dataset.validationPending === "true"
  )
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 65,
      height: 33,
      devicePixelRatio: 1,
    })
    window.dispatchEvent(new Event("test-resume-validation"))
  })
  await page.waitForFunction(
    () => window.engine.getSnapshot().status === "ready"
  )
  // A browser screenshot observes presentation without acquiring another
  // swap-chain texture (canvas drawImage/readback can discard that texture).
  const rendered = PNG.sync.read(await page.locator("canvas").screenshot())
  const lastPixel = rendered.data.subarray(-4)
  expect(Array.from(lastPixel)).toEqual([24, 24, 27, 255])
})

test("presents the tiled layer through the display transform", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const rendered = await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 64,
      height: 24,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    // Resize again after startup: the document is re-tiled and re-uploaded,
    // so the shape must survive a new render target.
    await window.engine.dispatch({
      type: "resize",
      width: 64,
      height: 24,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({
      type: "resize",
      width: 32,
      height: 12,
      devicePixelRatio: 2,
    })
    const pixels = await window.engine.readPixels()
    const at = (x: number, y: number) =>
      Array.from(
        pixels.data.slice(
          (y * pixels.width + x) * 4,
          (y * pixels.width + x) * 4 + 4
        )
      )
    return {
      colorSpace: pixels.colorSpace,
      snapshotColorSpace: window.engine.getSnapshot().outputColorSpace,
      background: at(2, 2),
      wideGreen: at(20, 8),
      halfOrange: at(40, 8),
      justOutsideGreen: at(7, 8),
      belowGreen: at(20, 16),
    }
  })

  // The engine reports the space it actually presented in, and the readback
  // is encoded in that same space.
  expect(rendered.colorSpace).toBe(rendered.snapshotColorSpace)
  expect(["srgb", "display-p3"]).toContain(rendered.colorSpace)

  const output = rendered.colorSpace as OutputColorSpace
  const expectPixel = (
    actual: number[],
    working: readonly [number, number, number]
  ) => {
    const expected = displayTransform(working, output).map((channel) =>
      Math.round(channel * 255)
    )
    for (const channel of [0, 1, 2])
      expect(Math.abs(actual[channel] - expected[channel])).toBeLessThanOrEqual(
        1
      )
    expect(actual[3]).toBe(255)
  }

  // Unpainted tiles were never allocated, so the backdrop shows through.
  expectPixel(rendered.background, BACKGROUND)
  expectPixel(rendered.justOutsideGreen, BACKGROUND)
  expectPixel(rendered.belowGreen, BACKGROUND)

  // Fully saturated working-space green: full gamut on a P3 swap chain,
  // clipped into sRGB otherwise.
  expectPixel(rendered.wideGreen, [0, 1, 0])
  if (output === "srgb")
    expect(rendered.wideGreen.slice(0, 3)).toEqual([0, 255, 0])

  // Half-transparent premultiplied orange composited over the backdrop in
  // linear light, before any transfer curve.
  expectPixel(rendered.halfOrange, [
    0.4 + BACKGROUND[0] * 0.5,
    0.15 + BACKGROUND[1] * 0.5,
    0.025 + BACKGROUND[2] * 0.5,
  ])
})
