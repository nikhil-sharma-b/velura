import { expect, test, type Page } from "@playwright/test"

async function stroke(page: Page, hue: number, jitter = false) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([turn, vary]) => {
      await window.engine.dispatch({
        type: "resize",
        width: 240,
        height: 140,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setColor", hex: "#e04030" })
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        dynamics: [
          {
            source: "random",
            target: "hue",
            range: vary ? [-0.25, 0.25] : [turn, turn],
            mix: "replace",
          },
          {
            source: "random",
            target: "saturation",
            range: vary ? [-0.5, 0.5] : [0, 0],
            mix: "replace",
          },
          {
            source: "random",
            target: "lightness",
            range: vary ? [-0.25, 0.25] : [0, 0],
            mix: "replace",
          },
        ],
      })
    },
    [hue, jitter] as const
  )
  const canvas = page.locator("canvas").first()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 30, box.y + 70)
  await page.mouse.down()
  await page.mouse.move(box.x + 210, box.y + 70, { steps: 30 })
  await page.mouse.up()
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  await page.evaluate(() => window.engine.readPixels())
  return canvas.screenshot()
}

test("the hue target changes rendered dab colour", async ({ page }) => {
  const red = await stroke(page, 0)
  const rotated = await stroke(page, 1 / 3)
  expect(rotated.equals(red)).toBe(false)
})

test("golden: a seeded colour-jitter stroke", async ({ page }) => {
  const first = await stroke(page, 0, true)
  expect(first).toMatchSnapshot("colour-jitter.png", {
    maxDiffPixelRatio: 0.01,
  })
  expect(await stroke(page, 0, true)).toEqual(first)
})

test("coverage keeps one dab's colour while buildup mixes overlapping colours", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(() => window.openStrokeBufferProbe(64, 64))
  const probe = page.locator("#probe")
  const draw = async (mode: "coverage" | "buildup", overlap: boolean) => {
    await page.evaluate(
      ([accumulation, both]) => {
        window.probe.beginStroke(accumulation, 0.5)
        window.probe.stamp([{ x: 32, y: 32, radius: 12, opacity: 0.6 }])
        if (both)
          window.probe.stamp([
            { x: 32, y: 32, radius: 12, opacity: 0.2, lightness: 0.8 },
          ])
        window.probe.present()
      },
      [mode, overlap] as const
    )
    return probe.screenshot()
  }
  const single = await draw("coverage", false)
  expect(await draw("coverage", true)).toEqual(single)
  expect(await draw("buildup", true)).not.toEqual(single)
  await page.evaluate(() => {
    window.probe.discardStamps(1)
    window.probe.present()
  })
  expect(await probe.screenshot()).toEqual(single)
})
