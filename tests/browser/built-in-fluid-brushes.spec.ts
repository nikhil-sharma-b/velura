import { expect, test, type Page } from "@playwright/test"

import type { Brush } from "../../engine/brush/brush"
import { FLUID_BRUSHES } from "../../engine/brush/presets"

/**
 * The built-in fluid brushes (fluid brushes 12).
 *
 * Two seams, as for the wet ones. The library panel, for what an artist does
 * with them: finds the four on the shelf, opens one in the editor and copies
 * one. And the engine's command seam, for what the water brush does to
 * paint, which needs the simulation stepped by command and pixels read back.
 */

const NAMES = [
  "Watercolour wash",
  "Watercolour detail",
  "Ink wash",
  "Water brush",
]

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
  // One set is open at a time, on the brush in hand: open this one.
  const set = library(page).getByRole("button", { name: "Fluid", exact: true })
  if ((await set.getAttribute("aria-expanded")) !== "true") await set.click()
}

test("the library ships a set of four fluid brushes after the wet ones, each with a preview stroke", async ({
  page,
}) => {
  await openStudio(page)
  await openLibrary(page)
  expect(FLUID_BRUSHES.map((brush) => brush.name)).toEqual(NAMES)
  const heading = (name: string) =>
    library(page).getByRole("heading", { name, exact: true })
  await expect(heading("Fluid")).toBeVisible()
  // After the wet built-ins, and before the first of Krita's sets.
  const top = async (name: string) => (await heading(name).boundingBox())!.y
  expect(await top("Fluid")).toBeGreaterThan(await top("Wet"))
  expect(await top("Fluid")).toBeLessThan(await top("Sketch"))
  for (const brush of FLUID_BRUSHES) {
    const row = library(page).getByTestId(`brush-${brush.id}`)
    await expect(
      row.getByRole("button", { name: `Paint with ${brush.name}`, exact: true })
    ).toBeVisible()
    // A stroke, not an empty box: the water brush lays no pigment, and is
    // drawn by its water.
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

for (const name of NAMES)
  test(`${name} opens in the editor fluid, and is copied into the artist's own brushes`, async ({
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
      editor(page).getByRole("switch", { name: "Fluid" })
    ).toHaveAttribute("aria-checked", "true")
    // Ordinary brush data: its water is there to be moved.
    await expect(
      editor(page).getByRole("slider", { name: "Water", exact: true })
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
      editor(page).getByRole("switch", { name: "Fluid" })
    ).toHaveAttribute("aria-checked", "true")
  })

test("a fluid brush picked from the library lays wet paint", async ({
  page,
}) => {
  await openStudio(page)
  await openLibrary(page)
  await paintWith(page, "Watercolour wash").click()
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
  await expect(async () => {
    expect(await canvas.screenshot()).not.toEqual(before)
  }).toPass()
})

/**
 * The engine's command seam, with the simulation's clock stopped and stepped
 * by command: what the water brush does to paint, in pixels.
 */
test.describe("through the engine", () => {
  const WIDTH = 240
  const HEIGHT = 160
  const ROW = 80
  const BLUE = "#1040e0"

  type Command = Parameters<typeof window.engine.dispatch>[0]
  type Origin = { x: number; y: number }

  /**
   * A brush as the studio hands it to the engine. None of the four has a
   * textured tip or a grain, so this is the whole of each.
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
      wet: null,
      fluid: brush.rendering.fluid ?? null,
      dynamics: structuredClone(brush.dynamics),
    }
  }

  const named = (name: string) =>
    FLUID_BRUSHES.find((brush) => brush.name === name)!

  async function openCanvas(page: Page): Promise<Origin> {
    await page.goto(
      process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
    )
    await page.waitForFunction(() => !!window.engine)
    await page.evaluate(
      async ([width, height, colour]) => {
        window.remountEngine({ manualFluidClock: true })
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
        await window.engine.dispatch({ type: "setColor", hex: colour })
        await window.engine.dispatch({ type: "addLayer" })
      },
      [WIDTH, HEIGHT, BLUE] as const
    )
    const box = (await page.locator("canvas").boundingBox())!
    return { x: box.x, y: box.y }
  }

  const dispatch = (page: Page, command: Command) =>
    page.evaluate((command) => window.engine.dispatch(command), command)

  const frames = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )

  async function pixels(page: Page) {
    await frames(page)
    return page.evaluate(async () =>
      Array.from((await window.engine.readPixels()).data)
    )
  }

  /** How much paint a pixel shows: what has been taken out of white paper. */
  const darkness = (image: number[], x: number, y = ROW) => {
    const at = (y * WIDTH + x) * 4
    return 765 - image[at] - image[at + 1] - image[at + 2]
  }

  const isWet = (page: Page) =>
    page.evaluate(() => window.engine.getSnapshot().wet)

  async function drag(
    page: Page,
    origin: Origin,
    from: [number, number],
    to: [number, number]
  ) {
    await page.mouse.move(origin.x + from[0], origin.y + from[1])
    await page.mouse.down()
    await page.mouse.move(origin.x + to[0], origin.y + to[1], { steps: 30 })
    await page.mouse.up()
    // The last dabs are laid by the frame after the pen lifts.
    await frames(page)
  }

  const advance = (page: Page, steps: number) =>
    dispatch(page, { type: "advanceFluid", steps })

  /**
   * Runs the simulation on by so many steps, then dries what is still wet by
   * command: left to dry by itself a flooded wash is thousands of steps,
   * which is minutes where the GPU is software.
   */
  async function dried(page: Page, steps: number) {
    await advance(page, steps)
    await dispatch(page, { type: "dryNow" })
    await expect.poll(() => isWet(page)).toBe(false)
    // History reads the settled tiles back after the frame.
    await frames(page)
    return pixels(page)
  }

  /** A wash with no rim and no grain, so what moves it is the water brush. */
  const WASH: Command = {
    type: "setBrush",
    radius: 24,
    feather: 2,
    spacing: 0.1,
    flow: 0.3,
    fluid: { water: 0.5, drying: 0.3, bleed: 0.5, edge: 0, granulation: 0 },
    dynamics: [],
  }
  const BAR = { from: 60, to: 140 }

  test("the water brush lays no pigment: on bare paper it wets it and leaves no mark", async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    const empty = await pixels(page)
    await dispatch(page, inHand(named("Water brush")))
    await drag(page, origin, [60, ROW], [180, ROW])
    expect(await isWet(page)).toBe(true)
    expect(await pixels(page)).toEqual(empty)
    expect(await dried(page, 60)).toEqual(empty)
  })

  test("the water brush softens a wet edge", async ({ page }) => {
    // On CI's software GPU a flooded body is slow to step.
    test.slow()
    /** Past the bar's rounded end, where the wash laid nothing. */
    const BEYOND = BAR.to + 24 + 8
    /** A wet bar, with or without water laid across its end, dried. */
    const bar = async (water: boolean) => {
      const origin = await openCanvas(page)
      await dispatch(page, WASH)
      await drag(page, origin, [BAR.from, ROW], [BAR.to, ROW])
      await advance(page, 40)
      if (water) {
        await dispatch(page, inHand(named("Water brush")))
        await drag(
          page,
          origin,
          [BAR.to + 14, ROW - 30],
          [BAR.to + 14, ROW + 30]
        )
      }
      // The paint runs out for as long as water stands on the damp paper.
      return dried(page, 900)
    }
    const plain = await bar(false)
    const softened = await bar(true)
    // By itself the wash keeps the edge the brush gave it.
    expect(darkness(plain, BEYOND)).toBeLessThanOrEqual(3)
    // Given damp paper to run into, its paint goes on past that edge, and
    // thins as it goes.
    expect(darkness(softened, BEYOND)).toBeGreaterThan(12)
    expect(darkness(softened, BEYOND + 8)).toBeLessThan(
      darkness(softened, BEYOND)
    )
  })

  test("a tap of the water brush starts a bloom in a wet wash", async ({
    page,
  }) => {
    // On CI's software GPU a flooded body is slow to step.
    test.slow()
    const MIDDLE = (BAR.from + BAR.to) / 2
    /** The drop the brush lays at the pressure a mouse has. */
    const DROP = 15
    /** A wide wash part dried, with or without a drop let into it. */
    const wash = async (drop: boolean) => {
      const origin = await openCanvas(page)
      await dispatch(page, { ...WASH, radius: 60 } as Command)
      await drag(page, origin, [BAR.from, ROW], [BAR.to, ROW])
      // Nearly dry: little water stands on it, and its pigment is still in
      // what does.
      await advance(page, 1100)
      if (drop) {
        await dispatch(page, inHand(named("Water brush")))
        await page.mouse.move(origin.x + MIDDLE, origin.y + ROW)
        await page.mouse.down()
        await page.mouse.up()
        await frames(page)
      }
      return dried(page, 400)
    }
    const plain = await wash(false)
    const bloomed = await wash(true)
    // Where the drop fell the wash is lighter than it would have dried.
    expect(darkness(bloomed, MIDDLE)).toBeLessThan(
      darkness(plain, MIDDLE) * 0.75
    )
    // And the pigment it pushed out lies about it, darker than the wash was.
    let most = 0
    // A drop this size runs a long way: the wash is lighter for some
    // thirty pixels out from it.
    for (let r = DROP; r <= DROP + 44; r++)
      most = Math.max(
        most,
        darkness(bloomed, MIDDLE + r) - darkness(plain, MIDDLE + r),
        darkness(bloomed, MIDDLE, ROW - r) - darkness(plain, MIDDLE, ROW - r)
      )
    expect(most).toBeGreaterThan(darkness(plain, MIDDLE) * 0.1)
  })

  for (const name of NAMES.filter((name) => name !== "Water brush"))
    test(`${name} keeps the edge the brush gave it`, async ({ page }) => {
      const origin = await openCanvas(page)
      await dispatch(page, inHand(named(name)))
      await drag(page, origin, [70, ROW], [170, ROW])
      /** How many pixels of the middle column show paint. */
      const width = (image: number[]) => {
        let count = 0
        for (let y = 0; y < HEIGHT; y++)
          if (darkness(image, 120, y) > 12) count++
        return count
      }
      const laid = width(await pixels(page))
      expect(laid).toBeGreaterThan(4)
      // Long enough for a bloom to have run: a flooded stroke is cells wider
      // well inside this.
      const after = width(await dried(page, 300))
      // To a cell either side: thin paint runs out to the rim of the damp
      // paper its own dabs left, and no further.
      expect(Math.abs(after - laid)).toBeLessThanOrEqual(4)
    })
})
