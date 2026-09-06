import { expect, test, type Page } from "@playwright/test"

async function openCanvas(page: Page) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
  })
  return (await page.locator("canvas").boundingBox())!
}

test("the preview PNG preserves the canvas display colour", async ({
  page,
}) => {
  const canvas = await openCanvas(page)
  await page.mouse.move(canvas.x + 40, canvas.y + 60)
  await page.mouse.down()
  await page.mouse.move(canvas.x + 160, canvas.y + 60, { steps: 30 })
  await page.mouse.up()
  await page.waitForFunction(() => window.engine.historyUsage().steps === 1)

  const comparison = await page.evaluate(async () => {
    const captured = await window.engine.readPixels()
    const png = await window.encodePreview(captured)
    const decoded = await createImageBitmap(
      new Blob([new Uint8Array(png).buffer], { type: "image/png" })
    )
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const context = canvas.getContext("2d")!
    context.drawImage(decoded, 0, 0)
    const roundTripped = context.getImageData(
      0,
      0,
      decoded.width,
      decoded.height
    ).data
    const at = (x: number, y: number) => {
      const offset = (y * captured.width + x) * 4
      return {
        captured: Array.from(captured.data.slice(offset, offset + 4)),
        preview: Array.from(roundTripped.slice(offset, offset + 4)),
      }
    }
    return { ink: at(100, 60), backdrop: at(10, 10) }
  })

  expect(comparison.ink.preview).toEqual(comparison.ink.captured)
  expect(comparison.backdrop.preview).toEqual(comparison.backdrop.captured)
})
