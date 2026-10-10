import { expect, test, type Locator, type Page } from "@playwright/test"
import { PNG } from "pngjs"

import type { Brush } from "../../engine/brush/brush"
import { WET_BRUSHES } from "../../engine/brush/presets"

/**
 * The built-in wet brushes (live brushes 08).
 *
 * Two seams. The library panel, for what an artist does with them: finds the
 * four on the shelf, opens one in the editor, copies one, and blends with one
 * picked from the shelf. And the engine's command seam, for the one claim
 * that needs exact pixels: the blender lays nothing.
 */

const NAMES = ["Oil round", "Oil flat", "Blender", "Dry bristle"]

function library(page: Page) {
  return page.getByTestId("brush-library")
}

function editor(page: Page) {
  return page.getByRole("region", { name: "Brush editor" })
}

const paintWith = (page: Page, name: string) =>
  library(page).getByRole("button", { name: `Paint with ${name}`, exact: true })

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

async function openLibrary(page: Page) {
  // By attribute: reopened over a docked editor, the trigger may be outside
  // the accessibility tree a role query walks.
  await page.locator('button[aria-label^="Choose brush:"]').click()
  await expect(library(page)).toBeVisible()
}

test("the library ships a set of four wet brushes, each with a preview stroke", async ({
  page,
}) => {
  await openStudio(page)
  await openLibrary(page)
  await expect(
    library(page).getByRole("heading", { name: "Wet", exact: true })
  ).toBeVisible()
  expect(WET_BRUSHES.map((brush) => brush.name)).toEqual(NAMES)
  for (const brush of WET_BRUSHES) {
    const row = library(page).getByTestId(`brush-${brush.id}`)
    await expect(
      row.getByRole("button", { name: `Paint with ${brush.name}`, exact: true })
    ).toBeVisible()
    // A stroke, not an empty box: the blender lays nothing, and is drawn by
    // what it would drag.
    await expect
      .poll(
        () =>
          row.getByTestId("brush-preview").evaluate((canvas) => {
            const { width, height } = canvas as HTMLCanvasElement
            const { data } = (canvas as HTMLCanvasElement)
              .getContext("2d")!
              .getImageData(0, 0, width, height)
            let inked = 0
            for (let i = 3; i < data.length; i += 4) if (data[i] > 32) inked++
            return inked
          }),
        // A page of thumbnails is drawn after the panel opens, and slowly
        // on a machine rasterizing several studios at once.
        { timeout: 20_000 }
      )
      .toBeGreaterThan(20)
    // Shipped, so there is nothing to delete.
    await expect(
      row.getByRole("button", { name: `Delete ${brush.name}`, exact: true })
    ).toHaveCount(0)
  }
})

test("search finds each wet brush by name", async ({ page }) => {
  await openStudio(page)
  await openLibrary(page)
  const search = library(page).getByLabel("Search brushes")
  for (const name of NAMES) {
    await search.fill(name.toLowerCase())
    await expect(paintWith(page, name)).toBeVisible()
    await expect(paintWith(page, "Pencil")).toHaveCount(0)
  }
  await search.fill("oil")
  await expect(paintWith(page, "Oil round")).toBeVisible()
  await expect(paintWith(page, "Oil flat")).toBeVisible()
  await expect(paintWith(page, "Blender")).toHaveCount(0)
})

for (const name of NAMES)
  test(`${name} opens in the editor wet, and is copied into the artist's own brushes`, async ({
    page,
  }) => {
    await openStudio(page)
    await openLibrary(page)
    await paintWith(page, name).click()
    // Choosing a brush puts it in the hand and closes the library.
    await expect(library(page)).toHaveCount(0)
    await page.getByRole("button", { name: "Brush editor" }).click()
    await expect(editor(page)).toContainText(name)
    await editor(page).getByRole("tab", { name: "Rendering" }).click()
    await expect(
      editor(page).getByRole("switch", { name: "Wet" })
    ).toHaveAttribute("aria-checked", "true")
    await expect(
      editor(page).getByRole("slider", { name: "Pickup", exact: true })
    ).toBeVisible()
    await expect(editor(page).getByText("No changes")).toBeVisible()

    await page.keyboard.press("Escape")
    await openLibrary(page)
    await library(page)
      .getByRole("button", { name: `Duplicate ${name}`, exact: true })
      .click()
    // The copy is the artist's: it can be picked up and, unlike the brush it
    // came from, deleted.
    await expect(paintWith(page, `${name} copy`)).toBeVisible()
    await expect(
      library(page).getByRole("button", {
        name: `Delete ${name} copy`,
        exact: true,
      })
    ).toBeVisible()
    await paintWith(page, `${name} copy`).click()
    await page.getByRole("button", { name: "Brush editor" }).click()
    await expect(editor(page)).toContainText(`${name} copy`)
    await editor(page).getByRole("tab", { name: "Rendering" }).click()
    await expect(
      editor(page).getByRole("switch", { name: "Wet" })
    ).toHaveAttribute("aria-checked", "true")
  })

