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
  // A group's thumbnail scales its children down further than a layer row
  // does, and the default pencil line thins out to nothing at that size on
  // CI's software rasteriser. A broad stroke survives the reduction.
  const size = page.getByRole("button", { name: /^Size:/ })
  const initial = (await size.getAttribute("aria-label"))!
  for (let press = 0; press < 10; press++) await page.keyboard.press("]")
  await expect(size).not.toHaveAttribute("aria-label", initial)
  await (
    await stroke(page, 200, 600)
  )()
  await layers.getByRole("button", { name: "Group active layer" }).click()
  const group = layers.getByTestId(/^thumbnail-Group /)
  await expect(group).toHaveAttribute("data-state", "shown")
  await expect.poll(() => colours(group)).toBeGreaterThan(2)

  // Hiding the group hides what is in it, which each row inside says too.
  await layers.getByRole("button", { name: /^Hide Group / }).click()
  const inside = layers.getByTestId("thumbnail-Layer 2")
  await expect(inside).toHaveAttribute("data-state", "hidden")
  await expect(inside).toHaveAttribute("data-hidden-by", "group")
  await layers.getByRole("button", { name: /^Show Group / }).click()
  await expect(inside).toHaveAttribute("data-state", "shown")

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

test("pointing at a row dims the canvas around it and previews it larger", async ({
  page,
}) => {
  const layers = await openStudio(page)
  await layers.getByRole("button", { name: "Add layer" }).click()
  await (
    await stroke(page, 200, 600)
  )()
  // The stretch the stroke crossed, clear of the panels and their tooltips.
  const box = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  const shot = async () =>
    (
      await page.screenshot({
        clip: { x: box.x + 150, y: box.y + 250, width: 500, height: 100 },
      })
    ).toString("base64")
  const plain = await shot()

  // Layer 1 picked out: the stroke on Layer 2 is what dims.
  await layers.getByTestId("layer-row-Layer 1").hover()
  await expect.poll(shot).not.toBe(plain)

  await layers.getByTestId("thumbnail-Layer 2").hover()
  const preview = page.getByTestId("preview-Layer 2")
  await expect(preview).toBeVisible()
  await expect.poll(() => colours(preview)).toBeGreaterThan(2)

  // Straight off the list onto the canvas, as an artist heading back to
  // paint would: the preview closes and the stack comes back.
  await page.mouse.move(box.x + 300, box.y + 400)
  await expect(preview).toBeHidden()
  await expect.poll(shot).toBe(plain)
})

test("the active row's clear button empties the layer, and undo refills it", async ({
  page,
}) => {
  const layers = await openStudio(page)
  await layers.getByRole("button", { name: "Add layer" }).click()
  const second = layers.getByTestId("thumbnail-Layer 2")
  await (
    await stroke(page, 200, 600)
  )()
  await expect(second).toHaveAttribute("data-state", "shown")

  const clear = layers.getByRole("button", { name: "Clear Layer 2" })
  // Clearing waits for a yes; backing out leaves the layer alone.
  await clear.click()
  await page.getByRole("button", { name: "Keep it" }).click()
  await expect(second).toHaveAttribute("data-state", "shown")
  await clear.click()
  await page.getByRole("button", { name: "Clear layer" }).click()
  await expect(second).toHaveAttribute("data-state", "empty")
  // An empty layer has nothing to clear.
  await expect(clear).toBeDisabled()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(second).toHaveAttribute("data-state", "shown")

  // A locked layer is one the artist said not to touch.
  await layers.getByRole("button", { name: "Lock Layer 2" }).click()
  await expect(clear).toBeDisabled()
})

test("a vector layer's row shows the shapes on it", async ({ page }) => {
  const layers = await openStudio(page)
  await layers.getByRole("button", { name: "Add vector layer" }).click()
  const row = layers.getByTestId("thumbnail-Vector 2")
  await expect(row).toHaveAttribute("data-state", "empty")

  await page.keyboard.press("u")
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 200, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 10 })
  await page.mouse.up()
  await expect(row).toHaveAttribute("data-state", "shown")
  await expect.poll(() => colours(row)).toBeGreaterThan(2)

  // Its shapes clear as a raster layer's pixels do, once confirmed.
  await layers.getByRole("button", { name: "Clear Vector 2" }).click()
  await page.getByRole("button", { name: "Clear layer" }).click()
  await expect(row).toHaveAttribute("data-state", "empty")
})
