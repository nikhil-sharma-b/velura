import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * The shape options (21) on the real studio: with an object selected they
 * show its own style and edit it in place; with nothing selected they are
 * what the shape tools give a new shape.
 */

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  return (await canvas.boundingBox())!
}

/** One screen pixel, read off a screenshot of the page. */
async function screenPixel(page: Page, x: number, y: number) {
  const shot = PNG.sync.read(
    await page.screenshot({
      clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 },
    })
  )
  return Array.from(shot.data.slice(0, 3))
}

test("a selected object's fill colour and outline width change from the shape options", async ({
  page,
}) => {
  const box = await openStudio(page)
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add vector layer" }).click()

  // A filled rectangle in the middle of the view.
  await page.getByRole("button", { name: "Rectangle tool" }).click()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx - 80, cy - 50)
  await page.mouse.down()
  await page.mouse.move(cx + 80, cy + 50, { steps: 8 })
  await page.mouse.up()
  const outside = { x: cx + 86, y: cy }
  const paper = await screenPixel(page, outside.x, outside.y)

  // Nothing selected: the options are the tool's.
  const trigger = page.getByRole("button", { name: /^Shape:/ })
  await trigger.click()
  const options = page.getByRole("dialog", { name: "Shape adjustment" })
  await expect(options.getByText("New shapes")).toBeVisible()
  await expect(
    options.getByRole("group", { name: "Object actions" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Object selection tool" }).click()
  await page.mouse.click(cx, cy)
  await trigger.click()
  await expect(options.getByText("Selected objects")).toBeVisible()
  await expect(options.getByRole("switch", { name: "Fill" })).toHaveAttribute(
    "aria-checked",
    "true"
  )
  await expect(
    options.getByRole("switch", { name: "Outline", exact: true })
  ).toHaveAttribute("aria-checked", "false")
  // The actions and the six anchors are there, each named.
  const actions = options.getByRole("group", { name: "Object actions" })
  for (const name of [
    "Transform objects",
    "Duplicate objects",
    "Delete objects",
    "Bring to front",
    "Send to back",
  ])
    await expect(actions.getByRole("button", { name })).toBeVisible()
  await expect(
    options.getByRole("group", { name: "Align to canvas" }).getByRole("button")
  ).toHaveCount(6)

  // A new fill colour lands on the object as it is picked, and a run of
  // picks is one step to take back.
  const original = await screenPixel(page, cx, cy)
  await options.getByLabel("Fill colour").fill("#c0c000")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual([192, 192, 0])
  // Closed at once, before the pick's frame: the colour still lands.
  await options.getByLabel("Fill colour").fill("#00c040")
  await page.keyboard.press("Escape")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual([0, 192, 64])
  await page.keyboard.press("ControlOrMeta+z")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual(original)
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual([0, 192, 64])
  await trigger.click()

  // A fill-only object has no outline to colour until it has one.
  await expect(options.getByLabel("Outline colour")).toBeDisabled()

  // An outline, widened from the rail's width, reaches past the edge the fill
  // stopped at.
  await options.getByRole("switch", { name: "Outline", exact: true }).click()
  await page.keyboard.press("Escape")
  const sizeSetting = page.getByRole("button", { name: /^Width:/ })
  await sizeSetting.click()
  const width = page
    .getByRole("dialog", { name: "Width adjustment" })
    .getByRole("textbox", { name: "Outline width" })
  await expect(width).toBeEnabled()
  await width.fill("24")
  await width.press("Enter")
  await expect(width).toHaveValue("24")
  // Escape rather than the trigger: an open popover is modal, so the rest of
  // the studio, its trigger included, is out of the accessibility tree.
  await page.keyboard.press("Escape")
  await expect(sizeSetting).toHaveAccessibleName("Width: 24 px")

  // The colour last, with the options left open: a colour lands on the next
  // frame, and closing the options first would drop it.
  await trigger.click()
  await expect(
    options.getByRole("switch", { name: "Outline", exact: true })
  ).toHaveAttribute("aria-checked", "true")
  await options.getByLabel("Outline colour").fill("#c02000")
  await expect
    .poll(() => screenPixel(page, outside.x, outside.y))
    .toEqual([192, 32, 0])
  expect(paper).not.toEqual([192, 32, 0])

  // Delete takes the selected object away, as in every vector app.
  await page.keyboard.press("Escape")
  await page.keyboard.press("Delete")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual(paper)
})

test("with a vector tool in hand the size setting is the outline width", async ({
  page,
}) => {
  await openStudio(page)
  await page.getByRole("button", { name: "Vector brush tool" }).click()

  // The size setting now reads the width a vector stroke is drawn at.
  const size = page.getByRole("button", { name: /^Width:/ })
  await expect(size).toHaveAccessibleName("Width: 4 px")
  await size.click()
  const field = page
    .getByRole("dialog", { name: "Width adjustment" })
    .getByRole("textbox", { name: "Outline width" })
  await field.fill("9")
  await field.press("Enter")
  await page.keyboard.press("Escape")
  await expect(size).toHaveAccessibleName("Width: 9 px")

  // The shape options read the same width, and send the artist to the rail.
  await expect(
    page.getByRole("button", { name: /^Shape:/ })
  ).toHaveAccessibleName("Shape: 9px outline")
  await page.getByRole("button", { name: /^Shape:/ }).click()
  const options = page.getByRole("dialog", { name: "Shape adjustment" })
  await expect(
    options.getByText("Outline width is set with Width in the rail.")
  ).toBeVisible()
  await expect(
    options.getByRole("textbox", { name: "Outline width" })
  ).toHaveCount(0)
  await page.keyboard.press("Escape")

  // Back to the pixel brush, the setting is its size again.
  await page.getByRole("button", { name: "Brush tool", exact: true }).click()
  await expect(page.getByRole("button", { name: /^Size:/ })).toBeVisible()
})

test("two curves selected whole join from the objects' actions", async ({
  page,
}) => {
  const box = await openStudio(page)
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add vector layer" }).click()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.getByRole("button", { name: "Pen tool" }).click()
  for (const dy of [-40, 40]) {
    for (const dx of [-60, 60]) {
      await page.mouse.move(cx + dx, cy + dy)
      await page.mouse.down()
      await page.mouse.up()
    }
    await page.getByRole("button", { name: "Finish open path" }).click()
  }
  await page.getByRole("button", { name: "Object selection tool" }).click()
  // A band round both curves selects them.
  await page.mouse.move(cx - 100, cy - 80)
  await page.mouse.down()
  await page.mouse.move(cx + 100, cy + 80, { steps: 8 })
  await page.mouse.up()
  await page.getByRole("button", { name: /^Shape:/ }).click()
  const actions = page
    .getByRole("dialog", { name: "Shape adjustment" })
    .getByRole("group", { name: "Object actions" })
  await expect(
    actions.getByRole("button", { name: "Join curves", exact: true })
  ).toBeEnabled()
  await actions
    .getByRole("button", { name: "Join curves with a segment" })
    .click()
  // One curve left, so it can now only be closed.
  await expect(
    actions.getByRole("button", { name: "Join curves with a segment" })
  ).toBeEnabled()
})
