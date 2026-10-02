import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"
import type { SceneCommand, VectorObject } from "../../engine"
import {
  applyMatrix,
  type CanvasView,
  docToScreen,
} from "../../engine/view/view-transform"

/**
 * Compositing in target space (sharp-zoom 01): the canvas is composited at
 * the screen's resolution through the view, rather than flattened at the
 * document's and magnified. Nothing an artist sees may change for it, so
 * every stack here is held to the document it exports: wherever the art is
 * flat, the pixel on screen is the pixel in the file, at any zoom, rotation
 * and flip — through blend modes, masks, clipping and groups, and with the
 * caches rebuilt each time the view moves.
 */

const WIDTH = 200
const HEIGHT = 120
const SIZE = { width: WIDTH, height: HEIGHT }

type Image = { width: number; height: number; data: Uint8Array | number[] }

async function openCanvas(page: Page): Promise<{ x: number; y: number }> {
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
    },
    [WIDTH, HEIGHT] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function frames(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

/** The document as it exports: composited at its own size, unviewed. */
async function exported(page: Page): Promise<Image> {
  await frames(page)
  return page.evaluate(async () => {
    const read = await window.engine.readPixels()
    return {
      width: read.width,
      height: read.height,
      data: Array.from(read.data),
    }
  })
}

/** What the artist sees: the presented canvas. */
async function presented(page: Page): Promise<Image> {
  await frames(page)
  return PNG.sync.read(await page.locator("canvas").screenshot())
}

function at(image: Image, x: number, y: number): number[] {
  const offset = (y * image.width + x) * 4
  return Array.from(image.data.slice(offset, offset + 4))
}

/** No channel of the 3×3 around a pixel differs from it: flat art there. */
function flat(image: Image, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x > image.width - 2 || y > image.height - 2)
    return false
  const centre = at(image, x, y)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const other = at(image, x + dx, y + dy)
      if (other.some((value, channel) => Math.abs(value - centre[channel]) > 1))
        return false
    }
  return true
}

/**
 * Every flat document pixel on a grid, against the screen pixel its centre
 * lands in. Answers how many were compared and the ones that differ.
 */
async function compare(page: Page) {
  const document = await exported(page)
  const screen = await presented(page)
  const view = await page.evaluate(
    () => window.engine.getSnapshot().view as CanvasView
  )
  const matrix = docToScreen(view, SIZE, {
    width: screen.width,
    height: screen.height,
  })
  const mismatches: string[] = []
  let compared = 0
  for (let y = 1; y < HEIGHT - 1; y += 3)
    for (let x = 1; x < WIDTH - 1; x += 3) {
      if (!flat(document, x, y)) continue
      const point = applyMatrix(matrix, x + 0.5, y + 0.5)
      const sx = Math.floor(point.x)
      const sy = Math.floor(point.y)
      if (sx < 0 || sy < 0 || sx >= screen.width || sy >= screen.height)
        continue
      compared++
      const want = at(document, x, y)
      const got = at(screen, sx, sy)
      if (got.some((value, channel) => Math.abs(value - want[channel]) > 2))
        mismatches.push(
          `doc ${x},${y} -> screen ${sx},${sy}: ${got} vs ${want}`
        )
    }
  return { compared, mismatches }
}

const VIEWS: { name: string; commands: object[] }[] = [
  { name: "identity", commands: [] },
  {
    name: "zoomed 4x",
    commands: [{ type: "zoomView", factor: 4, anchor: { x: 100, y: 60 } }],
  },
  {
    name: "zoomed 2.5x off-centre",
    commands: [
      { type: "zoomView", factor: 2.5, anchor: { x: 63, y: 41 } },
      { type: "panView", dx: 7.3, dy: -3.6 },
    ],
  },
  {
    name: "rotated",
    commands: [{ type: "rotateView", radians: 0.5, absolute: true }],
  },
  {
    name: "flipped and zoomed out",
    commands: [{ type: "flipView" }, { type: "zoomView", factor: 0.7 }],
  },
]

/** Holds the stack to its export in every view, the caches rebuilt each time. */
async function holdsInEveryView(page: Page) {
  for (const view of VIEWS) {
    await page.evaluate(async (commands) => {
      await window.engine.dispatch({ type: "resetView" })
      for (const command of commands)
        await window.engine.dispatch(
          command as Parameters<typeof window.engine.dispatch>[0]
        )
    }, view.commands)
    const { compared, mismatches } = await compare(page)
    expect(compared, view.name).toBeGreaterThan(100)
    expect(mismatches, view.name).toEqual([])
  }
}

