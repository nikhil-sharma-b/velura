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

test("the layer panel manages the stack and explains locked painting", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )

  const layers = page.getByRole("region", { name: "Layers" })
  await expect(layers.getByText("Layer 1")).toBeVisible()
  await layers.getByRole("button", { name: "Add layer" }).click()
  await expect(layers.getByText("Layer 2")).toBeVisible()

  await layers.getByText("Layer 2").dblclick()
  const name = layers.getByRole("textbox", { name: "Layer name" })
  await name.fill("Highlights")
  await name.press("Enter")
  await expect(layers.getByText("Highlights")).toBeVisible()

  await layers.getByRole("button", { name: "Duplicate Highlights" }).click()
  await expect(layers.getByText("Highlights copy")).toBeVisible()
  await layers.getByRole("button", { name: "Hide Highlights copy" }).click()
  await expect(
    layers.getByRole("button", { name: "Show Highlights copy" })
  ).toBeVisible()

  await layers.getByRole("button", { name: "Lock Highlights copy" }).click()
  await page.getByRole("img", { name: "Drawing canvas" }).click({
    position: { x: 400, y: 300 },
  })
  await expect(page.getByRole("status")).toContainText(
    "Highlights copy is locked"
  )

  const opacity = layers.getByRole("slider", { name: "Layer opacity" })
  await opacity.press("End")
  for (let step = 0; step < 45; step++) await opacity.press("ArrowLeft")
  await expect(layers.getByText("55%")).toBeVisible()
  await layers.getByRole("combobox", { name: "Blend mode" }).click()
  await page.getByRole("option", { name: "Multiply" }).click()

  const copy = layers.getByTestId("layer-row-Highlights copy")
  const original = layers.getByTestId("layer-row-Highlights")
  await copy.dragTo(original)
  await expect(layers.locator("[data-layer-row]").first()).toHaveAttribute(
    "data-testid",
    "layer-row-Highlights"
  )

  await layers.getByRole("button", { name: "Delete Highlights copy" }).click()
  await expect(layers.getByText("Highlights copy")).toHaveCount(0)

  await page.getByRole("button", { name: "Collapse panels" }).click()
  await expect(layers).toBeHidden()
  await page.getByRole("button", { name: "Expand panels" }).click()
  await expect(layers).toBeVisible()
})

test("the layer panel groups layers and manages a reversible mask", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add layer" }).click()
  await layers.getByRole("button", { name: "Group active layer" }).click()
  await expect(layers.getByText(/^Group /)).toBeVisible()
  await expect(layers.getByText("Layer 2")).toBeVisible()

  await layers.getByRole("button", { name: "Selected Layer 2" }).click()
  await layers.getByRole("button", { name: "Add mask" }).click()
  await expect(layers.getByRole("button", { name: "Paint mask" })).toBeVisible()
  await layers.getByRole("button", { name: "Paint mask" }).click()
  await layers.getByRole("button", { name: "Disable mask" }).click()
  await expect(
    layers.getByRole("button", { name: "Enable mask" })
  ).toBeVisible()
  await layers.getByRole("button", { name: "Remove mask" }).click()
  await expect(layers.getByRole("button", { name: "Add mask" })).toBeVisible()
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

test("undo and redo are reachable by button and by keystroke", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const undo = page.getByRole("button", { name: "Undo" })
  const redo = page.getByRole("button", { name: "Redo" })
  await expect(undo).toBeDisabled()
  await expect(redo).toBeDisabled()

  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add layer" }).click()
  await expect(layers.getByText("Layer 2")).toBeVisible()
  await expect(undo).toBeEnabled()

  await undo.click()
  await expect(layers.getByText("Layer 2")).toBeHidden()
  await expect(redo).toBeEnabled()

  // The keystroke reaches the engine wherever the pointer happens to be.
  await page.keyboard.press("ControlOrMeta+Shift+z")
  await expect(layers.getByText("Layer 2")).toBeVisible()
  await page.keyboard.press("ControlOrMeta+z")
  await expect(layers.getByText("Layer 2")).toBeHidden()

  // A layer being renamed keeps its own undo: the canvas must not steal it.
  await layers.getByText("Layer 1").dblclick()
  const name = layers.getByRole("textbox", { name: "Layer name" })
  await name.fill("Underpainting")
  await page.keyboard.press("ControlOrMeta+z")
  await expect(layers.getByText("Layer 1")).toBeHidden()
})
