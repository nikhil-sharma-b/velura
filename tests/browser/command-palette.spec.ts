import { expect, test, type Page } from "@playwright/test"

/**
 * The palette reaches every command in the studio's registry by name: what
 * it runs is observed where the artist would see it change.
 */
async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

async function openPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k")
  const search = page.getByRole("combobox", { name: "Search commands" })
  await expect(search).toBeFocused()
  return search
}

test("typing a command's name and pressing Enter runs it", async ({ page }) => {
  await openStudio(page)
  const eraser = page.getByRole("button", { name: "Eraser tool" })
  await expect(eraser).toHaveAttribute("aria-pressed", "false")

  const search = await openPalette(page)
  await search.fill("ers tl")
  const options = page.getByRole("option")
  await expect(options.first()).toContainText("Eraser tool")
  await expect(options.first()).toContainText("E")
  await page.keyboard.press("Enter")

  await expect(search).toBeHidden()
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
})

test("a command run from the palette is listed first next time", async ({
  page,
}) => {
  await openStudio(page)
  const search = await openPalette(page)
  await search.fill("flip")
  await page.keyboard.press("Enter")
  await expect(search).toBeHidden()

  await openPalette(page)
  await expect(page.getByRole("option").first()).toContainText(
    "Flip canvas horizontally"
  )
})

test("the palette's own keybind closes it", async ({ page }) => {
  await openStudio(page)
  const search = await openPalette(page)
  await page.keyboard.press("ControlOrMeta+k")
  await expect(search).toBeHidden()
})

test("an unavailable command is disabled and does not run", async ({
  page,
}) => {
  await openStudio(page)
  const search = await openPalette(page)
  await search.fill("remove mask")
  const option = page.getByRole("option", { name: /Remove mask/ })
  await expect(option).toHaveAttribute("aria-disabled", "true")
  await page.keyboard.press("Enter")
  await expect(search).toBeVisible()
})
