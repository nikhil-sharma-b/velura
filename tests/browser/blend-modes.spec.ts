import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import {
  displayTransform,
  encodeTransfer,
} from "../../engine/color/display-transform"
import type { BlendMode } from "../../engine/doc/document"

// Worked W3C §10.1 examples: backdrop 1/4, source 3/4, both opaque.
const examples: Record<BlendMode, number> = {
  normal: 0.75,
  multiply: 0.1875,
  screen: 0.8125,
  overlay: 0.375,
  darken: 0.25,
  lighten: 0.75,
  "color-dodge": 1,
  "color-burn": 0,
  "hard-light": 0.625,
  "soft-light": 0.375,
  difference: 0.5,
  exclusion: 0.625,
  add: 1,
  subtract: 0,
  hue: 0.25,
  saturation: 0.25,
  colour: 0.25,
  luminosity: 0.75,
}
const colourExamples: Record<BlendMode, readonly [number, number, number]> = {
  normal: [0.75, 0.25, 0.5],
  multiply: [0.1875, 0.125, 0.375],
  screen: [0.8125, 0.625, 0.875],
  overlay: [0.375, 0.25, 0.75],
  darken: [0.25, 0.25, 0.5],
  lighten: [0.75, 0.5, 0.75],
  "color-dodge": [1, 2 / 3, 1],
  "color-burn": [0, 0, 0.5],
  "hard-light": [0.625, 0.25, 0.75],
  "soft-light": [0.375, 0.375, 0.75],
  difference: [0.5, 0.25, 0.25],
  exclusion: [0.625, 0.5, 0.5],
  add: [1, 0.75, 1],
  subtract: [0, 0.25, 0.25],
  hue: [0.775, 0.275, 0.525],
  saturation: [0.25, 0.5, 0.75],
  colour: [0.775, 0.275, 0.525],
  luminosity: [0.225, 0.475, 0.725],
}
const modes = Object.keys(examples) as BlendMode[]
const pixel = (data: number[], x: number, y: number) =>
  data.slice((y * 96 + x) * 4, (y * 96 + x) * 4 + 3)
const encoded = (linear: number) => Math.round(encodeTransfer(linear) * 255)
async function open(page: Page) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.evaluate(async () => {
    window.blendProbe = await window.openBlendProbe()
  })
}
async function render(page: Page, mode: BlendMode, opacity = 1, selected = 1) {
  return page.evaluate(
    ({ mode, opacity, selected }) =>
      window.blendProbe.render(mode, opacity, selected),
    { mode, opacity, selected }
  )
}

for (const mode of modes)
  test(`${mode}: linear-light result, opacity and golden pair`, async ({
    page,
  }) => {
    await open(page)
    const full = await render(page, mode)
    for (const channel of pixel(full, 72, 40))
      expect(Math.abs(channel - encoded(examples[mode]))).toBeLessThanOrEqual(1)
    const image = new PNG({ width: 96, height: 144 })
    image.data = Buffer.from(full)
    expect(PNG.sync.write(image)).toMatchSnapshot(`${mode}.png`)
    const faded = await render(page, mode, 0.5)
    for (const channel of pixel(faded, 72, 40))
      expect(
        Math.abs(channel - encoded((0.25 + examples[mode]) / 2))
      ).toBeLessThanOrEqual(1)
    // Both non-opaque layers: source alpha 1/2 at opacity 1/2 over alpha 1/2.
    // W3C source-over weights are 1/8 source, 3/8 backdrop, 1/8 blend;
    // the uncovered 3/8 shows the display background only after blending.
    const mixed = colourExamples[mode]
    const expected = displayTransform(
      [
        0.234375 + mixed[0] / 8,
        0.265625 + mixed[1] / 8,
        0.390625 + mixed[2] / 8,
      ],
      "srgb"
    ).map((v) => Math.round(v * 255))
    pixel(faded, 56, 120).forEach((v, i) =>
      expect(Math.abs(v - expected[i])).toBeLessThanOrEqual(1)
    )
    // Selecting any layer cannot change the image. Exercise below-cache,
    // active-layer and backdrop-dependent upper-stack paths with the same pair.
    for (const selected of [0, 2, 1]) {
      const other = await render(page, mode, 0.5, selected)
      expect(
        Math.max(...other.map((v, i) => Math.abs(v - faded[i])))
      ).toBeLessThanOrEqual(1)
    }
    const hidden = await render(page, mode, 0)
    for (const channel of pixel(hidden, 72, 40))
      expect(Math.abs(channel - encoded(0.25))).toBeLessThanOrEqual(1)
  })

for (const selected of [0, 1])
  test(`a live stroke matches its committed pixels with active layer ${selected}`, async ({
    page,
  }) => {
    await open(page)
    const before = await render(page, "overlay", 0.5, selected)
    await page.evaluate(() => window.blendProbe.stroke(false))
    const live = await render(page, "overlay", 0.5, selected)
    expect(pixel(live, 40, 40)).not.toEqual(pixel(before, 40, 40))
    await page.evaluate(() => window.blendProbe.stroke(true))
    const committed = await render(page, "overlay", 0.5, selected)
    expect(committed).toEqual(live)
  })

test("mode pipelines are created on demand and reused", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  const created = await page.evaluate(async () => {
    const original = GPUDevice.prototype.createRenderPipeline
    const labels: string[] = []
    GPUDevice.prototype.createRenderPipeline = function (descriptor) {
      labels.push(descriptor.label ?? "")
      return original.call(this, descriptor)
    }
    try {
      window.blendProbe = await window.openBlendProbe()
      const before = labels.filter((label) => /^(blend|present):/.test(label))
      await window.blendProbe.render("multiply")
      const first = [...labels]
      await window.blendProbe.render("multiply", 0.5)
      await window.blendProbe.render("multiply", 1)
      const reused = [...labels]
      await window.blendProbe.render("screen")
      const next = [...labels]
      await window.blendProbe.render("multiply")
      return { before, first, reused, next, returned: labels }
    } finally {
      GPUDevice.prototype.createRenderPipeline = original
    }
  })
  expect(created.before).toEqual([])
  expect(created.first.filter((label) => label.startsWith("present:"))).toEqual(
    ["present:multiply"]
  )
  expect(created.reused).toEqual(created.first)
  expect(created.next.slice(created.reused.length)).toEqual(["present:screen"])
  expect(created.returned).toEqual(created.next)
})
