import { expect, test, type Page } from "@playwright/test"
import { PNG } from "pngjs"

/**
 * Feathering is a command (11, 04): found in the palette, asked for a radius,
 * and applied to the selection as one step — so a stroke across the edge
 * fades out rather than stopping dead.
 */

// A smaller window than the default: while there is a selection its ants
// recomposite the whole canvas on a timer, and on CI's software WebGPU a
// full-size canvas leaves the page too little time to do anything else.
test.use({ viewport: { width: 900, height: 500 } })

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  return (await canvas.boundingBox())!
}

async function featherInPalette(page: Page) {
  await page.keyboard.press("ControlOrMeta+k")
  const search = page.getByRole("combobox", { name: "Search commands" })
  await expect(search).toBeFocused()
  await search.fill("feather")
  return page.getByRole("option", { name: /Feather selection/ })
}

/**
 * How dark the stroke is at each of `xs`, along the line `y`: 0 for white,
 * 255 for black, each averaged over an 8×5 patch to even out the brush's
 * grain. One screenshot for them all, since on CI's software WebGPU each one
 * is a frame that takes seconds.
 */
async function darknessAlong(page: Page, y: number, xs: readonly number[]) {
  const left = Math.round(Math.min(...xs)) - 4
  const right = Math.round(Math.max(...xs)) + 4
  const top = Math.round(y) - 2
  const shot = PNG.sync.read(
    await page.screenshot({
      clip: { x: left, y: top, width: right - left, height: 5 },
    })
  )
  return xs.map((x) => {
    let sum = 0
    for (let row = 0; row < 5; row++)
      for (let column = 0; column < 8; column++) {
        const at = (row * shot.width + (Math.round(x) - 4 - left + column)) * 4
        sum +=
          255 - (shot.data[at]! + shot.data[at + 1]! + shot.data[at + 2]!) / 3
      }
    return sum / 40
  })
}

test("feather selection runs from the palette, asks a radius, and softens a stroke's edge", async ({
  page,
}) => {
  // Two strokes and their screenshots: more than CI's default allowance.
  test.slow()
  const box = await openStudio(page)
  // The selection's right edge, and the line strokes are drawn along: clear
  // of the rail on the left and the layers panel on the right.
  const edgeX = box.x + 400
  const cy = box.y + 260

  // Without a selection the command is listed but cannot run.
  const option = await featherInPalette(page)
  await expect(option).toHaveAttribute("aria-disabled", "true")
  await page.keyboard.press("Escape")
  // Gone, not just closing: a drag under its overlay would never reach the
  // canvas.
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // A rectangle selection, ending at `edgeX`.
  await page.keyboard.press("m")
  await page.mouse.move(edgeX - 250, cy - 60)
  await page.mouse.down()
  await page.mouse.move(edgeX, cy + 60, { steps: 8 })
  await page.mouse.up()

  const enabled = await featherInPalette(page)
  await expect(enabled).toHaveAttribute("aria-disabled", "false")
  await page.keyboard.press("Enter")
  const dialog = page.getByRole("dialog", { name: "Feather selection" })
  await expect(dialog).toBeVisible()
  const radius = dialog.getByRole("textbox", { name: "Feather radius" })
  await radius.fill("24")
  await radius.press("Enter")
  // Pressed without waiting for a still frame, which the ants make rare.
  await dialog.getByRole("button", { name: "Apply" }).dispatchEvent("click")
  await expect(page.getByRole("dialog")).toHaveCount(0)

  // A stroke from well inside the selection to well outside it, measured
  // where it crosses the edge, then taken back.
  // Undone by key rather than by clicking the button: with marching ants
  // redrawing on a timer, CI's software WebGPU leaves Playwright no quiet
  // frames to find the button stable in, and a click waits for one.
  const undo = async () => {
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled()
    await page.keyboard.press("ControlOrMeta+z")
  }
  async function strokeAcross() {
    await page.keyboard.press("b")
    await page.mouse.move(edgeX - 200, cy)
    await page.mouse.down()
    // Few pointer events: the stroke is resampled between them anyway, and
    // each one is a frame CI's software WebGPU is slow to draw.
    await page.mouse.move(edgeX + 100, cy, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const [inside, edge, beyond, far] = await darknessAlong(page, cy, [
      edgeX - 160,
      edgeX,
      edgeX + 12,
      edgeX + 80,
    ])
    const measured = {
      inside: inside!,
      edge: edge!,
      beyond: beyond!,
      far: far!,
    }
    await undo()
    return measured
  }

  // Full ink deep inside, nothing far outside, and between them a fade that
  // carries past where a hard edge would have cut it off.
  const soft = await strokeAcross()
  expect(soft.inside).toBeGreaterThan(40)
  expect(soft.far).toBeLessThan(2)
  expect(soft.edge).toBeLessThan(soft.inside * 0.8)
  expect(soft.beyond).toBeGreaterThan(soft.far + 2)

  // One step: a single undo puts the hard edge back, selection and all.
  await undo()
  const hard = await strokeAcross()
  expect(hard.inside).toBeGreaterThan(40)
  expect(hard.beyond).toBeLessThan(2)
})
