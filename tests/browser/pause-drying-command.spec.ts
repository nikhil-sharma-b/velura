import { expect, test, type Page } from "@playwright/test"

/**
 * Pausing drying from the studio (fluid brushes 18): a command in the
 * palette, and a word in the title bar for as long as drying is paused, so
 * paint that stays wet is not taken for a brush gone wrong.
 */

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

async function runCommand(page: Page, name: string) {
  await page.keyboard.press("ControlOrMeta+k")
  const search = page.getByRole("combobox", { name: "Search commands" })
  await search.fill(name)
  await page.getByRole("option", { name }).click()
  await expect(search).toBeHidden()
}

test("the palette pauses drying and lets it go on, and the studio says while it is paused", async ({
  page,
}) => {
  await openStudio(page)
  const paused = page.getByText("Drying paused")
  await expect(paused).toHaveCount(0)

  await runCommand(page, "Pause or resume drying")
  await expect(paused).toBeVisible()

  await runCommand(page, "Pause or resume drying")
  await expect(paused).toHaveCount(0)
})
