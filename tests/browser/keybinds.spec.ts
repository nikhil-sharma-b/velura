import { expect, test, type Page } from "@playwright/test"

/**
 * Keys pressed on the real studio reach commands through the registry: the
 * tool rail, the undo buttons and the canvas cursor are what the artist sees
 * change, so they are what is observed.
 */
async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  return page.getByRole("img", { name: "Drawing canvas" })
}

test("tool keys switch the tool in the hand", async ({ page }) => {
  await openStudio(page)
  const brush = page.getByRole("button", { name: "Brush tool", exact: true })
  const eraser = page.getByRole("button", { name: "Eraser tool" })
  await expect(brush).toHaveAttribute("aria-pressed", "true")

  await page.keyboard.press("e")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
  await expect(brush).toHaveAttribute("aria-pressed", "false")

  await page.keyboard.press("b")
  await expect(brush).toHaveAttribute("aria-pressed", "true")
})

test("undo and redo keys walk the history", async ({ page }) => {
  const canvas = await openStudio(page)
  const undo = page.getByRole("button", { name: "Undo" })
  const redo = page.getByRole("button", { name: "Redo" })
  await expect(undo).toBeDisabled()

  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 60, box.y + 60)
  await page.mouse.down()
  await page.mouse.move(box.x + 140, box.y + 60, { steps: 12 })
  await page.mouse.up()
  await expect(undo).toBeEnabled()

  await page.keyboard.press("ControlOrMeta+z")
  await expect(undo).toBeDisabled()
  await expect(redo).toBeEnabled()

  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(redo).toBeDisabled()
  await expect(undo).toBeEnabled()
})

test("keys typed into a field do not reach the studio", async ({ page }) => {
  await openStudio(page)
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByText("Layer 1").dblclick()
  const name = layers.getByRole("textbox", { name: "Layer name" })
  await expect(name).toBeFocused()
  await page.keyboard.type("be")
  await expect(
    page.getByRole("button", { name: "Brush tool", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
})

test("holding the eyedropper key shows the dropper until it is let go", async ({
  page,
}) => {
  const canvas = await openStudio(page)
  const painting = await canvas.evaluate((element) => element.style.cursor)

  await page.keyboard.down("Alt")
  await expect
    .poll(() => canvas.evaluate((element) => element.style.cursor))
    .not.toBe(painting)

  await page.keyboard.up("Alt")
  await expect
    .poll(() => canvas.evaluate((element) => element.style.cursor))
    .toBe(painting)
})

test("tooltips show the keybind the registry holds", async ({ page }) => {
  await openStudio(page)
  await page.getByRole("button", { name: "Zoom in" }).hover()
  await expect(page.getByRole("tooltip")).toContainText("=")
})
