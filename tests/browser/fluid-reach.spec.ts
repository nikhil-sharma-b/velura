import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import { writeFile } from "node:fs/promises"

/** Story 21's opt-in experiment, observed through commands and presented pixels. */
async function wash(
  page: Page,
  experimental: boolean,
  diameter = 500,
  options: {
    bleed?: number
    steps?: number
    otherLarge?: boolean
    barrier?: boolean
    yellow?: boolean
    prelude?: "cancel" | "clear" | "undo"
    water?: number
    feather?: boolean
  } = {}
) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  return page.evaluate(
    async ({ experimental, diameter, options }) => {
      window.remountEngine({
        manualFluidClock: true,
        experimentalFluidReach: experimental,
      })
      const engine = window.engine
      await engine.dispatch({
        type: "resize",
        width: 512,
        height: 512,
        devicePixelRatio: 1,
      })
      await engine.dispatch({ type: "initialize" })
      await engine.dispatch({ type: "addLayer" })
      await engine.dispatch({ type: "setStabilization", strength: 0 })
      if (options.barrier) {
        await engine.dispatch({ type: "selectAll" })
        await engine.dispatch({
          type: "selectShape",
          shape: "rect",
          x: 0,
          y: 274,
          width: 512,
          height: 2,
          mode: "subtract",
        })
      }
      if (options.feather) {
        await engine.dispatch({
          type: "selectShape",
          shape: "rect",
          x: 256,
          y: 0,
          width: 256,
          height: 512,
        })
        await engine.dispatch({ type: "featherSelection", radius: 8 })
      }
      await engine.dispatch({ type: "setColor", hex: "#1040e0" })
      await engine.dispatch({
        type: "setBrush",
        radius: diameter / 2,
        flow: 0.1,
        fluid: {
          water: options.water ?? 0.5,
          drying: 0.5,
          bleed: options.bleed ?? 1,
          edge: 0,
          granulation: 0,
        },
      })
      const canvas = document.querySelector("canvas")!
      const frame = () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
      const tap = async (x: number, y: number, cancel = false) => {
        const box = canvas.getBoundingClientRect()
        for (const type of ["pointerdown", "pointerup"]) {
          canvas.dispatchEvent(
            new PointerEvent(type, {
              pointerId: 1,
              pointerType: "pen",
              isPrimary: true,
              bubbles: true,
              clientX: box.left + (x * box.width) / 512,
              clientY: box.top + (y * box.height) / 512,
              pressure: 1,
              buttons: type === "pointerdown" ? 1 : 0,
            })
          )
          await frame()
          if (cancel && type === "pointerdown")
            await engine.dispatch({ type: "setTool", tool: "eraser" })
        }
        if (cancel) await engine.dispatch({ type: "setTool", tool: "brush" })
      }
      if (options.prelude) {
        await engine.dispatch({ type: "setBrush", radius: 250 })
        await tap(256, 256, options.prelude === "cancel")
        if (options.prelude === "undo") await engine.dispatch({ type: "undo" })
        if (options.prelude === "clear")
          await engine.dispatch({
            type: "clearLayer",
            id: engine.getSnapshot().activeLayerId!,
          })
        await engine.dispatch({ type: "setBrush", radius: diameter / 2 })
      }
      if (options.otherLarge) {
        await engine.dispatch({ type: "setBrush", radius: 100 })
        await tap(72, 72)
        await engine.dispatch({ type: "setBrush", radius: diameter / 2 })
      }
      await tap(256, 256)
      await engine.dispatch({ type: "setColor", hex: "#f0c020" })
      await engine.dispatch({ type: "setBrush", radius: 8, flow: 1 })
      if (options.yellow !== false) await tap(256, 256)
      await engine.dispatch({
        type: "advanceFluid",
        steps: options.steps ?? 100,
      })
      await frame()
      if (engine.getSnapshot().status !== "ready")
        throw new Error(engine.getSnapshot().error ?? "Engine failed")
      return Array.from((await engine.readPixels()).data)
    },
    { experimental, diameter, options }
  )
}

async function comparison(
  diameter: number,
  baseline: number[],
  candidate: number[]
) {
  const png = new PNG({ width: 1024, height: 512 })
  for (let y = 0; y < 512; y++) {
    png.data.set(baseline.slice(y * 512 * 4, (y + 1) * 512 * 4), y * 1024 * 4)
    png.data.set(
      candidate.slice(y * 512 * 4, (y + 1) * 512 * 4),
      (y * 1024 + 512) * 4
    )
  }
  const name = `reach-${diameter}px-baseline-left-candidate-right`
  const path = test.info().outputPath(`${name}.png`)
  await writeFile(path, PNG.sync.write(png))
  await test.info().attach(name, { path, contentType: "image/png" })
}

