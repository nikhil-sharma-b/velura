import { expect, test, type Page } from "@playwright/test"

/**
 * Guides and the straight-edge draw with the canvas (07): beneath the tool
 * rails, the layers panel and every other control, over the canvas and the
 * matting around it, and still there in zen with the controls gone.
 */

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.keyboard.press("Shift+R")
  await expect(page.getByTestId("ruler-top")).toBeVisible()
}

/** Drags a guide out of a ruler, to `to` in page pixels. */
async function dragGuide(
  page: Page,
  from: "top" | "left",
  to: { x: number; y: number }
) {
  const ruler = (await page.getByTestId(`ruler-${from}`).boundingBox())!
  const start =
    from === "top"
      ? { x: to.x, y: ruler.y + ruler.height / 2 }
      : { x: ruler.x + ruler.width / 2, y: to.y }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 6 })
  await page.mouse.up()
}

/** What takes a press at a point: the control there, or the guide. */
const pressedAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x, y)
      if (!hit) return "nothing"
      if (hit.closest("[data-testid=tool-rails]")) return "rail"
      if (hit.closest("[aria-label=Layers]")) return "layers"
      if (hit.closest("[data-guide]")) return "guide"
      return hit.tagName.toLowerCase()
    },
    [x, y] as const
  )

test("a guide passes under the rail and the layers panel, and is held over the canvas", async ({
  page,
}) => {
  await openStudio(page)
  const rail = (await page.getByTestId("tool-rails").boundingBox())!
  const layers = (await page
    .getByRole("region", { name: "Layers" })
    .boundingBox())!

  // Across the rail: a horizontal guide at its middle.
  const across = rail.y + 120
  await dragGuide(page, "top", { x: 500, y: across })
  // Down through the layers panel: a vertical guide inside it.
  const down = layers.x + layers.width / 2
  await dragGuide(page, "left", { x: down, y: 400 })
  await expect(page.getByTestId("guide")).toHaveCount(2)

  expect(await pressedAt(page, rail.x + rail.width / 2, across)).toBe("rail")
  expect(await pressedAt(page, down, layers.y + layers.height / 2)).toBe(
    "layers"
  )
  // Over the canvas each is still there to be taken hold of.
  expect(await pressedAt(page, 500, across)).toBe("guide")
  expect(await pressedAt(page, down, 500)).toBe("guide")
})

test("the straight-edge draws beneath the controls", async ({ page }) => {
  await openStudio(page)
  await page.keyboard.press("ControlOrMeta+k")
  await page
    .getByRole("combobox", { name: "Search commands" })
    .fill("straight-edge")
  await page.keyboard.press("Enter")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const edge = page.getByTestId("straight-edge")
  await expect(edge).toBeAttached()
  // Painted before the controls, so every one of them is on top of it.
  expect(
    await edge.evaluate((svg) => {
      const chrome = document.querySelector("[data-testid=studio-chrome]")!
      return !!(
        chrome.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_PRECEDING
      )
    })
  ).toBe(true)
  // Its handle in the middle of the view is uncovered, and takes the press.
  const move = (await page.getByTestId("straight-edge-move").boundingBox())!
  expect(
    await page.evaluate(
      ([x, y]) =>
        document.elementFromPoint(x, y)?.getAttribute("data-testid") ?? "",
      [move.x + move.width / 2, move.y + move.height / 2] as const
    )
  ).toBe("straight-edge-move")
})

test("in zen the guides stay across the whole view, without the rulers", async ({
  page,
}) => {
  await openStudio(page)
  await dragGuide(page, "top", { x: 500, y: 300 })
  const guide = page.getByTestId("guide")
  await expect(guide).toHaveCount(1)
  await page.keyboard.press("f")
  await expect(page.getByRole("region", { name: "Layers" })).toBeHidden()
  // Attached and laid out, not hidden with the controls: a line one pixel
  // thin has no height for a visibility check to see.
  await expect(guide).toBeAttached()
  await expect(page.getByTestId("ruler-top")).toBeHidden()
  const line = (await guide.boundingBox())!
  const view = page.viewportSize()!
  expect(line.x).toBeLessThanOrEqual(0)
  expect(line.x + line.width).toBeGreaterThanOrEqual(view.width)
  await page.keyboard.press("f")
  await expect(page.getByTestId("ruler-top")).toBeVisible()
})

test("a guide over an open transform box can still be taken hold of", async ({
  page,
}) => {
  await openStudio(page)
  // A stroke picked up as a layer: its box covers the canvas while it is open.
  await page.mouse.move(400, 300)
  await page.mouse.down()
  await page.mouse.move(700, 300, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled()
  await page.keyboard.press("ControlOrMeta+t")
  await expect(page.getByTestId("layer-transform")).toBeVisible()
  await dragGuide(page, "top", { x: 900, y: 450 })
  await expect(page.getByTestId("guide")).toHaveCount(1)
  expect(await pressedAt(page, 550, 450)).toBe("guide")
})
