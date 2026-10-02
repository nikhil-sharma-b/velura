import { expect, test } from "@playwright/test"

test("the eraser leaves a trail while it is down, and the trail fades once it lifts", async ({
  page,
}) => {
  // The trail lives only 180ms behind the pen, and a frame on CI's software
  // WebGPU can take longer than that, so the stroke runs on a paused clock
  // stepped one frame at a time.
  await page.clock.install()
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
  await page.clock.pauseAt(Date.now() + 1000)
  await page.mouse.down()
  for (let i = 1; i <= 6; i++) await page.mouse.move(x + i * 15, y + 60)
  await page.clock.runFor(16)
  expect(await drawn()).toBe(true)
  await page.mouse.up()
  await page.clock.resume()
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
