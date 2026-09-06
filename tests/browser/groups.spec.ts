import { expect, test, type Page } from "@playwright/test"

async function openCanvas(page: Page) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    window.remountEngine()
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    await window.engine.dispatch({ type: "setBrush", radius: 14 })
  })
  return (await page.locator("canvas").boundingBox())!
}

async function stroke(page: Page, origin: { x: number; y: number }) {
  await page.mouse.move(origin.x + 4, origin.y + 10)
  await page.mouse.down()
  await page.mouse.move(origin.x + 64, origin.y + 10, { steps: 30 })
  await page.mouse.up()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

async function groupedStrokePasses(page: Page, count: number) {
  await openCanvas(page)
  await page.evaluate(async (layers) => {
    await window.buildLayerStack(layers)
    const ids = window.engine.getSnapshot().layers.map((layer) => layer.id)
    await window.engine.dispatch({ type: "addGroup", ids })
  }, count)
  return page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
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
      await window.markActiveLayer()
    } finally {
      encoder.beginRenderPass = beginRenderPass
    }
    return passes
  })
}

test("nested groups flatten with their own opacity", async ({ page }) => {
  const origin = await openCanvas(page)
  const ids = await page.evaluate(async () => {
    const bottom = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addLayer" })
    const paint = window.engine.getSnapshot().activeLayerId
    return { bottom, paint }
  })
  await stroke(page, origin)
  await page.evaluate(async ({ bottom, paint }) => {
    await window.engine.dispatch({ type: "addGroup", ids: [bottom, paint] })
    const inner = window.engine.getSnapshot().layers[0].id
    await window.engine.dispatch({ type: "addGroup", ids: [inner] })
    const outer = window.engine.getSnapshot().layers[0].id
    await window.engine.dispatch({
      type: "setLayer",
      id: outer,
      opacity: 0.55,
      blend: "multiply",
    })
  }, ids)
  await expect(page.locator("canvas")).toHaveScreenshot("nested-groups.png")
})

test("clipping is confined to its base inside a group", async ({ page }) => {
  const origin = await openCanvas(page)
  const ids = await page.evaluate(async () => {
    const bottom = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addLayer" })
    const shading = window.engine.getSnapshot().activeLayerId
    return { bottom, shading }
  })
  await stroke(page, { x: origin.x + 20, y: origin.y })
  const active = await page.evaluate(async ({ bottom }) => {
    await window.engine.dispatch({ type: "addLayer" })
    const activeId = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "setBrush", radius: 3 })
    await window.engine.dispatch({ type: "addMask", id: bottom })
    await window.engine.dispatch({ type: "selectMask", id: bottom })
    return activeId
  }, ids)
  await stroke(page, origin)
  await page.evaluate(
    async ({ bottom, shading, active }) => {
      await window.engine.dispatch({
        type: "setLayer",
        id: shading,
        clip: true,
        opacity: 0.7,
      })
      await window.engine.dispatch({ type: "addGroup", ids: [bottom, shading] })
      await window.engine.dispatch({ type: "selectLayer", id: active })
    },
    { ...ids, active }
  )
  await expect(page.locator("canvas")).toHaveScreenshot(
    "clipping-inside-group.png"
  )
})

test("a painted mask hides only part of a layer", async ({ page }) => {
  const origin = await openCanvas(page)
  const before = await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({
      type: "setBrush",
      radius: 3,
      tipTextureId: "graphite",
      grain: { textureId: "paper", scale: 1, depth: 0.8 },
    })
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
    return Array.from((await window.engine.readPixels()).data)
  })
  await stroke(page, origin)
  const masked = await page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
  expect(masked).not.toEqual(before)
  await expect(page.locator("canvas")).toHaveScreenshot("partial-mask.png")
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "setMaskEnabled", id, enabled: false })
  })
  expect(
    await page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data)
    )
  ).toEqual(before)
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "removeMask", id })
  })
  expect(
    await page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data)
    )
  ).toEqual(before)
})

test("clipping follows a base mask before the pen lifts", async ({ page }) => {
  const origin = await openCanvas(page)
  const ids = await page.evaluate(async () => {
    const bottom = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "addLayer" })
    return { bottom, shading: window.engine.getSnapshot().activeLayerId }
  })
  await stroke(page, origin)
  await page.evaluate(async ({ bottom, shading }) => {
    await window.engine.dispatch({
      type: "setLayer",
      id: shading,
      clip: true,
    })
    await window.engine.dispatch({ type: "addGroup", ids: [bottom, shading] })
    await window.engine.dispatch({ type: "addMask", id: bottom })
    await window.engine.dispatch({ type: "selectMask", id: bottom })
    await window.engine.dispatch({ type: "setBrush", radius: 3 })
  }, ids)

  await page.mouse.move(origin.x + 4, origin.y + 10)
  await page.mouse.down()
  await page.mouse.move(origin.x + 64, origin.y + 10, { steps: 30 })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  const live = await page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
  await page.mouse.up()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  const committed = await page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
  expect(live).toEqual(committed)
})

test("a grouped stroke stays flat as sibling count grows", async ({ page }) => {
  test.setTimeout(120_000)
  // Both cases have cached siblings above and below the active child; the
  // comparison varies their count, not whether a side exists at all.
  const shallow = await groupedStrokePasses(page, 3)
  const deep = await groupedStrokePasses(page, 30)
  expect(deep).toBe(shallow)
  expect(deep).toBeLessThan(30)
})