test("experimental large-wash mixing reaches beyond the local-stencil transition", async ({
  page,
}) => {
  test.slow()
  const baseline = await wash(page, false)
  const candidate = await wash(page, true)
  await comparison(500, baseline, candidate)
  // A touch entering the large wash inherits its scale, despite the active
  // brush now being small. Look well outside the touch's eight-pixel radius.
  const at = (image: number[], y: number) =>
    image.slice((y * 512 + 256) * 4, (y * 512 + 256) * 4 + 3)
  // Yellow removes blue from the blue wash. Accumulate the faint outer tail
  // rather than requiring saturated green from a small, diluted touch.
  let extraYellow = 0
  for (let y = 274; y <= 290; y++)
    extraYellow += at(baseline, y)[2] - at(candidate, y)[2]
  expect(extraYellow).toBeGreaterThan(20)
})

test("comparison evidence at 100 and 250 px, with identical settings and step counts", async ({
  page,
}) => {
  test.slow()
  for (const diameter of [100, 250]) {
    const baseline = await wash(page, false, diameter)
    const candidate = await wash(page, true, diameter)
    await comparison(diameter, baseline, candidate)
    if (diameter === 100) expect(candidate).toEqual(baseline)
    else expect(candidate).not.toEqual(baseline)
  }
})

test("the experiment preserves 100 and 150 px brushes, and Bleed zero", async ({
  page,
}) => {
  test.slow()
  for (const [diameter, bleed] of [
    [100, 1],
    [150, 1],
    [500, 0],
  ]) {
    const baseline = await wash(page, false, diameter, { bleed, steps: 30 })
    expect(await wash(page, true, diameter, { bleed, steps: 30 })).toEqual(
      baseline
    )
  }
})

test("a disconnected large mark sharing allocated tiles does not rescale the small wash", async ({
  page,
}) => {
  test.slow()
  const without = await wash(page, true, 100, { steps: 40 })
  const withLarge = await wash(page, true, 100, { steps: 40, otherLarge: true })
  const crop = (image: number[]) => {
    const pixels = []
    for (let y = 200; y < 312; y++)
      pixels.push(...image.slice((y * 512 + 200) * 4, (y * 512 + 312) * 4))
    return pixels
  }
  expect(crop(withLarge)).toEqual(crop(without))
})

test("fractional water and feathered selection preserve the small-brush gate", async ({
  page,
}) => {
  test.slow()
  const options = { water: 0.1, feather: true, steps: 10 }
  const baseline = await wash(page, false, 100, options)
  expect(await wash(page, true, 100, options)).toEqual(baseline)
})

test("a two-pixel selection slit blocks long-range mixing rather than just clipping its endpoints", async ({
  page,
}) => {
  test.slow()
  const plain = await wash(page, true, 500, { barrier: true, yellow: false })
  const touched = await wash(page, true, 500, { barrier: true })
  // Both endpoints beyond this slit are selected and wet. A shortcut which
  // checks endpoints alone would carry yellow into the lower half.
  expect(touched.slice(276 * 512 * 4)).toEqual(plain.slice(276 * 512 * 4))
})

test("undo and redo restore local reach as well as the displayed paint", async ({
  page,
}) => {
  test.slow()
  await wash(page, true, 500, { steps: 0 })
  const read = () =>
    page.evaluate(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      return Array.from((await window.engine.readPixels()).data)
    })
  const before = await read()
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await read()).not.toEqual(before)
  // Remove the large wash too, so redo must restore its scale field rather
  // than merely retain scale that the yellow touch never changed.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  const empty = await read()
  expect(empty.slice((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 4)).toEqual(
    [255, 255, 255, 255]
  )
  expect(await page.evaluate(() => window.engine.getSnapshot().wet)).toBe(false)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await read()).toEqual(before)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "advanceFluid", steps: 100 })
  )
  const restored = await read()
  expect(restored).toEqual(await wash(page, true))
})

test("cancel, undo, and clearing a large dab leave no scale in reused cells", async ({
  page,
}) => {
  test.slow()
  const clean = await wash(page, true, 100, { steps: 30 })
  for (const prelude of ["cancel", "undo", "clear"] as const)
    expect(await wash(page, true, 100, { steps: 30, prelude })).toEqual(clean)
})
