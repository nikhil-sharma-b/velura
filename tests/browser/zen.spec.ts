import { expect, test } from "@playwright/test"

/**
 * Zen hides every control and leaves the canvas; the keys and the pen keep
 * working underneath, and the controls come back as they were left.
 */
test("tab hides the controls, painting still lands, and tab restores them", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const undo = page.getByRole("button", { name: "Undo" })
  const layers = page.getByRole("region", { name: "Layers" })
  await expect(undo).toBeDisabled()

  await page.keyboard.press("Tab")
  await expect(undo).toBeHidden()
  await expect(layers).toBeHidden()
  await expect(page.getByText("Saved on this device")).toBeHidden()
  expect(await canvas.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
  })

  await page.mouse.move(300, 300)
  await page.mouse.down()
  await page.mouse.move(500, 300, { steps: 12 })
  await page.mouse.up()

  // The palette still opens over the bare canvas.
  await page.keyboard.press("ControlOrMeta+k")
  const search = page.getByRole("combobox", { name: "Search commands" })
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()

  await page.keyboard.press("Tab")
  await expect(layers).toBeVisible()
  await expect(undo).toBeEnabled()

  // Undo reaches the engine while the controls are away.
  await page.keyboard.press("Tab")
  await page.keyboard.press("ControlOrMeta+z")
  await page.keyboard.press("Tab")
  await expect(undo).toBeDisabled()
})
