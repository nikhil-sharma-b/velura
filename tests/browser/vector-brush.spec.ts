import { expect, test } from "@playwright/test"

test("the solid vector brush sets its tapers from the tool options", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page
    .getByRole("region", { name: "Layers" })
    .getByRole("button", { name: "Add vector layer" })
    .click()
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  // Pressure is the default, with no taper to set.
  await expect(page.getByRole("button", { name: /^Taper:/ })).toHaveCount(0)
  const rails = page.getByTestId("tool-rails")
  const railHeight = (await rails.boundingBox())!.height
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await page
    .getByRole("dialog", { name: "Choose a vector brush" })
    .getByRole("button", { name: /Solid vector brush/ })
    .click()
  const taper = page.getByRole("button", { name: /^Taper:/ })
  await expect(taper).toHaveAccessibleName("Taper: None")
  // It joins the tool's own options, not the rail, which keeps its height.
  await expect(
    page.getByTestId("tool-options").getByRole("button", { name: /^Taper:/ })
  ).toBeVisible()
  expect((await rails.boundingBox())!.height).toBe(railHeight)
  await taper.click()
  for (const [name, value] of [
    ["Start taper", "30"],
    ["End taper", "50"],
  ]) {
    const field = page.getByRole("textbox", { name })
    await field.fill(value)
    await field.press("Enter")
  }
  await page.keyboard.press("Escape")
  await expect(taper).toHaveAccessibleName("Taper: Start 30%, end 50%")
})
