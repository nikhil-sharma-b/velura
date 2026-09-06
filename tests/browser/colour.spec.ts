import { expect, test, type Page } from "@playwright/test"

const WIDTH = 200
const HEIGHT = 120

/** The engine seam, driven directly: does the chosen colour reach the pixels? */
test.describe("the ink the engine paints in", () => {
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
        await window.engine.dispatch({ type: "setBrush", radius: 10 })
      },
      [WIDTH, HEIGHT]
    )
    return (await page.locator("canvas").boundingBox())!
  }

  async function stroke(page: Page, origin: { x: number; y: number }) {
    await page.mouse.move(origin.x + 40, origin.y + 60)
    await page.mouse.down()
    await page.mouse.move(origin.x + 160, origin.y + 60, { steps: 20 })
    await page.mouse.up()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
  }

  test("a chosen hex is what lands on the canvas, and comes back as itself", async ({
    page,
  }) => {
    const origin = await openCanvas(page)
    await page.evaluate(() =>
      window.engine.dispatch({ type: "setColor", hex: "#c08a4d" })
    )
    expect(
      await page.evaluate(() => window.engine.getSnapshot().color.hex)
    ).toBe("#c08a4d")
    await stroke(page, origin)

    // Sampling the painted pixel back reports the same hex: the round trip
    // through linear light and the display transform loses nothing an artist
    // could name.
    const sampled = await page.evaluate(
      async () => (await window.engine.sampleColor(100, 60)).hex
    )
    expect(sampled).toBe("#c08a4d")
  })

  test("a hex that is not a colour is refused rather than painted", async ({
    page,
  }) => {
    await openCanvas(page)
    const before = await page.evaluate(
      () => window.engine.getSnapshot().color.hex
    )
    await expect(
      page.evaluate(() =>
        window.engine.dispatch({ type: "setColor", hex: "chartreuse" })
      )
    ).rejects.toThrow(/Not a colour/)
    expect(
      await page.evaluate(() => window.engine.getSnapshot().color.hex)
    ).toBe(before)
  })
})