for (const name of NAMES.filter((name) => name !== "Blender"))
  test(`${name} picked from the library paints with its shipped tip`, async ({
    page,
  }) => {
    await openStudio(page)
    await openLibrary(page)
    await paintWith(page, name).click()
    await expect(library(page)).toHaveCount(0)
    const canvas = page.locator('canvas[aria-label="Drawing canvas"]')
    const bounds = (await canvas.boundingBox())!
    const before = await canvas.screenshot()
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(bounds.x + bounds.width * 0.5, y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + bounds.width * 0.5 + 180, y + 30, {
      steps: 25,
    })
    await page.mouse.up()
    await expect(page.locator('button[aria-label="Undo"]')).toBeEnabled()
    // The tip and the canvas grain are fetched when the brush is picked up;
    // the mark is there once they have arrived.
    await expect(async () => {
      expect(await canvas.screenshot()).not.toEqual(before)
    }).toPass()
  })

type Box = { x: number; y: number; width: number; height: number }

/** The largest difference in any channel between two pictures, over a box. */
function difference(a: Buffer, b: Buffer, box: Box): number {
  const before = PNG.sync.read(a)
  const after = PNG.sync.read(b)
  let most = 0
  for (let y = box.y; y < box.y + box.height; y++)
    for (let x = box.x; x < box.x + box.width; x++)
      for (let c = 0; c < 3; c++) {
        const i = (y * before.width + x) * 4 + c
        most = Math.max(most, Math.abs(before.data[i] - after.data[i]))
      }
  return most
}

test("a wet brush picked from the library drags the paint it crosses", async ({
  page,
}) => {
  await openStudio(page)
  const canvas = page.locator('canvas[aria-label="Drawing canvas"]')
  const bounds = (await canvas.boundingBox())!
  // Where the work is, clear of the panels at the canvas's edges.
  const centre = {
    x: Math.round(bounds.width * 0.6),
    y: Math.round(bounds.height * 0.5),
  }
  const drag = async (
    from: { x: number; y: number },
    to: { x: number; y: number }
  ) => {
    await page.mouse.move(bounds.x + from.x, bounds.y + from.y)
    await page.mouse.down()
    await page.mouse.move(bounds.x + to.x, bounds.y + to.y, { steps: 30 })
    await page.mouse.up()
  }
  /** The canvas with the pointer parked away from everything compared. */
  const shot = async (settle: Locator | null = null) => {
    await page.mouse.move(bounds.x + centre.x - 200, bounds.y + centre.y + 150)
    if (settle) await expect(settle).toBeEnabled()
    await page.waitForTimeout(300)
    return canvas.screenshot()
  }
  const undo = page.locator('button[aria-label="Undo"]')
  /** Over bare canvas, above the bar. */
  const bare: Box = {
    x: centre.x - 70,
    y: centre.y - 95,
    width: 140,
    height: 50,
  }
  /** Below the bar, on the way the blender is dragged out of it. */
  const trail: Box = {
    x: centre.x - 8,
    y: centre.y + 25,
    width: 16,
    height: 25,
  }

  // A bar of dry paint to blend.
  await openLibrary(page)
  await paintWith(page, "Marker").click()
  await drag(
    { x: centre.x - 80, y: centre.y },
    { x: centre.x + 80, y: centre.y }
  )
  const painted = await shot(undo)

  await openLibrary(page)
  await paintWith(page, "Blender").click()
  await expect(library(page)).toHaveCount(0)

  // Across bare canvas the blender has nothing to move and lays nothing.
  await drag(
    { x: centre.x - 50, y: centre.y - 70 },
    { x: centre.x + 50, y: centre.y - 70 }
  )
  expect(difference(painted, await shot(), bare)).toBeLessThanOrEqual(1)

  // Out of the bar it brings the bar's paint with it.
  await drag(centre, { x: centre.x, y: centre.y + 60 })
  await expect
    .poll(async () => difference(painted, await shot(), trail))
    .toBeGreaterThan(24)
})

/**
 * The engine's command seam, for what the screenshot above cannot say
 * exactly: not one pixel of an empty layer changes under the blender.
 */
