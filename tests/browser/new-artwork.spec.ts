import { expect, test } from "@playwright/test"

/**
 * An anonymous studio has no library to start another piece from, so its
 * toolbar starts a new artwork by clearing this one, after asking. Export is
 * only for files in and out.
 */
test("an anonymous studio starts a new artwork from the toolbar, not export", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await expect(
    page.getByRole("link", { name: "Back to documents" })
  ).toHaveCount(0)

  await page.getByRole("button", { name: "Export or import" }).click()
  const exportDialog = page.getByRole("dialog", { name: "Export or import" })
  await expect(exportDialog).toBeVisible()
  await expect(
    exportDialog.getByRole("button", { name: "Clear canvas" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "New artwork" }).click()
  const confirm = page.getByRole("alertdialog", {
    name: "Start a new artwork?",
  })
  await confirm.getByRole("button", { name: "Keep artwork" }).click()
  await expect(confirm).toBeHidden()

  await page.getByRole("button", { name: "New artwork" }).click()
  await confirm.getByRole("button", { name: "Clear canvas" }).click()
  await expect(confirm).toBeHidden()
})
