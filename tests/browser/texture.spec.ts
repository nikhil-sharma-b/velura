import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Tip textures and canvas-space grain (D24).
 *
 * Most of this drives the renderer through the probe rather than a pen: what
 * is under test is where a texture is sampled from, and a gesture would add
 * resampling and stabilization between the claim and the pixels. The dynamics
 * mapping onto grain depth is the exception — that one has to come through the
 * graph, so it is drawn with a stylus.
 */

const SIZE = 96

type Dab = {
  x: number
  y: number
  radius: number
  opacity: number
  angle?: number
  roundness?: number
  grainDepth?: number
}

async function openProbe(page: Page, size = SIZE) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    ([width, height]) => window.openStrokeBufferProbe(width, height),
    [size, size]
  )
  return page.locator("#probe")
}

/** Lays down one pass of dabs and presents it, with the given tip and paper. */
async function paint(
  page: Page,
  dabs: Dab[],
  surface: {
    tip: string | null
    grain: string | null
    scale: number
    depth: number
  }
) {
  await page.evaluate(
    ([marks, brush]) => {
      const settings = brush as {
        tip: string | null
        grain: string | null
        scale: number
        depth: number
      }
      window.probe.setTip(settings.tip)
      window.probe.setGrain(settings.grain, settings.scale, settings.depth)
      window.probe.beginStroke("coverage", 1)
      window.probe.stamp(marks as Dab[])
      window.probe.endStroke()
      window.probe.present()
    },
    [dabs, surface] as const
  )
}

/** A band of overlapping dabs along a row, offset along its own direction. */
function band(offset: number, y = SIZE / 2): Dab[] {
  return Array.from({ length: 24 }, (_, i) => ({
    x: 8 + i * 3 + offset,
    y,
    radius: 9,
    opacity: 1,
  }))
}

function read(shot: Buffer) {
  const png = PNG.sync.read(shot)
  return {
    width: png.width,
    height: png.height,
    at: (x: number, y: number) => png.data[(y * png.width + x) * 4],
  }
}

type Image = ReturnType<typeof read>

