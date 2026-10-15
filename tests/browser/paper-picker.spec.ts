import { expect, test } from "@playwright/test"

/**
 * The document's paper (fluid brushes 15) as the artist chooses it: a
 * control among the document's own, beside export and undo, offering each
 * paper by name with a swatch of it. The engine's side, what a paper does to
 * a wash and how it is saved, is the fluid paper spec's.
 */

test("the paper is chosen from the document's controls, and undo puts it back", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const open = page.getByRole("button", { name: "Paper" })
  await open.click()
  const menu = page.getByRole("menu", { name: "Paper" })
  const option = (name: string) =>
    menu.getByRole("menuitemradio", { name: new RegExp(name) })
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3)
  for (const name of ["Hot press", "Cold press", "Rough"])
    await expect(option(name).locator("canvas")).toBeVisible()
  await expect(option("Cold press")).toHaveAttribute("aria-checked", "true")

  await option("Rough").click()
  await expect(menu).not.toBeAttached()
  await open.click()
  await expect(option("Rough")).toHaveAttribute("aria-checked", "true")
  await expect(option("Cold press")).toHaveAttribute("aria-checked", "false")
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Undo" }).click()
  await open.click()
  await expect(option("Cold press")).toHaveAttribute("aria-checked", "true")
})
