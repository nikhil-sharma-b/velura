import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"

test("initializes the facade and presents opaque cleared pixels", async ({
  page,
}) => {
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
    return {
      snapshot: window.engine.getSnapshot(),
      width: pixels.width,
      height: pixels.height,
      pixels: Array.from(pixels.data),
    }
  })
  expect(result.snapshot.status).toBe("ready")
  expect([result.width, result.height]).toEqual([65, 33])
  expect(result.pixels).toEqual(
    Array.from({ length: 65 * 33 }, () => [24, 24, 27, 255]).flat()
  )
})

test("resizing preserves cleared output and snapshots only change with state", async ({
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