test.describe("through the engine", () => {
  const WIDTH = 240
  const HEIGHT = 120
  const ROW = 60

  type Command = Parameters<typeof window.engine.dispatch>[0]

  /**
   * A brush as the studio hands it to the engine, less its tip and grain:
   * the harness has no shipped textures, so only the two brushes with a
   * procedural tip are drawn here. The bristle brushes are drawn in the
   * studio, above.
   */
  function inHand(brush: Brush): Command {
    return {
      type: "setBrush",
      radius: brush.shape.radius,
      feather: brush.shape.feather,
      roundness: brush.shape.roundness,
      angle: brush.shape.angle,
      spacing: brush.shape.spacing,
      opacity: brush.rendering.opacity,
      flow: brush.rendering.flow,
      accumulation: brush.rendering.accumulation,
      tipTextureId: null,
      grain: null,
      wet: brush.rendering.wet ?? null,
      dynamics: structuredClone(brush.dynamics),
    }
  }

  const named = (name: string) =>
    WET_BRUSHES.find((brush) => brush.name === name)!

  async function openCanvas(page: Page) {
    await page.goto("http://127.0.0.1:3101/tests/harness/")
    await page.waitForFunction(() => !!window.engine)
    await page.evaluate(
      async ([width, height]) => {
        window.remountEngine()
        await window.engine.dispatch({
          type: "resize",
          width,
          height,
          devicePixelRatio: 1,
        })
        await window.engine.dispatch({ type: "initialize" })
        const state = window.engine.getSnapshot()
        if (state.status !== "ready")
          throw new Error(state.error ?? state.status)
        await window.engine.dispatch({ type: "setStabilization", strength: 0 })
        await window.engine.dispatch({ type: "setColor", hex: "#d0202a" })
        await window.engine.dispatch({ type: "addLayer" })
      },
      [WIDTH, HEIGHT] as const
    )
    const box = (await page.locator("canvas").boundingBox())!
    return { x: box.x, y: box.y }
  }

  const dispatch = (page: Page, command: Command) =>
    page.evaluate((command) => window.engine.dispatch(command), command)

  async function pixels(page: Page) {
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    return page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data)
    )
  }

  const steps = (page: Page) =>
    page.evaluate(() => window.engine.historyUsage().steps)

  async function drag(
    page: Page,
    origin: { x: number; y: number },
    from: number,
    to: number
  ) {
    await page.mouse.move(origin.x + from, origin.y + ROW)
    await page.mouse.down()
    await page.mouse.move(origin.x + to, origin.y + ROW, { steps: 30 })
    await page.mouse.up()
  }

  async function stroke(
    page: Page,
    origin: { x: number; y: number },
    from: number,
    to: number
  ) {
    const before = await steps(page)
    await drag(page, origin, from, to)
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps > n,
      before
    )
  }

  const changed = (a: number[], b: number[], x: number) =>
    [0, 1, 2, 3].reduce((sum, c) => {
      const i = (ROW * WIDTH + x) * 4 + c
      return sum + Math.abs(a[i] - b[i])
    }, 0)

  test("the blender lays no colour on an empty layer", async ({ page }) => {
    const origin = await openCanvas(page)
    const empty = await pixels(page)
    const before = await steps(page)
    await dispatch(page, inHand(named("Blender")))
    await drag(page, origin, 40, 200)
    expect(await pixels(page)).toEqual(empty)
    expect(await steps(page)).toBe(before)
  })

  test("the blender drags paint out of what it crosses", async ({ page }) => {
    const origin = await openCanvas(page)
    await dispatch(page, { type: "setBrush", radius: 12, dynamics: [] })
    await stroke(page, origin, 40, 100)
    const painted = await pixels(page)
    await dispatch(page, { type: "setColor", hex: "#1040e0" })
    await dispatch(page, inHand(named("Blender")))
    await stroke(page, origin, 80, 180)
    const blended = await pixels(page)
    // Past the bar's end there is now paint, and it is the bar's red: the
    // blue in the hand never reaches the layer.
    expect(changed(blended, painted, 130)).toBeGreaterThan(30)
    for (let x = 0; x < WIDTH; x++) {
      const i = (ROW * WIDTH + x) * 4
      expect(blended[i + 2]).toBeLessThanOrEqual(painted[i + 2] + 1)
    }
  })

  test("the oil round lays the colour in the hand on an empty layer", async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const empty = await pixels(page)
    await dispatch(page, inHand(named("Oil round")))
    await stroke(page, origin, 40, 200)
    const laid = await pixels(page)
    for (const x of [80, 120, 160])
      expect(changed(laid, empty, x)).toBeGreaterThan(150)
  })
})
