import { expect, test } from "@playwright/test"

test("the eraser leaves a trail while it is down, and the trail fades once it lifts", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const path = page.getByTestId("eraser-trail").locator("path")
  const drawn = async () => !!(await path.getAttribute("d"))
  const canvas = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  const x = canvas.x + canvas.width / 2
  const y = canvas.y + canvas.height / 2

  // The brush leaves its own mark, so it draws no trail.
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + i * 15, y)
  expect(await drawn()).toBe(false)
  await page.mouse.up()

  await page.keyboard.press("e")
  await expect(
    page.getByRole("button", { name: "Eraser tool" })
  ).toHaveAttribute("aria-pressed", "true")
  await page.mouse.move(x, y + 60)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + i * 15, y + 60)
  await expect.poll(drawn).toBe(true)
  await page.mouse.up()
  await expect.poll(drawn).toBe(false)
})

test("erasing on a vector layer is not turned away", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Add vector layer" }).click()
  await page.keyboard.press("e")
  await expect(
    page.getByRole("button", { name: "Eraser tool" })
  ).toHaveAttribute("aria-pressed", "true")
  const canvas = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + 200)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width / 2 + 80, canvas.y + 200)
  await page.mouse.up()
  await page.waitForTimeout(300)
  await expect(page.getByText("holds shapes")).toHaveCount(0)
})

test("on a vector layer a second press of the eraser swaps pixels for shapes", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Add vector layer" }).click()
  const pixel = page.getByRole("button", { name: "Pixel eraser tool" })
  const shape = page.getByRole("button", { name: "Shape eraser tool" })
  await pixel.click()
  await expect(pixel).toHaveAttribute("aria-pressed", "true")
  await pixel.click()
  await expect(shape).toHaveAttribute("aria-pressed", "true")
  await shape.click()
  await expect(pixel).toHaveAttribute("aria-pressed", "true")
  // The tip is still chosen beside it, not by the second press.
  await expect(
    page.getByRole("dialog", { name: "Choose an eraser" })
  ).toHaveCount(0)
})
