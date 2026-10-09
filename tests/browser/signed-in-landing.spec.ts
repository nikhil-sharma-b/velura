import { expect, test } from "@playwright/test"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

/**
 * A browser holding a session lands in the library, not on the signed-out
 * studio asking it to sign in; one without stays on the canvas.
 */
test("a saved session sends / to the library", async ({ page }) => {
  test.skip(!convexUrl, "needs NEXT_PUBLIC_CONVEX_URL")
  const key = `__convexAuthRefreshToken_${convexUrl!.replace(/[^a-zA-Z0-9]/g, "")}`
  await page.addInitScript((key) => {
    localStorage.setItem(key, "a-refresh-token")
  }, key)
  await page.goto("/")
  await expect(page).toHaveURL(/\/library$/)
})

test("no session stays on the studio", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await expect(page).toHaveURL(/\/$/)
})
