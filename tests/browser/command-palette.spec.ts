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
  await search.fill("flip canvas")
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

test("keys pressed right after Escape reach the canvas", async ({ page }) => {
  await openStudio(page)
  const eraser = page.getByRole("button", { name: "Eraser tool" })
  await openPalette(page)
  await page.keyboard.press("Escape")
  await page.keyboard.press("e")
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
})

test("the palette takes typing again after preferences opened from it closes", async ({
  page,
}) => {
  await openStudio(page)
  const search = await openPalette(page)
  await search.fill("preferences")
  await page.keyboard.press("Enter")
  const preferences = page.getByRole("dialog", { name: "Preferences" })
  await expect(preferences).toBeVisible()
  // Straight on, while preferences is still animating out: an artist does
  // not wait for a fade before reaching for the next key.
  await page.keyboard.press("Escape")
  const again = await openPalette(page)
  await expect(preferences).toBeHidden()
  await page.keyboard.type("clear layer")
  await expect(again).toHaveValue("clear layer")
  await page.keyboard.press("Escape")
  await expect(again).toBeHidden()
})

test("a palette key that is a plain letter is typed into the search, not a close", async ({
  page,
}) => {
  await openStudio(page)
  // Bound to Q as well as its default, from preferences.
  const search = await openPalette(page)
  await search.fill("preferences")
  await page.keyboard.press("Enter")
  const preferences = page.getByRole("dialog", { name: "Preferences" })
  await preferences
    .getByRole("button", { name: "Add a shortcut for Command palette" })
    .click()
  await page.keyboard.press("q")
  await page.keyboard.press("Escape")
  await expect(preferences).toBeHidden()

  // Q opens it from the canvas, and is then a letter like any other.
  await page.keyboard.press("q")
  await expect(search).toBeFocused()
  await page.keyboard.type("quick q")
  await expect(search).toHaveValue("quick q")
  await expect(search).toBeVisible()

  // The modifier chord still closes it from the search, and so does Escape.
  await page.keyboard.press("ControlOrMeta+k")
  await expect(search).toBeHidden()
  await page.keyboard.press("q")
  await expect(search).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(search).toBeHidden()
})
