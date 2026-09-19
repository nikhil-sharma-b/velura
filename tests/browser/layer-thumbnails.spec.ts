import { expect, test, type Locator, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Every layer row carries a live picture of its own pixels (post-v1 03).
 * What is checked is what a reader relies on: a row with work on it shows
 * that work, an empty row and a hidden row each say so, and a thumbnail
 * catches up with painting by itself — but never during a stroke.
 */

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  return page.getByRole("region", { name: "Layers" })
}

/** How many distinct colours the thumbnail shows: one checker has two. */
async function colours(thumbnail: Locator): Promise<number> {
  const png = PNG.sync.read(await thumbnail.locator("canvas").screenshot())
  const seen = new Set<number>()
  for (let offset = 0; offset < png.data.length; offset += 4)
    seen.add(png.data.readUInt32BE(offset))
  return seen.size
}

async function stroke(page: Page, from: number, to: number, holdMs = 0) {
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + from, box.y + 300)
  await page.mouse.down()
  const steps = 12
  for (let step = 1; step <= steps; step++) {
    await page.mouse.move(
      box.x + from + ((to - from) * step) / steps,
      box.y + 300
    )
    if (holdMs) await page.waitForTimeout(holdMs / steps)
  }
  return () => page.mouse.up()
}

test("a row shows its layer's own work, and says when it has none", async ({
  page,
}) => {
  const layers = await openStudio(page)
  const first = layers.getByTestId("thumbnail-Layer 1")
  await expect(first).toHaveAttribute("data-state", "shown")
  // The seeded scene is on Layer 1: more than the checker behind it.
  await expect.poll(() => colours(first)).toBeGreaterThan(2)

  await layers.getByRole("button", { name: "Add layer" }).click()
  const second = layers.getByTestId("thumbnail-Layer 2")
  await expect(second).toHaveAttribute("data-state", "empty")

  await (
    await stroke(page, 200, 600)
  )()
  await expect(second).toHaveAttribute("data-state", "shown")
  await expect.poll(() => colours(second)).toBeGreaterThan(2)

  await layers.getByRole("button", { name: "Hide Layer 1" }).click()
  await expect(first).toHaveAttribute("data-state", "hidden")
})

test("no thumbnail is drawn while a stroke is in flight", async ({ page }) => {
  const layers = await openStudio(page)
  // Counts every frame a thumbnail canvas takes; the drawing canvas is not one.
  await page.evaluate(() => {
    const acquire = GPUCanvasContext.prototype.getCurrentTexture
    const counts = { thumbnails: 0 }
    Object.assign(window, { thumbnailDraws: counts })
    GPUCanvasContext.prototype.getCurrentTexture = function () {
      if ((this.canvas as HTMLCanvasElement).closest?.("[data-layer-row]"))
        counts.thumbnails++
      return acquire.call(this)
    }
  })
  const draws = () =>
    page.evaluate(
      () =>
        (window as unknown as { thumbnailDraws: { thumbnails: number } })
          .thumbnailDraws.thumbnails
    )
  await layers.getByRole("button", { name: "Add layer" }).click()
  await expect.poll(draws).toBeGreaterThan(0)
  // With the pen down, a structural change marks every thumbnail stale, and
  // the stroke then outlasts the quiet window several times over. Clicked
  // through the DOM so the mouse stays on the canvas, held.
  const lift = await stroke(page, 200, 400)
  await page.evaluate(() =>
    document
      .querySelector<HTMLButtonElement>('[aria-label="Hide Layer 1"]')!
      .click()
  )
  const before = await draws()
  await page.waitForTimeout(1200)
  expect(await draws()).toBe(before)
  await lift()
  await expect.poll(draws).toBeGreaterThan(before)
})

test("a group shows its children together, and a mask sits beside its layer", async ({
  page,
}) => {
  const layers = await openStudio(page)
  await layers.getByRole("button", { name: "Add layer" }).click()
  await (
    await stroke(page, 200, 600)
  )()
  await layers.getByRole("button", { name: "Group active layer" }).click()
  const group = layers.getByTestId(/^thumbnail-Group /)
  await expect(group).toHaveAttribute("data-state", "shown")
  await expect.poll(() => colours(group)).toBeGreaterThan(2)

  await layers
    .getByRole("button", { name: /Layer 2$/ })
    .first()
    .click()
  await layers.getByText("Layer properties", { exact: true }).click()
  await layers.getByRole("button", { name: "Add mask" }).click()
  // A new mask hides nothing, so it reads as all white rather than empty.
  const mask = layers.getByTestId("thumbnail-Layer 2 mask")
  await expect(mask).toHaveAttribute("data-state", "shown")
})