function rect(
  id: string,
  box: { x: number; y: number; width: number; height: number },
  color: string,
  opacity = 1
): VectorObject {
  return {
    id,
    geometry: { kind: "rect", ...box },
    transform: [1, 0, 0, 1, 0, 0],
    style: { fill: { color, opacity, rule: "nonzero" }, stroke: null },
  }
}

async function shapesLayer(page: Page, objects: VectorObject[]) {
  return page.evaluate(async (objects) => {
    await window.engine.dispatch({ type: "addVectorLayer" })
    const id = window.engine.getSnapshot().activeLayerId
    const commands: SceneCommand[] = objects.map((object) => ({
      type: "add",
      object,
    }))
    await window.engine.dispatch({ type: "editVectorLayer", id, commands })
    return id
  }, objects)
}

async function setLayer(page: Page, id: string, patch: object) {
  await page.evaluate(
    ([id, patch]) =>
      window.engine.dispatch({
        type: "setLayer",
        id,
        ...(patch as object),
      } as Parameters<typeof window.engine.dispatch>[0]),
    [id, patch] as const
  )
}

/** Drags the pen across the canvas at the identity view. */
async function drag(
  page: Page,
  origin: { x: number; y: number },
  from: readonly [number, number],
  to: readonly [number, number]
) {
  await page.mouse.move(origin.x + from[0], origin.y + from[1])
  await page.mouse.down()
  await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 20 })
  await page.mouse.up()
}

test("blend modes above and below the active layer composite as they export", async ({
  page,
}) => {
  await openCanvas(page)
  const base = await shapesLayer(page, [
    rect("a", { x: 10, y: 10, width: 120, height: 90 }, "#3aa84a"),
  ])
  const multiply = await shapesLayer(page, [
    rect("b", { x: 60, y: 30, width: 120, height: 70 }, "#d0402a", 0.8),
  ])
  await setLayer(page, multiply, { blend: "multiply" })
  const screen = await shapesLayer(page, [
    rect("c", { x: 30, y: 50, width: 60, height: 60 }, "#2a6ad0", 0.6),
  ])
  await setLayer(page, screen, { blend: "screen", opacity: 0.7 })
  // On top: everything below is one cache.
  await holdsInEveryView(page)
  // In the middle, under a blend mode that reads it live.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    base
  )
  await holdsInEveryView(page)
})

test("a mask and a clipped layer composite as they export", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await shapesLayer(page, [
    rect("a", { x: 20, y: 20, width: 100, height: 80 }, "#3aa84a"),
  ])
  const clipped = await shapesLayer(page, [
    rect("b", { x: 60, y: 10, width: 130, height: 100 }, "#d0402a"),
  ])
  await setLayer(page, clipped, { clip: true })
  const masked = await shapesLayer(page, [
    rect("c", { x: 5, y: 40, width: 190, height: 40 }, "#2a6ad0", 0.9),
  ])
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "setBrush", radius: 10 })
    await window.engine.dispatch({ type: "addMask", id })
    await window.engine.dispatch({ type: "selectMask", id })
  }, masked)
  await drag(page, origin, [20, 60], [180, 60])
  await holdsInEveryView(page)
  // With the clipped layer active, the clip is drawn live.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    clipped
  )
  await holdsInEveryView(page)
})

test("a group with a blend mode composites as it exports, from outside and inside", async ({
  page,
}) => {
  await openCanvas(page)
  await shapesLayer(page, [
    rect("a", { x: 0, y: 0, width: 200, height: 60 }, "#e0c040"),
  ])
  const inner = await shapesLayer(page, [
    rect("b", { x: 30, y: 20, width: 80, height: 80 }, "#2a6ad0"),
  ])
  const top = await shapesLayer(page, [
    rect("c", { x: 80, y: 40, width: 100, height: 60 }, "#d0402a", 0.7),
  ])
  await setLayer(page, top, { blend: "overlay" })
  const group = await page.evaluate(
    async (ids) => {
      await window.engine.dispatch({ type: "addGroup", ids })
      return window.engine.getSnapshot().activeLayerId
    },
    [inner, top]
  )
  await setLayer(page, group, { blend: "multiply", opacity: 0.85 })
  await shapesLayer(page, [
    rect("d", { x: 150, y: 5, width: 40, height: 110 }, "#8040c0", 0.5),
  ])
  await holdsInEveryView(page)
  // Active inside the group: the stack is drawn in stages.
  await page.evaluate(
    (id) => window.engine.dispatch({ type: "selectLayer", id }),
    inner
  )
  await holdsInEveryView(page)
})

