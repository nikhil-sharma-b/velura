import { expect, test, type Page } from "@playwright/test"

/**
 * The preferences panel rebinds the studio's keys, and what it stores is
 * what the window's keys do — including after a reload.
 */
async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

async function openPreferences(page: Page) {
  await page.keyboard.press("ControlOrMeta+k")
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("preferences")
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Preferences" })
  await expect(dialog).toBeVisible()
  return dialog
}

test("a rebound key runs its command and survives a reload", async ({
  page,
}) => {
  await openStudio(page)
  const eraser = page.getByRole("button", { name: "Eraser tool", exact: true })
  const dialog = await openPreferences(page)

  await dialog
    .getByRole("button", { name: "Add a shortcut for Eraser tool" })
    .click()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeVisible()
  await dialog
    .getByRole("button", { name: "Add a shortcut for Eraser tool" })
    .click()
  await page.keyboard.press("x")
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()

  await page.keyboard.press("x")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")

  await page.reload()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.keyboard.press("b")
  await expect(eraser).toHaveAttribute("aria-pressed", "false")
  await page.keyboard.press("x")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
})

test("a conflict names the owner, and swap trades the keys", async ({
  page,
}) => {
  await openStudio(page)
  const brush = page.getByRole("button", { name: "Brush tool", exact: true })
  const eraser = page.getByRole("button", { name: "Eraser tool", exact: true })
  const dialog = await openPreferences(page)

  await dialog.getByRole("button", { name: "Change E for Eraser tool" }).click()
  await page.keyboard.press("b")
  const alert = dialog.getByRole("alert")
  await expect(alert).toContainText("already bound to Brush tool")
  await alert.getByRole("button", { name: "Swap" }).click()
  await expect(
    dialog.getByRole("button", { name: "Change B for Eraser tool" })
  ).toBeVisible()
  await expect(
    dialog.getByRole("button", { name: "Change E for Brush tool" })
  ).toBeVisible()
  await page.keyboard.press("Escape")

  await page.keyboard.press("b")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("e")
  await expect(brush).toHaveAttribute("aria-pressed", "true")
})

test("reassign, unbind and reset all", async ({ page }) => {
  await openStudio(page)
  const eraser = page.getByRole("button", { name: "Eraser tool", exact: true })
  const dialog = await openPreferences(page)

  await dialog
    .getByRole("button", {
      name: "Add a shortcut for Flip canvas horizontally",
    })
    .click()
  await page.keyboard.press("e")
  await dialog
    .getByRole("alert")
    .getByRole("button", { name: "Reassign" })
    .click()
  await expect(
    dialog
      .locator('[data-command="tool.eraser"]')
      .getByRole("button", { name: /^Change/ })
  ).toHaveCount(0)

  await dialog
    .getByRole("button", { name: "Remove H from Flip canvas horizontally" })
    .click()
  await expect(
    dialog.getByRole("button", {
      name: "Change H for Flip canvas horizontally",
    })
  ).toHaveCount(0)

  await dialog.getByRole("button", { name: "Reset all" }).click()
  await expect(
    dialog.getByRole("button", { name: "Change E for Eraser tool" })
  ).toBeVisible()
  await page.keyboard.press("Escape")

  await page.keyboard.press("e")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
})

test("the palette's Keyboard shortcuts opens the shortcut list", async ({
  page,
}) => {
  await openStudio(page)
  await page.keyboard.press("ControlOrMeta+k")
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("keyboard shortcuts")
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Preferences" })
  await expect(
    dialog.getByRole("region", { name: "Keyboard shortcuts" })
  ).toBeVisible()
})
