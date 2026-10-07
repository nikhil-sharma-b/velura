import { expect, test, type Page } from "@playwright/test"

/**
 * The textures shipped from Krita's default resources (brush library 01).
 *
 * What is under test is the lazy half: every shipped tip and paper is offered
 * in the editor from the start, none of their pixels are fetched until a brush
 * names one, and naming one fetches it and paints with it. The decoding and
 * the conversion are unit-tested.
 */

const SHIPPED = /\/brushes\/krita\//

async function openEditor(page: Page, fetched: string[]) {
  page.on("request", (request) => {
    if (SHIPPED.test(request.url())) fetched.push(request.url())
  })
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Brush editor" }).click()
  return page.getByRole("region", { name: "Brush editor" })
}

test("a shipped paper is offered at once and fetched only when chosen", async ({
  page,
}) => {
  const fetched: string[] = []
  const panel = await openEditor(page, fetched)
  await panel.getByRole("tab", { name: "Grain" }).click()
  await panel.getByRole("combobox", { name: "Paper" }).click()
  await expect(page.getByRole("group", { name: "From Krita" })).toBeVisible()
  expect(fetched).toEqual([])

  await page.getByRole("option", { name: "Canvas", exact: true }).click()
  // The grain controls appear only once the engine has taken the brush, and
  // it takes a brush only once the paper it names has arrived.
  await expect(panel.getByRole("slider", { name: "Grain depth" })).toBeVisible()
  await expect(panel.getByRole("combobox", { name: "Paper" })).toHaveText(
    "Canvas"
  )
  expect(fetched.map((url) => new URL(url).pathname)).toEqual([
    "/brushes/krita/grain/01-canvas.png",
  ])
})

test("a shipped tip is chosen, fetched and painted with", async ({ page }) => {
  const fetched: string[] = []
  const panel = await openEditor(page, fetched)
  await panel.getByRole("combobox", { name: "Tip" }).click()
  await page.getByRole("option", { name: "Chalk", exact: true }).click()
  await expect(panel.getByRole("combobox", { name: "Tip" })).toHaveText("Chalk")
  await expect
    .poll(() => fetched.map((url) => new URL(url).pathname))
    .toEqual(["/brushes/krita/tips/chalk.png"])

  const canvas = page.locator("canvas").first()
  const box = await canvas.boundingBox()
  if (!box) throw new Error("The canvas has no box.")
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, {
    steps: 12,
  })
  await page.mouse.up()
  await expect(panel.getByRole("alert")).toHaveCount(0)
})

test("the library credits the shipped textures' makers", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: /^Choose brush:/ }).click()
  const library = page.getByTestId("brush-library")
  await library.getByText("Credits", { exact: true }).click()
  await expect(library.getByText(/David Revoy/)).toBeVisible()
  await expect(library.getByText(/CC0 1\.0/)).toBeVisible()
})
