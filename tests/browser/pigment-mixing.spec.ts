import { expect, test, type Page } from "@playwright/test"

async function mix(page: Page, a: number[], b: number[], t = 0.5) {
  return page.evaluate(([a, b, t]) => window.mixPaintProbe(a, b, t), [
    a,
    b,
    t,
  ] as const)
}

test.beforeEach(async ({ page }) => {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.mixPaintProbe)
})

test("transparency only thins pigment, including almost empty paint", async ({
  page,
}) => {
  for (const alpha of [1, 0.25, 0.000001]) {
    const paint = [0.2 * alpha, 0.4 * alpha, 0.8 * alpha, alpha]
    for (const pair of [
      [paint, [0, 0, 0, 0]],
      [[0, 0, 0, 0], paint],
    ]) {
      const result = await mix(page, pair[0], pair[1])
      for (let i = 0; i < 4; i++)
        expect(result[i]).toBeCloseTo(paint[i] * 0.5, 7)
    }
  }
  expect(await mix(page, [0, 0, 0, 0], [0, 0, 0, 0])).toEqual([0, 0, 0, 0])
})

test("same pigment at different opacities stays the same pigment", async ({
  page,
}) => {
  const result = await mix(page, [0.1, 0.2, 0.4, 0.5], [0.2, 0.4, 0.8, 1])
  for (const [i, expected] of [0.15, 0.3, 0.6, 0.75].entries())
    expect(result[i]).toBeCloseTo(expected, 6)
})

test("P3 colours outside sRGB survive both equal and unequal mixes", async ({
  page,
}) => {
  // P3 red at these levels converts to sRGB with a negative green channel.
  const a = [1, 0, 0, 1]
  const b = [0.8, 0, 0, 1]
  expect(await mix(page, a, a)).toEqual(a)
  const result = await mix(page, a, b)
  expect(result.every(Number.isFinite)).toBe(true)
  expect(result[0]).toBeGreaterThan(0.8)
  expect(result[1]).toBeLessThan(0.01)
  expect(result[2]).toBeLessThan(0.01)
  expect(result[3]).toBe(1)
})

test("endpoints and swapping paints retain their meanings", async ({
  page,
}) => {
  const a = [0.1, 0.2, 0.4, 0.5],
    b = [0.8, 0.5, 0.1, 1]
  const start = await mix(page, a, b, 0),
    end = await mix(page, a, b, 1)
  for (let i = 0; i < 4; i++) {
    expect(start[i]).toBeCloseTo(a[i], 6)
    expect(end[i]).toBeCloseTo(b[i], 6)
  }
  const forward = await mix(page, a, b, 0.3)
  const backward = await mix(page, b, a, 0.7)
  for (let i = 0; i < 4; i++) expect(forward[i]).toBeCloseTo(backward[i], 6)
})