/** The pixels of one row through the middle of the band. */
function row(image: Image, y: number, from: number, to: number): number[] {
  return Array.from({ length: to - from }, (_, i) => image.at(from + i, y))
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

/** How closely two rows vary together, in [-1, 1]. One is the same pattern. */
function correlation(a: number[], b: number[]): number {
  const mean = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length
  const meanA = mean(a)
  const meanB = mean(b)
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (const [i, value] of a.entries()) {
    covariance += (value - meanA) * (b[i] - meanB)
    varianceA += (value - meanA) ** 2
    varianceB += (b[i] - meanB) ** 2
  }
  return covariance / Math.sqrt(varianceA * varianceB)
}

const PAPER = { tip: null, grain: "paper", scale: 1, depth: 1 }
const SMOOTH = { tip: null, grain: null, scale: 1, depth: 0 }

test("grain stays fixed to the canvas as the brush moves over it", async ({
  page,
}) => {
  // The same stretch of canvas, covered twice by dabs that sit in different
  // places. Grain sampled in stamp space would travel with the dabs and the
  // two passes would differ; sampled in canvas space they are the same paper.
  const probe = await openProbe(page)
  await paint(page, band(0), PAPER)
  const aligned = read(await probe.screenshot())

  await openProbe(page)
  await paint(page, band(1.5), PAPER)
  const offset = read(await probe.screenshot())

  const y = SIZE / 2
  const first = row(aligned, y, 20, 76)
  const second = row(offset, y, 20, 76)
  // Textured at all: a flat band would make the comparison below vacuous.
  expect(spread(first)).toBeGreaterThan(20)
  // And identical under the shift, pixel for pixel.
  for (const [i, value] of first.entries())
    expect(Math.abs(value - second[i])).toBeLessThanOrEqual(2)
})

test("a second pass over the same area finds the grain where it left it", async ({
  page,
}) => {
  // Two strokes over the same stretch of canvas, the second offset along it.
  // Each composites into the layer as it ends, so the second pass darkens what
  // the first laid down — but it must be bitten in the same places.
  const probe = await openProbe(page)
  await paint(page, band(0), PAPER)
  const once = read(await probe.screenshot())
  await paint(page, band(1.5), PAPER)
  const twice = read(await probe.screenshot())

  const y = SIZE / 2
  const first = row(once, y, 20, 76)
  const second = row(twice, y, 20, 76)
  // Shallower than one pass, and rightly so: the second pass fills some of the
  // tooth the first left empty. What matters is that it is still there.
  expect(spread(second)).toBeGreaterThan(10)
  // The second pass is composited over the first, so the overlap is darker
  // than either alone — but the same pixels are the bitten ones. Grain that
  // travelled with the dabs would put its low points somewhere else, and the
  // two patterns would be unrelated.
  expect(correlation(first, second)).toBeGreaterThan(0.9)
})

test("grain thins a mark, and no grain leaves it flat", async ({ page }) => {
  const probe = await openProbe(page)
  await paint(page, band(0), SMOOTH)
  const smooth = read(await probe.screenshot())

  await openProbe(page)
  await paint(page, band(0), PAPER)
  const papered = read(await probe.screenshot())

  const y = SIZE / 2
  // A smooth surface takes the ink whole: the middle of the band is flat.
  expect(spread(row(smooth, y, 20, 76))).toBeLessThanOrEqual(2)
  expect(spread(row(papered, y, 20, 76))).toBeGreaterThan(20)
})

test("a tip texture rotates and scales with the stamp", async ({ page }) => {
  // One long, narrow tip, stamped twice: once lying along x, once turned a
  // quarter turn. Stamp-space sampling means the mark turns with it, so the
  // ink that was wide and short becomes narrow and tall.
  const extent = async (angle: number) => {
    const probe = await openProbe(page)
    await paint(
      page,
      [
        {
          x: SIZE / 2,
          y: SIZE / 2,
          radius: 30,
          opacity: 1,
          roundness: 0.25,
          angle,
        },
      ],
      { tip: "graphite", grain: null, scale: 1, depth: 0 }
    )
    const image = read(await probe.screenshot())
    const inked = (x: number, y: number) => image.at(x, y) > 60
    let width = 0
    let height = 0
    for (let i = 0; i < SIZE; i++) {
      if (inked(i, SIZE / 2)) width++
      if (inked(SIZE / 2, i)) height++
    }
    return { width, height }
  }

  const flat = await extent(0)
  const turned = await extent(0.25)
  expect(flat.width).toBeGreaterThan(flat.height * 2)
  // A quarter turn swaps the two, which is the whole claim.
  expect(turned.height).toBeGreaterThan(turned.width * 2)
  expect(turned.height).toBeCloseTo(flat.width, -0.5)
})

test("the dynamics graph drives how hard the paper bites", async ({ page }) => {
  // Through a pen, because the claim is about the graph: a modulator onto
  // grainDepth has to reach the dab, and only a stroke exercises that path.
  const strokeAt = async (pressure: number) => {
    await page.goto("http://127.0.0.1:3101/tests/harness/")
    await page.waitForFunction(() => !!window.engine)
    await page.evaluate(
      async ([width, height]) => {
        await window.engine.dispatch({
          type: "resize",
          width,
          height,
          devicePixelRatio: 1,
        })
        await window.engine.dispatch({ type: "initialize" })
        await window.engine.dispatch({ type: "setStabilization", strength: 0 })
        await window.engine.dispatch({
          type: "setBrush",
          radius: 10,
          grain: { textureId: "paper", scale: 1, depth: 1 },
          dynamics: [
            // Heavier pressure flattens the tooth of the paper, so depth
            // falls as force rises: the mapping runs from full grain to none.
            {
              source: "pressure",
              target: "grainDepth",
              range: [1, 0],
              mix: "replace",
            },
          ],
        })
      },
      [160, 80]
    )
    await page.evaluate(async (force) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (type: string, x: number) =>
        canvas.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            pointerType: "pen",
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: type === "pointerup" ? 0 : 1,
            clientX: bounds.left + x,
            clientY: bounds.top + 40,
            pressure: force,
          })
        )
      send("pointerdown", 20)
      for (let x = 24; x <= 140; x += 4) send("pointerrawupdate", x)
      send("pointerup", 140)
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      )
    }, pressure)
    return page.evaluate(async () => {
      const pixels = await window.engine.readPixels()
      const values: number[] = []
      for (let x = 40; x < 120; x++)
        values.push(pixels.data[(40 * pixels.width + x) * 4])
      return values
    })
  }

  // Pressure is the only thing that differs, and it reaches nothing but the
  // grain: a light touch skims the tooth and breaks up, a hard one presses
  // through it. Both marks are equally wide and equally opaque.
  const light = await strokeAt(0.02)
  const hard = await strokeAt(1)
  const range = (values: number[]) => Math.max(...values) - Math.min(...values)
  expect(range(light)).toBeGreaterThan(20)
  expect(range(hard)).toBeLessThan(4)
})

test("golden: a textured stroke, and a second pass over the same area", async ({
  page,
}) => {
  const probe = await openProbe(page)
  const graphite = { tip: "graphite", grain: "paper", scale: 1, depth: 0.8 }
  const diagonal = (offset: number): Dab[] =>
    Array.from({ length: 40 }, (_, i) => ({
      x: 14 + i * 1.7 + offset,
      y: 14 + i * 1.7 - offset,
      radius: 8,
      opacity: 0.5,
    }))

  await paint(page, diagonal(0), graphite)
  expect(await probe.screenshot()).toMatchSnapshot("textured-stroke.png", {
    maxDiffPixelRatio: 0.01,
  })

  // A second stroke back across the first. The grain in the overlap belongs
  // to the paper, so it lines up with the pass underneath instead of doubling
  // into a moiré of two offset copies.
  await paint(page, diagonal(6), graphite)
  expect(await probe.screenshot()).toMatchSnapshot("textured-overlap.png", {
    maxDiffPixelRatio: 0.01,
  })
})