/** Pixels that differ by more than a rounding step between two images. */
function differing(a: Image, b: Image): number {
  let count = 0
  for (let index = 0; index < a.data.length; index += 4)
    for (let channel = 0; channel < 3; channel++)
      if (Math.abs(a.data[index + channel] - b.data[index + channel]) > 2) {
        count++
        break
      }
  return count
}

test("the stroke in flight shows on a zoomed, rotated view as it lands", async ({
  page,
}) => {
  const origin = await openCanvas(page)
  await shapesLayer(page, [
    rect("a", { x: 10, y: 10, width: 180, height: 100 }, "#e0c040"),
  ])
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "addLayer" })
    await window.engine.dispatch({ type: "setBrush", radius: 6 })
    await window.engine.dispatch({ type: "setColor", hex: "#2a6ad0" })
    await window.engine.dispatch({ type: "zoomView", factor: 3 })
    await window.engine.dispatch({ type: "rotateView", radians: 0.3 })
  })
  await page.mouse.move(origin.x + 40, origin.y + 40)
  await page.mouse.down()
  await page.mouse.move(origin.x + 160, origin.y + 80, { steps: 20 })
  // At rest under the pen, so the mark in flight has caught up with it.
  await page.waitForTimeout(150)
  await page.mouse.move(origin.x + 160, origin.y + 80)
  await page.waitForTimeout(150)
  const inFlight = await presented(page)
  await page.mouse.up()
  await page.waitForFunction(() => window.engine.historyUsage().steps > 2)
  const landed = await presented(page)
  expect(differing(inFlight, landed)).toBeLessThan(WIDTH * HEIGHT * 0.01)
  const { mismatches } = await compare(page)
  expect(mismatches).toEqual([])
})

test("a filter previews on a zoomed view as it applies", async ({ page }) => {
  await openCanvas(page)
  const id = await shapesLayer(page, [
    rect("a", { x: 20, y: 20, width: 160, height: 80 }, "#3aa84a"),
  ])
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "rasteriseLayer", id })
    await window.engine.dispatch({ type: "zoomView", factor: 2.5 })
    await window.engine.dispatch({ type: "beginFilter", id, kind: "hsl" })
    await window.engine.dispatch({
      type: "previewFilter",
      filter: { kind: "hsl", hue: 120, saturation: 0, lightness: 0 },
    })
  }, id)
  const preview = await presented(page)
  await page.evaluate(() => window.engine.dispatch({ type: "applyFilter" }))
  const applied = await presented(page)
  expect(differing(preview, applied)).toBe(0)
  const { mismatches } = await compare(page)
  expect(mismatches).toEqual([])
})

test("the selection's marching ants follow a zoomed, rotated view", async ({
  page,
}) => {
  await openCanvas(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "selectShape",
      shape: "rect",
      x: 60,
      y: 30,
      width: 80,
      height: 60,
    })
    await window.engine.dispatch({ type: "zoomView", factor: 2 })
    await window.engine.dispatch({ type: "rotateView", radians: 0.4 })
  })
  const screen = await presented(page)
  const view = await page.evaluate(
    () => window.engine.getSnapshot().view as CanvasView
  )
  const matrix = docToScreen(view, SIZE, screen)
  // Ants mark the selection's edge and nothing inside or far outside it.
  const edged = (x: number, y: number) => {
    const point = applyMatrix(matrix, x, y)
    const px = Math.round(point.x)
    const py = Math.round(point.y)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const [r, g, b] = at(screen, px + dx, py + dy)
        if (r !== g || g !== b || r < 250) return true
      }
    return false
  }
  for (const [x, y] of [
    [100, 30],
    [100, 90],
    [60, 60],
    [140, 60],
  ])
    expect(edged(x, y), `edge at ${x},${y}`).toBe(true)
  expect(edged(100, 60)).toBe(false)
})
