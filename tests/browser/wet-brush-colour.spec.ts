import { expect, test, type Page } from "@playwright/test"
import type { BrushColor } from "../../engine/brush/brush"
import type { Modulator } from "../../engine/brush/dynamics"

async function paint(
  page: Page,
  dynamics: Modulator[],
  pickup = 0,
  flow = 1,
  marks = 1,
  color?: BrushColor
) {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ({ dynamics, pickup, flow, color }) => {
      await window.engine.dispatch({
        type: "resize",
        width: 240,
        height: 120,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setColor", hex: "#d04030" })
      await window.engine.dispatch({
        type: "setBrush",
        radius: 12,
        spacing: 0.5,
        wet: { pickup },
        flow,
        dynamics,
        color: color ?? null,
      })
    },
    { dynamics, pickup, flow, color }
  )
  const box = (await page.locator("canvas").boundingBox())!
  for (let mark = 0; mark < marks; mark++) {
    const y = marks === 1 ? 60 : 35 + mark * 50
    await page.mouse.move(box.x + 30, box.y + y)
    await page.mouse.down()
    await page.mouse.move(box.x + 210, box.y + y, { steps: 30 })
    await page.mouse.up()
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      mark
    )
  }
  return page.evaluate(async () =>
    Array.from((await window.engine.readPixels()).data)
  )
}

for (const target of ["hue", "saturation", "lightness"] as const)
  test(`a wet brush loads its ${target} dynamics at pen-down`, async ({
    page,
  }) => {
    const plain = await paint(page, [])
    const tinted = await paint(page, [
      { source: "random", target, range: [0.3, 0.3], mix: "replace" },
    ])
    expect(tinted).not.toEqual(plain)
  })

test("wet colour jitter varies clean loads between strokes and repeats under the same seeds", async ({
  page,
}) => {
  const dynamics: Modulator[] = [
    { source: "random", target: "hue", range: [-0.4, 0.4], mix: "replace" },
  ]
  const first = await paint(page, dynamics, 0, 1, 2)
  expect(await paint(page, dynamics, 0, 1, 2)).toEqual(first)
  const pixel = (x: number, y: number) =>
    first.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 3)
  expect(pixel(80, 35)).not.toEqual(pixel(80, 85))
  // Later random values do not recolour the load within either stroke.
  expect(pixel(180, 35)).toEqual(pixel(80, 35))
  expect(pixel(180, 85)).toEqual(pixel(80, 85))
})

for (const target of ["hue", "saturation", "lightness"] as const)
  test(`a wet load scales ${target} by the brush colour base`, async ({
    page,
  }) => {
    const modulator: Modulator = {
      source: "random",
      target,
      range: [0.15, 0.15],
      mix: "replace",
    }
    const expected = await paint(page, [modulator])
    expect(
      await paint(page, [{ ...modulator, range: [0.3, 0.3] }], 0, 1, 1, {
        hue: 0.5,
        saturation: 0.5,
        lightness: 0.5,
      })
    ).toEqual(expected)
  })
