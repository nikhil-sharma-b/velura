import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Raster magnification (sharp-zoom 03): an artist chooses whether a raster
 * layer magnified past 200% shows its pixels as hard-edged squares, the
 * default, or is filtered smooth as it always was. Below the threshold both
 * filter. A hard vertical edge is magnified and the screen row across it is
 * counted for pixels that are neither side's colour.
 */

const WIDTH = 200
const HEIGHT = 120
// The edge, in document pixels, and the anchor every zoom is held about, so
// the edge stays put on screen.
const EDGE = 100
const ROW = 60

async function openCanvas(page: Page) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, edge]) => {
      const engine = window.engine
      await engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await engine.dispatch({ type: "initialize" })
      await engine.dispatch({ type: "addVectorLayer" })
      const id = engine.getSnapshot().activeLayerId
      await engine.dispatch({
        type: "editVectorLayer",
        id,
        commands: [
          {
            type: "add",
            object: {
              id: "right",
              geometry: {
                kind: "rect",
                x: edge,
                y: 0,
                width: width - edge,
                height,
              },
              transform: [1, 0, 0, 1, 0, 0],
              style: {
                fill: { color: "#d02020", opacity: 1, rule: "nonzero" },
                stroke: null,
              },
            },
          },
        ],
      })
      // Pixels now, with the edge between two whole columns of them.
      await engine.dispatch({ type: "rasteriseLayer", id })
    },
    [WIDTH, HEIGHT, EDGE] as const
  )
}

async function view(page: Page, zoom: number, mode?: "pixels" | "smooth") {
  await page.evaluate(
    async ([zoom, mode, anchor]) => {
      if (mode)
        await window.engine.dispatch({ type: "setRasterMagnification", mode })
      await window.engine.dispatch({ type: "resetView" })
      await window.engine.dispatch({ type: "zoomView", factor: zoom, anchor })
    },
    [zoom, mode, { x: EDGE, y: ROW }] as const
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

/** Pixels in the row across the edge that are neither side's colour. */
async function between(page: Page): Promise<number> {
  const image = PNG.sync.read(await page.locator("canvas").screenshot())
  const y = Math.floor(image.height / 2)
  const red = (x: number) => image.data[(y * image.width + x) * 4]
  const green = (x: number) => image.data[(y * image.width + x) * 4 + 1]
  let count = 0
  for (let x = 1; x < image.width - 1; x++) {
    // White is 255 in green, the red side near 32: anything well between.
    if (green(x) > 60 && green(x) < 220 && red(x) > 150) count++
  }
  return count
}

test("pixels when zoomed in is the default, and hard-edged past 200%", async ({
  page,
}) => {
  await openCanvas(page)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().rasterMagnification)
  ).toBe("pixels")
  await view(page, 4)
  expect(await between(page)).toBe(0)
  await view(page, 1.5)
  expect(await between(page)).toBeGreaterThan(0)
})

test("smooth filters at every zoom", async ({ page }) => {
  await openCanvas(page)
  await view(page, 4, "smooth")
  expect(await between(page)).toBeGreaterThan(1)
  await view(page, 1.5, "smooth")
  expect(await between(page)).toBeGreaterThan(0)
})

test("switching back to pixels takes effect without moving the view", async ({
  page,
}) => {
  await openCanvas(page)
  await view(page, 4, "smooth")
  expect(await between(page)).toBeGreaterThan(1)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setRasterMagnification", mode: "pixels" })
  )
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  expect(await between(page)).toBe(0)
})

test("export ignores the preference", async ({ page }) => {
  await openCanvas(page)
  const read = () =>
    page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data)
    )
  await view(page, 4, "pixels")
  const pixels = await read()
  await view(page, 4, "smooth")
  expect(await read()).toEqual(pixels)
})

test("the choice is made in preferences and survives a reload", async ({
  page,
}) => {
  const openStudio = async () => {
    await page.goto("/")
    await expect(page.getByRole("main")).toHaveAttribute(
      "data-engine-status",
      "ready"
    )
  }
  const openPreferences = async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await page
      .getByRole("combobox", { name: "Search commands" })
      .fill("preferences")
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "Preferences" })
    await expect(dialog).toBeVisible()
    return dialog.getByRole("combobox", {
      name: "Raster layers when magnified",
    })
  }
  await openStudio()
  const setting = await openPreferences()
  await expect(setting).toHaveText("Pixels when zoomed in")
  await setting.click()
  await page.getByRole("option", { name: "Smooth" }).click()
  await expect(setting).toHaveText("Smooth")

  await openStudio()
  await expect(await openPreferences()).toHaveText("Smooth")
})

test("the threshold sits at 200%", async ({ page }) => {
  await openCanvas(page)
  await view(page, 2.2, "pixels")
  expect(await between(page)).toBe(0)
  await view(page, 1.8, "pixels")
  expect(await between(page)).toBeGreaterThan(0)
})

test("vector layers look the same in either mode", async ({ page }) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height]) => {
      const engine = window.engine
      await engine.dispatch({
        type: "resize",
        width,
        height,
        devicePixelRatio: 1,
      })
      await engine.dispatch({ type: "initialize" })
      await engine.dispatch({ type: "addVectorLayer" })
      const id = engine.getSnapshot().activeLayerId
      await engine.dispatch({
        type: "editVectorLayer",
        id,
        commands: [
          {
            type: "add",
            object: {
              id: "right",
              // Off the pixel grid, so its edge is antialiased on screen.
              geometry: { kind: "rect", x: 100.3, y: 0, width: 99.7, height },
              transform: [1, 0, 0, 1, 0, 0],
              style: {
                fill: { color: "#d02020", opacity: 1, rule: "nonzero" },
                stroke: null,
              },
            },
          },
        ],
      })
    },
    [WIDTH, HEIGHT] as const
  )
  await view(page, 4, "smooth")
  const smooth = PNG.sync.read(await page.locator("canvas").screenshot())
  await view(page, 4, "pixels")
  const pixels = PNG.sync.read(await page.locator("canvas").screenshot())
  expect(Buffer.compare(pixels.data, smooth.data)).toBe(0)
})
