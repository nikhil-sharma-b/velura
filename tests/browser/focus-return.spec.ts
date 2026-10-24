import { expect, test, type Locator, type Page } from "@playwright/test"

/**
 * What closing a dialog or panel does with focus. Closed by a key, focus goes
 * back to what opened it, so the keyboard keeps its place. Closed by a click,
 * it does not: a button focused that way opens its tooltip under a pointer
 * that has already moved on.
 */
async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

async function expectNoTooltipOn(page: Page, trigger: Locator) {
  await page.waitForTimeout(600)
  await expect(page.getByRole("tooltip")).toHaveCount(0)
  await expect(trigger).not.toBeFocused()
}

test("a dialog closed by a click leaves no tooltip; closed by Escape, focus returns", async ({
  page,
}) => {
  await openStudio(page)
  const trigger = page.getByRole("button", { name: "Export or import" })
  const dialog = page.getByRole("dialog")

  await trigger.click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole("button", { name: "Close" }).click()
  await expect(dialog).toBeHidden()
  await expectNoTooltipOn(page, trigger)

  await trigger.click()
  await expect(dialog).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test("the brush editor closed by a click leaves no tooltip; closed by Escape, focus returns", async ({
  page,
}) => {
  await openStudio(page)
  const trigger = page.getByRole("button", { name: "Brush editor" })
  const editor = page.getByRole("region", { name: "Brush editor" })

  await trigger.click()
  await expect(editor).toBeVisible()
  await editor.getByRole("button", { name: "Close brush editor" }).click()
  await expect(editor).toHaveCount(0)
  await expectNoTooltipOn(page, trigger)

  await trigger.click()
  await editor.getByRole("tab", { name: "Shape" }).focus()
  await page.keyboard.press("Escape")
  await expect(editor).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
