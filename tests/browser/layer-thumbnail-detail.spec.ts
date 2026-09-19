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
    .toBeGreaterThan(8)
})
