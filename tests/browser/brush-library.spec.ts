import { expect, test, type Page } from "@playwright/test"

/**
 * The brush library (25).
 *
 * The claims under test are the ones an artist would notice going wrong: that
 * there is something to paint with before anything is configured, that a brush
 * saved is a brush that comes back, that a built-in cannot be destroyed, and
 * that reopening a document puts the brush and size back in the hand. Storage
 * itself is covered by the store's unit tests; this is the panel over it.
 *
 * The anonymous studio is used deliberately: it is the host with no account,
 * so what passes here passes with nothing but this browser behind it.
 */

async function openLibrary(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: /^Choose brush:/ }).click()
  await expect(page.getByTestId("brush-library")).toBeVisible()
}

function library(page: Page) {
  return page.getByTestId("brush-library")
}

test("opens on a set of ready-made brushes covering common media", async ({
  page,
}) => {
  await openLibrary(page)
  for (const name of ["Pencil", "Charcoal", "Inking pen", "Airbrush", "Marker"])
    await expect(
      library(page).getByRole("button", { name: `Paint with ${name}` })
    ).toBeVisible()
})

test("the studio opens with a ready-made brush already in the hand", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  // Without opening anything: the pen is on a brush from the library, not on
  // the engine's dynamics-free default.
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Brush editor" }).click()
  await expect(page.getByRole("dialog")).toContainText("Round brush")
  await expect(page.getByRole("dialog").getByText("No changes")).toBeVisible()
})

test("a built-in is picked up, and cannot be deleted", async ({ page }) => {
  await openLibrary(page)
  await library(page)
    .getByRole("button", { name: "Paint with Charcoal" })
    .click()

  // The brush in the hand is the one chosen: the editor titles what it holds.
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Brush editor" }).click()
  await expect(page.getByRole("dialog")).toContainText("Charcoal")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /^Choose brush:/ }).click()

  await expect(
    library(page).getByRole("button", { name: "Delete Charcoal" })
  ).toHaveCount(0)
  await expect(
    library(page).getByRole("button", { name: "Duplicate Charcoal" })
  ).toBeVisible()
})

test("a brush is duplicated, renamed, and deleted", async ({ page }) => {
  await openLibrary(page)
  await library(page).getByRole("button", { name: "Duplicate Pencil" }).click()

  const copy = library(page).getByRole("button", {
    name: "Paint with Pencil copy",
  })
  await expect(copy).toBeVisible()
  await library(page)
    .getByRole("button", { name: "Rename Pencil copy" })
    .click()
  const name = library(page).getByRole("textbox", {
    name: "Name of Pencil copy",
  })
  await name.fill("Sketching")
  await name.press("Enter")
  await expect(
    library(page).getByRole("button", { name: "Paint with Sketching" })
  ).toBeVisible()

  // A brush of the artist's own is theirs to remove, unlike the one it came
  // from — which is still on the shelf afterwards.
  await library(page).getByRole("button", { name: "Delete Sketching" }).click()
  await expect(
    library(page).getByRole("button", { name: "Paint with Sketching" })
  ).toHaveCount(0)
  await expect(
    library(page).getByRole("button", { name: "Paint with Pencil" })
  ).toBeVisible()
})

test("an edited brush is saved and comes back on the next visit", async ({
  page,
}) => {
  await openLibrary(page)
  await library(page).getByRole("button", { name: "Paint with Marker" }).click()
  await page.getByRole("button", { name: /^Choose brush:/ }).click()
  await library(page).getByRole("button", { name: "Save as new" }).click()
  await expect(
    library(page).getByRole("button", { name: "Paint with Marker" })
  ).toHaveCount(2)

  await page.reload()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: /^Choose brush:/ }).click()
  // Two: the built-in it was copied from, and the saved one, which survived
  // the reload because it is kept rather than held.
  await expect(
    library(page).getByRole("button", { name: "Paint with Marker" })
  ).toHaveCount(2)
})

test("a set is made and a brush shelved in it", async ({ page }) => {
  await openLibrary(page)
  await library(page)
    .getByRole("button", { name: "Duplicate Airbrush" })
    .click()
  await library(page)
    .getByRole("textbox", { name: "New set name" })
    .fill("Washes")
  await library(page).getByRole("button", { name: "Add set" }).click()
  await expect(library(page).getByText("Washes")).toBeVisible()
  await expect(library(page).getByText("Drag a brush here")).toBeVisible()
})

test("the brush and size a document was left with are restored", async ({
  page,
}) => {
  await openLibrary(page)
  await library(page)
    .getByRole("button", { name: "Paint with Inking pen" })
    .click()
  await page.getByRole("button", { name: /^Size:/ }).click()
  const size = page.getByRole("slider", { name: "Size", exact: true })
  await size.focus()
  await size.press("ArrowRight")
  await size.press("ArrowRight")
  const left = await size.getAttribute("aria-valuenow")
  // The store writes once the hand has settled, so the reload waits for it.
  await page.waitForTimeout(1_500)

  await page.reload()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: /^Size:/ }).click()
  await expect(
    page.getByRole("slider", { name: "Size", exact: true })
  ).toHaveAttribute("aria-valuenow", left ?? "")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Brush editor" }).click()
  await expect(page.getByRole("dialog")).toContainText("Inking pen")
})
