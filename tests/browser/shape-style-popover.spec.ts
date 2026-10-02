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

  await page.getByRole("button", { name: "Select objects" }).click()
  await page.mouse.click(cx, cy)
  await trigger.click()
  await expect(options.getByText("Selected objects")).toBeVisible()
  await expect(options.getByRole("button", { name: "Fill" })).toHaveAttribute(
    "aria-pressed",
    "true"
  )
  await expect(
    options.getByRole("button", { name: "Outline", exact: true })
  ).toHaveAttribute("aria-pressed", "false")
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

  // A new fill colour lands on the object.
  await options.getByLabel("Fill colour").fill("#00c040")
  await expect.poll(() => screenPixel(page, cx, cy)).toEqual([0, 192, 64])

  // A fill-only object has no outline to size or colour until it has one.
  const width = options.getByRole("textbox", { name: "Outline width" })
  await expect(width).toBeDisabled()
  await expect(options.getByLabel("Outline colour")).toBeDisabled()

  // An outline, widened, reaches past the edge the fill stopped at.
  await options.getByRole("button", { name: "Outline", exact: true }).click()
  await expect(width).toBeEnabled()
  await options.getByLabel("Outline colour").fill("#c02000")
  await width.fill("24")
  await width.press("Enter")
  await expect
    .poll(() => screenPixel(page, outside.x, outside.y))
    .toEqual([192, 32, 0])
  expect(paper).not.toEqual([192, 32, 0])

  // The options read back what the object now has.
  await expect(width).toHaveValue("24")
  await expect(
    options.getByRole("button", { name: "Outline", exact: true })
  ).toHaveAttribute("aria-pressed", "true")
})
