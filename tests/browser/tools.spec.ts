import { expect, test, type Page } from "@playwright/test"
import type { EngineCommand } from "../../engine"

const WIDTH = 200
const HEIGHT = 120
const GREEN = { x: 20, y: 10 }

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
      const state = window.engine.getSnapshot()
      if (state.status !== "ready") throw new Error(state.error ?? state.status)
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 8 })
    },
    [WIDTH, HEIGHT]
  )
  return (await page.locator("canvas").boundingBox())!
}

async function pixels(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

const rgba = (image: number[], at: { x: number; y: number }) =>
  image.slice((at.y * WIDTH + at.x) * 4, (at.y * WIDTH + at.x) * 4 + 4)

async function stroke(
  page: Page,
  origin: { x: number; y: number },
  y: number,
  from = 10,
  to = 30
) {
  const steps = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(origin.x + from, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + y, { steps: 20 })
  await page.mouse.up()
  await page.waitForFunction(
    (before) => window.engine.historyUsage().steps > before,
    steps
  )
}

test("an erase stroke removes only the active layer and is one undo step", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const scene = await pixels(page)
  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  await stroke(page, origin, GREEN.y)
  const painted = await pixels(page)
  expect(rgba(painted, GREEN)).not.toEqual(rgba(scene, GREEN))

  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "eraser" })
  )
  await stroke(page, origin, GREEN.y)
  const erased = await pixels(page)
  expect(rgba(erased, GREEN)).toEqual(rgba(scene, GREEN))

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await pixels(page)).toEqual(painted)
})

test("a soft erase preserves premultiplied colour at transparent edges", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(() => window.openStrokeBufferProbe(64, 64))
  const [painted, erased] = await page.evaluate(async () => {
    window.probe.beginStroke("coverage", 0.6)
    window.probe.stamp([{ x: 32, y: 32, radius: 16, opacity: 0.6 }])
    window.probe.endStroke()
    const before = await window.probe.readLayerPixel(32, 32)
    window.probe.beginStroke("coverage", 0.5, "erase")
    window.probe.stamp([{ x: 32, y: 32, radius: 16, opacity: 0.5 }])
    window.probe.endStroke()
    return [before, await window.probe.readLayerPixel(32, 32)]
  })
  expect(erased[3]).toBeLessThan(painted[3])
  // Destination-out must scale every premultiplied channel by the same
  // factor as alpha. Keeping RGB behind would make a bright fringe; clearing
  // it faster would make a dark one on the next backdrop.
  for (let channel = 0; channel < 3; channel++)
    expect(erased[channel] / erased[3]).toBeCloseTo(
      painted[channel] / painted[3],
      2
    )
})

test("the eraser respects locks", async ({ page }) => {
  const origin = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    await window.engine.dispatch({ type: "setBrush", radius: 14 })
  })
  await stroke(page, origin, 50, 20, 160)
  const painted = await pixels(page)

  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "eraser" })
    const id = window.engine.getSnapshot().activeLayerId
    await window.engine.dispatch({ type: "setLayer", id, locked: true })
  })
  await strokeWithoutHistory(page, origin, 50, 30, 150)
  expect(await pixels(page)).toEqual(painted)
})

type BrushCommand = Omit<Extract<EngineCommand, { type: "setBrush" }>, "type">

async function erasedPixelCount(page: Page, settings: BrushCommand) {
  const origin = await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    await window.engine.dispatch({ type: "setBrush", radius: 14 })
  })
  await stroke(page, origin, 50, 20, 160)
  const painted = await pixels(page)
  await page.evaluate(async (brush) => {
    await window.engine.dispatch({ type: "setBrush", ...brush })
    await window.engine.dispatch({ type: "setTool", tool: "eraser" })
  }, settings)
  await stroke(page, origin, 50, 30, 150)
  const erased = await pixels(page)
  let changed = 0
  let delta = 0
  for (let y = 35; y <= 65; y++)
    for (let x = 20; x <= 160; x++) {
      const before = rgba(painted, { x, y })
      const after = rgba(erased, { x, y })
      if (after.some((channel, index) => channel !== before[index])) changed++
      delta += after.reduce(
        (sum, channel, index) => sum + Math.abs(channel - before[index]),
        0
      )
    }
  return { changed, delta }
}

test("the solid eraser ignores painting brush shape, texture, grain, and dynamics", async ({
  page,
}) => {
  const shaped = { radius: 14, roundness: 0.2 } as const
  const dynamics = [
    {
      source: "pressure",
      target: "size",
      curve: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      range: [0.2, 0.6] as [number, number],
      mix: "replace",
    },
  ] as BrushCommand["dynamics"]
  const round = await erasedPixelCount(page, { radius: 14 })
  const narrow = await erasedPixelCount(page, shaped)
  const pressureSized = await erasedPixelCount(page, { ...shaped, dynamics })
  const textured = await erasedPixelCount(page, {
    ...shaped,
    dynamics,
    tipTextureId: "graphite",
  })
  const grained = await erasedPixelCount(page, {
    ...shaped,
    dynamics,
    tipTextureId: "graphite",
    grain: { textureId: "paper", scale: 1, depth: 0.8, movement: 0 },
  })
  expect(narrow).toEqual(round)
  expect(pressureSized).toEqual(round)
  expect(textured).toEqual(round)
  expect(grained).toEqual(round)
})

async function strokeWithoutHistory(
  page: Page,
  origin: { x: number; y: number },
  y: number,
  from: number,
  to: number
) {
  await page.mouse.move(origin.x + from, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + to, origin.y + y, { steps: 20 })
  await page.mouse.up()
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  )
}

test("Alt samples the composited colour without leaving the brush tool", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.keyboard.down("Alt")
  await page.mouse.click(origin.x + GREEN.x, origin.y + GREEN.y)
  await page.keyboard.up("Alt")

  await expect
    .poll(() => page.evaluate(() => window.engine.getSnapshot().color.red))
    .toBeLessThan(0.3)
  const snapshot = await page.evaluate(() => window.engine.getSnapshot())
  expect(snapshot.tool).toBe("brush")
  expect(snapshot.color.red).toBeLessThan(0.3)
  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    before
  )

  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  await stroke(page, origin, 80)
  const reused = await pixels(page)
  expect(rgba(reused, { x: 20, y: 80 })[1]).toBeGreaterThan(
    rgba(reused, { x: 20, y: 80 })[0]
  )
})
