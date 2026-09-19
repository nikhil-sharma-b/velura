import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * A thumbnail is a document shrunk many times over, and a line a few pixels
 * wide covers a sliver of each thumbnail pixel. Averaged, it vanishes; the
 * thumbnail has to keep it, or a row of linework reads as an empty checker.
 */
test("a thin line on a large document still shows in its thumbnail", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    window.remountEngine({ documentSize: { width: 2048, height: 2048 } })
    await window.engine.dispatch({
      type: "resize",
      width: 400,
      height: 400,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    await window.engine.dispatch({ type: "setBrush", radius: 2 })
    await window.engine.dispatch({ type: "addLayer" })
  })
  const box = (await page.locator("canvas").first().boundingBox())!
  await page.mouse.move(box.x + 60, box.y + 200)
  await page.mouse.down()
  for (let step = 1; step <= 20; step++)
    await page.mouse.move(box.x + 60 + step * 14, box.y + 200)
  await page.mouse.up()
  await page.evaluate(() => {
    const thumbnail = document.createElement("canvas")
    thumbnail.id = "thumbnail"
    thumbnail.width = thumbnail.height = 64
    document.body.append(thumbnail)
    const layers = window.engine.getSnapshot().layers
    window.engine.attachThumbnail(layers[layers.length - 1].id, thumbnail)
  })
  await expect
    .poll(async () => {
      const png = PNG.sync.read(await page.locator("#thumbnail").screenshot())
      let inked = 0
      for (let offset = 0; offset < png.data.length; offset += 4)
        if (png.data[offset] < 120) inked++
      return inked
    })
    // Framed on the line rather than the canvas, it runs the width of the
    // thumbnail instead of a tenth of it.
    .toBeGreaterThan(48)
})

test("pointing at a layer dims the rest on screen but not in an export", async ({
  page,
}) => {
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
    await window.engine.dispatch({ type: "addLayer" })
  })
  const canvas = page.locator("canvas").first()
  // Inside the seeded scene's green rectangle, which is on the first layer.
  const green = async () => {
    const png = PNG.sync.read(await canvas.screenshot())
    return (
      png.data[(10 * png.width + 20) * 4 + 1] -
      png.data[(10 * png.width + 20) * 4]
    )
  }
  const exported = () =>
    page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data.slice(0, 4000))
    )
  const before = { screen: await green(), file: await exported() }
  await page.evaluate(async () => {
    const layers = window.engine.getSnapshot().layers
    await window.engine.dispatch({
      type: "highlightLayer",
      id: layers[layers.length - 1].id,
    })
  })
  // Dimmed over white, the green washes out toward grey.
  await expect.poll(green).toBeLessThan(before.screen / 2)
  expect(await exported()).toEqual(before.file)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "highlightLayer", id: null })
  )
  await expect.poll(green).toBe(before.screen)
})

test("a layer erased back to nothing reads as empty again", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    window.remountEngine({ documentSize: { width: 1024, height: 1024 } })
    await window.engine.dispatch({
      type: "resize",
      width: 400,
      height: 400,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    await window.engine.dispatch({ type: "setBrush", radius: 3 })
    await window.engine.dispatch({ type: "addLayer" })
    const states: boolean[] = []
    Object.assign(window, { thumbnailStates: states })
    const thumbnail = document.createElement("canvas")
    thumbnail.width = thumbnail.height = 64
    document.body.append(thumbnail)
    const layers = window.engine.getSnapshot().layers
    window.engine.attachThumbnail(
      layers[layers.length - 1].id,
      thumbnail,
      (drawn) => states.push(drawn.empty)
    )
  })
  const empty = () =>
    page.evaluate(() => {
      const states = (window as unknown as { thumbnailStates: boolean[] })
        .thumbnailStates
      return states[states.length - 1]
    })
  const box = (await page.locator("canvas").first().boundingBox())!
  const sweep = async () => {
    await page.mouse.move(box.x + 100, box.y + 200)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++)
      await page.mouse.move(box.x + 100 + step * 20, box.y + 200)
    await page.mouse.up()
  }
  await expect.poll(empty).toBe(true)
  await sweep()
  await expect.poll(empty).toBe(false)

  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "eraser" })
    await window.engine.dispatch({ type: "setBrush", radius: 40 })
  })
  await sweep()
  await expect.poll(empty).toBe(true)
})
