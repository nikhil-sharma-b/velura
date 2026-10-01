import { expect, test } from "@playwright/test"

/**
 * The left rails on a short window (05): whichever tool is in the hand, and
 * however many option rows it adds, every rail button can be reached — by
 * scrolling the rail itself, never the studio under it — and none is cut off
 * by the bottom of the window.
 */

const HEIGHT = 700
test.use({ viewport: { width: 1280, height: HEIGHT } })

for (const [tool, key] of [
  ["brush", "b"],
  ["eraser", "e"],
  ["magic wand", "w"],
  ["rectangle", "u"],
  ["pen", "p"],
] as const)
  test(`with the ${tool} in hand, every rail button is reachable`, async ({
    page,
  }) => {
    await page.goto("/")
    await expect(page.getByRole("main")).toHaveAttribute(
      "data-engine-status",
      "ready"
    )
    await page.keyboard.press(key)
    const rail = page.getByTestId("tool-rails")
    const frame = (await rail.boundingBox())!
    expect(frame.y + frame.height).toBeLessThanOrEqual(HEIGHT)
    // The rails are taller than this window, so this is the case at issue.
    expect(
      await rail.evaluate((column) => column.scrollHeight > column.clientHeight)
    ).toBe(true)

    const buttons = rail.getByRole("button")
    const count = await buttons.count()
    // The last is the brush editor's, at the foot of the tools.
    await expect(buttons.last()).toHaveAccessibleName("Brush editor")
    // Inside what the column shows, which ends inside the window.
    const shown = await rail.evaluate((column) => {
      const box = column.getBoundingClientRect()
      return { top: box.top, bottom: box.bottom }
    })
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index)
      await button.scrollIntoViewIfNeeded()
      const box = (await button.boundingBox())!
      expect(box.y).toBeGreaterThanOrEqual(shown.top)
      expect(box.y + box.height).toBeLessThanOrEqual(shown.bottom)
    }
    // The rail scrolled, not the studio: the canvas is where it was.
    expect(
      await page.getByRole("main").evaluate((main) => main.scrollTop)
    ).toBe(0)
    // Its scrollbar is its own to drag: the column takes the pointer at its
    // right edge rather than letting it fall through to the canvas.
    expect(
      await rail.evaluate((column) => {
        const box = column.getBoundingClientRect()
        const hit = document.elementFromPoint(box.right - 2, box.bottom - 20)
        return hit === column || column.contains(hit)
      })
    ).toBe(true)
    // Scrolled back to the end, the last one is on screen to be pressed.
    await buttons.last().scrollIntoViewIfNeeded()
    await expect(buttons.last()).toBeInViewport()
  })
