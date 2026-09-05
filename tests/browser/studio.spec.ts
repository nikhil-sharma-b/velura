import { expect, test } from "@playwright/test"

test("canvas fills the viewport and follows window and density changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto("/")
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await expect(canvas).toHaveAttribute("width", "900")
  expect(await canvas.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 900,
    height: 600,
  })
  await page.setViewportSize({ width: 640, height: 480 })
  await expect(canvas).toHaveAttribute("width", "640")
  await expect(canvas).toHaveAttribute("height", "480")
  const session = await page.context().newCDPSession(page)
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 640,
    height: 480,
    deviceScaleFactor: 2,
    mobile: false,
  })
  await expect(canvas).toHaveAttribute("width", "1280")
  await expect(canvas).toHaveAttribute("height", "960")
  expect(await canvas.boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: 640,
    height: 480,
  })
})

test("missing WebGPU explains browser requirements", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "gpu", { value: undefined })
  )
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "WebGPU is needed to draw" })
  ).toBeVisible()
  await expect(page.getByRole("main")).toContainText("Chrome")
  await expect(page.getByRole("main")).toContainText("Edge")
  await expect(page.getByRole("main")).toContainText("Safari")
  await expect(page.getByRole("main")).toContainText("Firefox")
})

test("device request failure is explained separately and can be retried", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const requestDevice = GPUAdapter.prototype.requestDevice
    GPUAdapter.prototype.requestDevice = function (descriptor) {
      if (sessionStorage.getItem("retry"))
        return requestDevice.call(this, descriptor)
      return Promise.reject(new Error("Test device allocation failure"))
    }
  })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Your graphics device could not start" })
  ).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem("retry", "true"))
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
})

test("no compatible adapter shows the WebGPU guidance", async ({ page }) => {
  await page.addInitScript(() => {
    GPU.prototype.requestAdapter = async () => null
  })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "WebGPU is needed to draw" })
  ).toBeVisible()
})

test("adapter initialization errors show a startup failure", async ({
  page,
}) => {
  await page.addInitScript(() => {
    GPU.prototype.requestAdapter = async () => {
      throw new Error("Adapter request failed")
    }
  })
  await page.goto("/")
  await expect(
    page.getByRole("heading", { name: "Your graphics device could not start" })
  ).toBeVisible()
})

test("device loss shows a recoverable failure instead of leaving a blank canvas", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const requestDevice = GPUAdapter.prototype.requestDevice
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await requestDevice.call(this, descriptor)
      window.addEventListener("test-device-loss", () => device.destroy(), {
        once: true,
      })
      return device
    }
  })
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.evaluate(() => window.dispatchEvent(new Event("test-device-loss")))
  await expect(
    page.getByRole("heading", { name: "Your graphics device could not start" })
  ).toBeVisible()
  await page.getByRole("button", { name: "Try again" }).click()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
})
