import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"

test("anonymous work offers preservation before account navigation", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByText("Saved on this device")).toBeVisible()
  await expect(
    page.getByRole("link", { name: "Sign in to keep it" })
  ).toHaveAttribute("href", "/signin")
})

test("leaving prompts when durable browser storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", { value: undefined })
  })
  await page.goto("/")
  const prompt = page.waitForEvent("dialog")
  const navigation = page
    .getByRole("link", { name: "Sign in to keep it" })
    .click()
  const dialog = await prompt
  expect(dialog.type()).toBe("beforeunload")
  await dialog.dismiss()
  await navigation
  await expect(page).toHaveURL("/")
})

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

test("the tool rail switches between brush and eraser", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const brush = page.getByRole("button", { name: "Brush tool" })
  const eraser = page.getByRole("button", { name: "Eraser tool" })
  await expect(brush).toHaveAttribute("aria-pressed", "true")
  await eraser.click()
  await expect(eraser).toHaveAttribute("aria-pressed", "true")
  await expect(brush).toHaveAttribute("aria-pressed", "false")
  await brush.click()
  await expect(brush).toHaveAttribute("aria-pressed", "true")
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
  await expect(page.getByRole("button", { name: "Try again" })).toHaveAttribute(
    "data-recovery-action",
    "retry"
  )
  await expect(page.getByRole("status")).toContainText("reload Velura")
})

test("device loss rebuilds automatically and restores the in-progress session", async ({
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
  const layers = page.getByRole("region", { name: "Layers" })
  await layers.getByRole("button", { name: "Add layer" }).click()
  await expect(layers.getByText("Layer 2")).toBeVisible()
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + 40, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 40, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const before = PNG.sync.read(await canvas.screenshot())
  await page.evaluate(() => window.dispatchEvent(new Event("test-device-loss")))
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready",
    { timeout: 10_000 }
  )
  await expect(layers.getByText("Layer 2")).toBeVisible()
  const restored = PNG.sync.read(await canvas.screenshot())
  const offset = (40 * restored.width + 70) * 4
  expect(Array.from(before.data.subarray(offset, offset + 3))).not.toEqual([
    24, 24, 27,
  ])
  expect(Array.from(restored.data.subarray(offset, offset + 3))).not.toEqual([
    24, 24, 27,
  ])
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

test("the canvas is navigated by button and by keystroke", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 })
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const zoom = page.getByLabel("Zoom level")
  await expect(zoom).toHaveText("64%")

  await page.getByRole("button", { name: "Zoom in" }).click()
  await expect(zoom).toHaveText("80%")
  await page.getByRole("button", { name: "Zoom out" }).click()
  await expect(zoom).toHaveText("64%")

  // Unmodified, because the hand reaching for these is not holding the pen.
  await page.keyboard.press("=")
  await expect(zoom).toHaveText("80%")
  // Fitting is the overview; the document is the window's own size, so it
  // comes back a little under a hundred percent with its margin.
  await page.keyboard.press("0")
  await expect(zoom).toHaveText("96%")
  // And shift is the way back to square.
  await page.keyboard.press("Shift+0")
  await expect(zoom).toHaveText("64%")

  const flip = page.getByRole("button", { name: "Flip canvas horizontally" })
  await expect(flip).toHaveAttribute("aria-pressed", "false")
  await flip.click()
  await expect(flip).toHaveAttribute("aria-pressed", "true")
  await page.keyboard.press("h")
  await expect(flip).toHaveAttribute("aria-pressed", "false")

  // The arrows nudge the canvas: the document exactly fills the window, so
  // panning has to reveal the backdrop behind it.
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const square = await canvas.screenshot()
  await page.keyboard.press("ArrowLeft")
  await expect(async () =>
    expect(Buffer.compare(square, await canvas.screenshot())).not.toBe(0)
  ).toPass()
  await page.getByRole("button", { name: "Reset view" }).click()

  // Rotating and then resetting leaves nothing behind: the view is state, and
  // one action returns all of it.
  await page.keyboard.press("]")
  await page.getByRole("button", { name: "Fit canvas to window" }).click()
  await expect(zoom).not.toHaveText("100%")
  await page.getByRole("button", { name: "Reset view" }).click()
  await expect(zoom).toHaveText("64%")
})