/** The picker, in the studio the artist actually opens. */
test.describe("the colour picker", () => {
  async function openPicker(page: Page) {
    await page.goto("/")
    await expect(page.getByRole("main")).toHaveAttribute(
      "data-engine-status",
      "ready"
    )
    await page.getByRole("button", { name: "Colour", exact: true }).click()
    await expect(page.getByTestId("colour-panel")).toBeVisible()
  }

  const currentColour = (page: Page) =>
    page.getByTestId("current-colour").getAttribute("data-colour")

  test("does not cover the area being painted", async ({ page }) => {
    await openPicker(page)
    const canvas = (await page
      .getByRole("img", { name: "Drawing canvas" })
      .boundingBox())!
    const panel = (await page.getByTestId("colour-panel").boundingBox())!
    // The canvas is full-bleed, so the panel is necessarily over some of it.
    // What matters is that the middle of the canvas — where the work is — is
    // clear of it.
    const centre = {
      x: canvas.x + canvas.width / 2,
      y: canvas.y + canvas.height / 2,
    }
    expect(
      centre.x >= panel.x &&
        centre.x <= panel.x + panel.width &&
        centre.y >= panel.y &&
        centre.y <= panel.y + panel.height
    ).toBe(false)
  })

  test("hex typed in is hex shown back", async ({ page }) => {
    await openPicker(page)
    const hex = page.getByRole("textbox", { name: "Hex colour" })
    await hex.fill("#3d7ac2")
    await hex.press("Enter")
    expect(await currentColour(page)).toBe("#3d7ac2")
    await expect(hex).toHaveValue("#3d7ac2")
  })

  test("the sliders are perceptual: lightness moves lightness and leaves hue alone", async ({
    page,
  }) => {
    await openPicker(page)
    const hex = page.getByRole("textbox", { name: "Hex colour" })
    await hex.fill("#3d7ac2")
    await hex.press("Enter")

    const hue = page.getByRole("slider", { name: "Hue" })
    const lightness = page.getByRole("slider", { name: "Lightness" })
    const hueBefore = await hue.getAttribute("aria-valuenow")

    await lightness.focus()
    for (let press = 0; press < 20; press++) await lightness.press("ArrowRight")

    // Lighter, and the same hue: an HSV picker would have swung the hue here.
    expect(await hue.getAttribute("aria-valuenow")).toBe(hueBefore)
    const lighter = (await currentColour(page))!
    expect(lighter).not.toBe("#3d7ac2")
    const luminance = (value: string) =>
      Number.parseInt(value.slice(1, 3), 16) +
      Number.parseInt(value.slice(3, 5), 16) +
      Number.parseInt(value.slice(5, 7), 16)
    expect(luminance(lighter)).toBeGreaterThan(luminance("#3d7ac2"))
  })

  test("recently used colours collect and survive a reload", async ({
    page,
  }) => {
    await openPicker(page)
    const hex = page.getByRole("textbox", { name: "Hex colour" })
    await hex.fill("#3d7ac2")
    await hex.press("Enter")
    await hex.fill("#c08a4d")
    await hex.press("Enter")
    await expect(
      page.getByTestId("recent-colours").getByRole("button")
    ).toHaveCount(2)

    await page.reload()
    await page.getByRole("button", { name: "Colour", exact: true }).click()
    const recent = page.getByTestId("recent-colours").getByRole("button")
    await expect(recent).toHaveCount(2)
    // Newest first.
    await expect(recent.first()).toHaveAttribute("title", "#c08a4d")
  })

  test("a palette is named, saved, trimmed and kept across sessions", async ({
    page,
  }) => {
    await openPicker(page)
    const hex = page.getByRole("textbox", { name: "Hex colour" })
    await hex.fill("#3d7ac2")
    await hex.press("Enter")
    await page.getByRole("button", { name: "New palette" }).click()

    // A new palette opens waiting for its name, so naming it is the first
    // thing that happens rather than a rename to be discovered later.
    const name = page.getByRole("textbox", { name: "Palette name" })
    await expect(name).toBeFocused()
    await name.fill("Autumn study")
    await name.press("Enter")

    const palette = page.getByTestId("palette-Autumn study")
    await expect(palette).toBeVisible()
    await hex.fill("#c08a4d")
    await hex.press("Enter")
    await page
      .getByRole("button", {
        name: "Add the current colour to Autumn study",
      })
      .click()
    await expect(palette.getByTitle("#3d7ac2")).toBeVisible()
    await expect(palette.getByTitle("#c08a4d")).toBeVisible()

    // Clicking a saved swatch makes it the colour in the hand.
    await palette.getByTitle("#3d7ac2").click()
    expect(await currentColour(page)).toBe("#3d7ac2")

    // The remove control belongs to the swatch and appears when it is reached
    // for, so the pointer has to be on the swatch first.
    await palette.getByTitle("#c08a4d").hover()
    await palette.getByRole("button", { name: "Remove #c08a4d" }).click()
    await expect(palette.getByTitle("#c08a4d")).toHaveCount(0)

    await page.reload()
    await page.getByRole("button", { name: "Colour", exact: true }).click()
    await expect(
      page.getByTestId("palette-Autumn study").getByTitle("#3d7ac2")
    ).toBeVisible()
  })

  test("a palette can be renamed without a mouse", async ({ page }) => {
    await openPicker(page)
    await page.getByRole("button", { name: "New palette" }).click()
    const name = page.getByRole("textbox", { name: "Palette name" })
    await name.fill("Dusk")
    await name.press("Enter")

    // Back to a button, and reachable by keyboard: focus it and type.
    const rename = page.getByRole("button", { name: "Rename Dusk" })
    await rename.focus()
    await rename.press("Enter")
    const again = page.getByRole("textbox", { name: "Palette name" })
    await expect(again).toBeFocused()
    await again.fill("Dawn")
    await again.press("Enter")
    await expect(
      page.getByRole("button", { name: "Rename Dawn" })
    ).toBeVisible()
  })
})
