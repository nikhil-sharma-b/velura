import { expect, test } from "@playwright/test"

/**
 * The document's board (fluid brushes 38) as the artist tilts it: a control
 * beside the paper, with a steepness and a dial for which way is down. The
 * engine's side, what a board does to a wash and how it is saved, is the
 * fluid board spec's.
 */

test("the board is tilted from the document's controls, and undo puts it back", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Board" }).click()
  const panel = page.getByRole("dialog", { name: "Board" })
  const steepness = panel.getByRole("slider", { name: "Steepness" })
  const down = panel.getByRole("slider", { name: "Down" })
  await expect(panel.getByText("Flat")).toBeVisible()
  // Flat, there is no way down to choose.
  await expect(down).toHaveAttribute("aria-disabled", "true")

  await steepness.focus()
  await page.keyboard.press("End")
  await expect(panel.getByText("100%")).toBeVisible()
  await expect(down).not.toHaveAttribute("aria-disabled", "true")
  await expect(down).toHaveAttribute("aria-valuenow", "0")
  await down.focus()
  await page.keyboard.press("ArrowRight")
  await expect(down).toHaveAttribute("aria-valuenow", "15")

  // Two steps: the steepness, then the turn.
  await page.keyboard.press("Escape")
  const undo = page.getByRole("button", { name: "Undo" })
  await undo.click()
  await page.getByRole("button", { name: "Board" }).click()
  await expect(down).toHaveAttribute("aria-valuenow", "0")
  await expect(panel.getByText("100%")).toBeVisible()
  await page.keyboard.press("Escape")
  await undo.click()
  await page.getByRole("button", { name: "Board" }).click()
  await expect(panel.getByText("Flat")).toBeVisible()
})
