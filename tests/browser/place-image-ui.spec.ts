import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * The three routes an image takes into the artwork: the panel's button, a file
 * dropped on the canvas, and a paste. They differ only in where the file comes
 * from, so what is checked here is that each of them reaches the same place —
 * a new layer, named and selected.
 */

/** A small opaque red PNG, as a file would arrive. */
function redPng(size = 8): Buffer {
  const png = new PNG({ width: size, height: size })
  for (let at = 0; at < png.data.length; at += 4) {
    png.data[at] = 255
    png.data[at + 1] = 0
    png.data[at + 2] = 0
    png.data[at + 3] = 255
  }
  return PNG.sync.write(png)
}

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  return page.getByRole("region", { name: "Layers" })
}

/** A `DataTransfer` in the page, carrying one file. */
async function transferWith(page: Page, name: string, bytes: Buffer) {
  return page.evaluateHandle(
    ([fileName, encoded]) => {
      const binary = atob(encoded)
      const data = new Uint8Array(binary.length)
      for (let at = 0; at < binary.length; at++)
        data[at] = binary.charCodeAt(at)
      const transfer = new DataTransfer()
      transfer.items.add(new File([data], fileName, { type: "image/png" }))
      return transfer
    },
    [name, bytes.toString("base64")] as const
  )
}

test("the panel's button places an image on a layer of its own", async ({
  page,
}) => {
  const layers = await openStudio(page)
  // The button is what the artist uses; the input behind it is what the file
  // arrives through, so the test drives the same pair.
  await expect(
    layers.getByRole("button", { name: "Place an image on its own layer" })
  ).toBeVisible()
  await layers.locator('input[type="file"]').setInputFiles({
    name: "Reference.png",
    mimeType: "image/png",
    buffer: redPng(),
  })

  // Named after the file, so the panel says which picture this is, and
  // selected, so the next stroke does not land on it by surprise.
  await expect(layers.getByText("Reference")).toBeVisible()
  await expect(
    layers.getByRole("button", { name: "Selected Reference" })
  ).toBeVisible()
  await expect(layers.getByText("Layer 1")).toBeVisible()
})

test("an image dropped on the canvas lands on its own layer", async ({
  page,
}) => {
  const layers = await openStudio(page)
  const transfer = await transferWith(page, "Dropped.png", redPng())
  const main = page.getByRole("main")

  await main.dispatchEvent("dragover", { dataTransfer: transfer })
  await expect(
    page.getByText("Drop to place the image on its own layer")
  ).toBeVisible()

  await main.dispatchEvent("drop", { dataTransfer: transfer })
  await expect(layers.getByText("Dropped")).toBeVisible()
  await expect(
    page.getByText("Drop to place the image on its own layer")
  ).toBeHidden()
})

test("a dropped file that is not an image says so rather than vanishing", async ({
  page,
}) => {
  await openStudio(page)
  const transfer = await page.evaluateHandle(() => {
    const carried = new DataTransfer()
    carried.items.add(new File(["notes"], "notes.txt", { type: "text/plain" }))
    return carried
  })
  await page.getByRole("main").dispatchEvent("drop", { dataTransfer: transfer })
  await expect(page.getByText("That file is not an image.")).toBeVisible()
})

test("a pasted image lands on its own layer", async ({ page }) => {
  const layers = await openStudio(page)
  const transfer = await transferWith(page, "Pasted.png", redPng())
  await page.evaluate((clipboardData) => {
    window.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, cancelable: true })
    )
  }, transfer)
  await expect(layers.getByText("Pasted")).toBeVisible()
})

test("pasting into a field being typed in is left to the field", async ({
  page,
}) => {
  const layers = await openStudio(page)
  await layers.getByText("Layer 1").dblclick()
  const name = layers.getByRole("textbox", { name: "Layer name" })
  const transfer = await transferWith(page, "Ignored.png", redPng())
  await name.evaluate((field, clipboardData) => {
    field.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        cancelable: true,
        bubbles: true,
      })
    )
  }, transfer)
  await expect(layers.getByText("Ignored")).toBeHidden()
})

test("the refusal offers the way through, and the panel offers it too", async ({
  page,
}) => {
  const layers = await openStudio(page)
  await layers.locator('input[type="file"]').setInputFiles({
    name: "Reference.png",
    mimeType: "image/png",
    buffer: redPng(),
  })
  await expect(layers.getByText("Reference")).toBeVisible()

  // Both doors are open before the artist has chosen: the panel's action, and
  // the refusal's, for whoever meets the wall with the pen already down.
  await expect(
    layers.getByRole("button", { name: /^Paint on Reference/ })
  ).toBeVisible()

  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  await canvas.click({ position: { x: 300, y: 300 } })
  await expect(page.getByText("is a placed photo")).toBeVisible()
  // The mask is named, so the non-destructive answer is not a secret.
  await expect(
    page.getByText("A mask hides parts without changing it.")
  ).toBeVisible()
  await page.getByRole("button", { name: "Paint on it" }).click()

  // Converted: the action is gone from the panel, and the pen is never
  // refused on this layer again.
  await expect(
    layers.getByRole("button", { name: /^Paint on Reference/ })
  ).toBeHidden()
  await expect(page.getByText("is a placed photo")).toBeHidden()
  await canvas.click({ position: { x: 320, y: 320 } })
  await expect(page.getByText("is a placed photo")).toBeHidden()
})

test("a placed image can be moved from the panel, and the move cancelled", async ({
  page,
}) => {
  // The way in (06): the panel offers it while the layer is still an image
  // layer, and the box on the canvas is what the artist then drags.
  const layers = await openStudio(page)
  await layers.locator('input[type="file"]').setInputFiles({
    name: "Reference.png",
    mimeType: "image/png",
    buffer: redPng(64),
  })
  await expect(layers.getByText("Reference")).toBeVisible()

  await layers
    .getByRole("button", { name: "Move, scale or rotate Reference" })
    .click()
  const box = page.getByTestId("image-transform")
  await expect(box).toBeVisible()
  // The honest readout: at the size it was placed, the picture is at its own
  // resolution and says so.
  await expect(page.getByTestId("transform-resolution")).toContainText("%")

  // Nudged with the keyboard, which is how a placement is put exactly where
  // it belongs, then taken back — and taking it back leaves no box behind.
  await page.keyboard.press("ArrowRight")
  await page.keyboard.press("Escape")
  await expect(box).toBeHidden()

  // Offered no more once the picture has been handed to the pen: there is no
  // original left to re-render from.
  await layers
    .getByRole("button", { name: "Paint on Reference (changes the photo)" })
    .click()
  await expect(
    layers.getByRole("button", { name: "Move, scale or rotate Reference" })
  ).toBeHidden()
})
