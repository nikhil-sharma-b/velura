import { expect, test, type Page } from "@playwright/test"

/**
 * The brush editor (D32).
 *
 * What is under test here is the editor as a tool: that every part of a brush
 * is reachable, that a mapping can be made and unmade, and — the claim the
 * ticket actually rests on — that an edit reaches the brush in the hand while
 * the saved brush stays where it was. How the parameters then reach pixels is
 * covered by the stroke and texture specs, and the graph itself by the
 * dynamics unit tests.
 */

async function openStudio(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
}

/** The docked editor: a region of the studio, not a panel over it. */
function editor(page: Page) {
  return page.getByRole("region", { name: "Brush editor" })
}

async function openEditor(page: Page) {
  await openStudio(page)
  await page.getByRole("button", { name: "Brush editor" }).click()
  await expect(editor(page)).toBeVisible()
}

/**
 * One slider by its label. Exact, because the layer panel has an opacity of
 * its own and the brush's is not it.
 */
function slider(page: Page, name: string) {
  return page.getByRole("slider", { name, exact: true })
}

/**
 * The diameter the size field holds, in the "12.0" form it is written in — the
 * unit sits beside the field, so the value alone is what is compared.
 *
 * Read rather than assumed: the studio opens on a brush from the library (25),
 * so what size it starts at is a property of that brush and not of this spec.
 * What is under test is that the control moves it, not what it moves it from.
 */
async function diameter(page: Page, offsetPixels = 0): Promise<string> {
  const radius = Number(
    await slider(page, "Size").getAttribute("aria-valuenow")
  )
  return `${(radius * 2 + offsetPixels).toFixed(1)}`
}

/**
 * The typed field of a setting, as against its slider.
 *
 * By attribute rather than by role: the size popover and the editor each carry
 * a copy of a setting under the same name, and both are what is under test.
 */
function field(page: Page, name: string) {
  return page.locator(`input[aria-label="${name}"]`)
}

test("size and opacity stay adjustable without opening the editor", async ({
  page,
}) => {
  await openStudio(page)
  await expect(editor(page)).toHaveCount(0)
  await page.getByRole("button", { name: /^Size:/ }).click()
  const size = slider(page, "Size")
  // One press is half a pixel of radius, which is a whole pixel of diameter.
  const wider = await diameter(page, 1)
  await size.focus()
  await size.press("ArrowRight")
  await expect(field(page, "Size")).toHaveValue(wider)
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /^Opacity:/ }).click()
  const opacity = slider(page, "Opacity")
  await opacity.focus()
  await opacity.press("ArrowLeft")
  await expect(field(page, "Opacity")).toHaveValue("99")

  // And typing into the field is the other half of the same control: a size
  // asked for exactly, rather than arrived at by dragging.
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: /^Size:/ }).click()
  await field(page, "Size").fill("48")
  await field(page, "Size").press("Enter")
  await expect(slider(page, "Size")).toHaveAttribute("aria-valuenow", "24")

  // Arrows step it by the same amount the slider moves by — a whole pixel of
  // diameter — and shift takes ten at a time.
  await field(page, "Size").press("ArrowUp")
  await expect(field(page, "Size")).toHaveValue("49.0")
  await field(page, "Size").press("Shift+ArrowDown")
  await expect(field(page, "Size")).toHaveValue("39.0")
  await expect(slider(page, "Size")).toHaveAttribute("aria-valuenow", "19.5")
})

test("the editor covers shape, grain, rendering and dynamics", async ({
  page,
}) => {
  await openEditor(page)
  const panel = editor(page)
  await expect(
    panel.getByRole("img", { name: "Brush preview stroke" })
  ).toBeVisible()

  for (const control of ["Hardness", "Roundness", "Angle", "Spacing"])
    await expect(
      panel.getByRole("slider", { name: control, exact: true })
    ).toBeVisible()
  await expect(panel.getByRole("combobox", { name: "Tip" })).toBeVisible()

  await panel.getByRole("tab", { name: "Grain" }).click()
  // A brush with no grain offers the paper to put under it, and nothing else:
  // scale and depth of a texture that is not there would be dead controls.
  await panel.getByRole("combobox", { name: "Paper" }).click()
  await page.getByRole("option", { name: "Smooth (no grain)" }).click()
  await expect(panel.getByText("perfectly smooth surface")).toBeVisible()
  await panel.getByRole("combobox", { name: "Paper" }).click()
  await page.getByRole("option", { name: "Paper" }).click()
  for (const control of ["Grain scale", "Grain depth", "Grain movement"])
    await expect(panel.getByRole("slider", { name: control })).toBeVisible()

  await panel.getByRole("tab", { name: "Rendering" }).click()
  await expect(
    panel.getByRole("combobox", { name: "Accumulation" })
  ).toBeVisible()
  await expect(panel.getByRole("slider", { name: "Flow" })).toBeVisible()
})

test("any input can be mapped onto any parameter, through a curve", async ({
  page,
}) => {
  await openEditor(page)
  const panel = editor(page)
  await panel.getByRole("tab", { name: "Dynamics" }).click()
  // The studio opens on a library brush, which has mappings of its own; the
  // new one goes on the end of them.
  const existing = await panel.getByTestId(/^mapping-/).count()

  await panel.getByRole("button", { name: "Add mapping" }).click()
  const mapping = panel.getByTestId(`mapping-${existing}`)
  await expect(mapping).toBeVisible()
  // The curve is the pressure-curve widget the repo already had, over the same
  // engine spline the graph is evaluated with.
  await expect(
    mapping.getByRole("application", { name: "Pressure curve editor" })
  ).toBeVisible()

  // Any source onto any target: speed onto roundness is nothing like the
  // pressure-onto-size a mapping is born as.
  const label = `Mapping ${existing + 1}`
  await mapping.getByRole("combobox", { name: `${label} input` }).click()
  await page.getByRole("option", { name: "Speed" }).click()
  await mapping.getByRole("combobox", { name: `${label} parameter` }).click()
  await page.getByRole("option", { name: "Roundness" }).click()
  await expect(
    mapping.getByRole("combobox", { name: `${label} input` })
  ).toContainText("Speed")

  // A further mapping stands beside it, and either can be taken away.
  await panel.getByRole("button", { name: "Add mapping" }).click()
  await expect(panel.getByTestId(`mapping-${existing + 1}`)).toBeVisible()
  await panel
    .getByRole("button", { name: `Remove ${label.toLowerCase()}` })
    .click()
  await expect(panel.getByTestId(`mapping-${existing + 1}`)).toHaveCount(0)
  await expect(mapping).toBeVisible()
})

test("an edit paints immediately and is kept only when it is saved", async ({
  page,
}) => {
  await openEditor(page)
  const panel = editor(page)
  await expect(panel.getByText("No changes")).toBeVisible()

  // The editor writes through to the brush the engine is holding, which is
  // what makes the change something the next stroke draws with rather than
  // something waiting on a save: the canvas's own size readout follows it.
  const started = await diameter(page)
  const wider = await diameter(page, 1)
  const size = panel.getByRole("slider", { name: "Size", exact: true })
  await size.focus()
  await size.press("ArrowRight")
  await expect(field(page, "Size")).toHaveValue(wider)
  await expect(
    page.locator(`button[aria-label="Size: ${wider} px"]`)
  ).toHaveCount(1)

  const hardness = panel.getByRole("slider", { name: "Hardness" })
  await hardness.focus()
  await hardness.press("ArrowLeft")
  await expect(panel.getByText("Unsaved changes")).toBeVisible()

  // Reverting puts the working brush back on the saved one — on the canvas as
  // well as in the editor, since they are the same brush.
  await panel.getByRole("button", { name: "Revert" }).click()
  await expect(panel.getByText("No changes")).toBeVisible()
  await expect(field(page, "Size")).toHaveValue(started)
  await expect(
    page.locator(`button[aria-label="Size: ${started} px"]`)
  ).toHaveCount(1)

  await hardness.focus()
  await hardness.press("ArrowLeft")
  await panel.getByRole("button", { name: "Save brush" }).click()
  // Saved is the new baseline: nothing is dirty, and the edit is still on the
  // brush rather than having been rolled back by the save.
  await expect(panel.getByText("No changes")).toBeVisible()
  await expect(panel.getByRole("button", { name: "Revert" })).toBeDisabled()
})

test("the preview stroke re-renders as the brush changes", async ({ page }) => {
  await openEditor(page)
  const panel = editor(page)
  const preview = panel.getByTestId("brush-preview")
  const before = await preview.screenshot()

  const size = panel.getByRole("slider", { name: "Size" })
  await size.focus()
  for (let press = 0; press < 40; press++) await size.press("ArrowRight")

  await expect(async () => {
    expect(await preview.screenshot()).not.toEqual(before)
  }).toPass()
})

test("the editor stays open beside the canvas while a stroke is painted", async ({
  page,
}) => {
  await openEditor(page)
  const panel = editor(page)
  // Nothing modal: no dialog, and the canvas is still in the accessibility
  // tree rather than hidden behind a backdrop.
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const canvas = page.locator("canvas").first()
  await expect(canvas).not.toHaveAttribute("aria-hidden", "true")

  // The mark is made on the canvas left of the column the editor docks in.
  const box = (await canvas.boundingBox())!
  const panelBox = (await panel.boundingBox())!
  expect(panelBox.x - box.x).toBeGreaterThan(200)
  const y = box.y + box.height / 2
  const undo = page.getByRole("button", { name: "Undo" })
  await expect(undo).toBeDisabled()
  await page.mouse.move(box.x + 100, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 180, y, { steps: 20 })
  await page.mouse.up()
  await expect(undo).toBeEnabled()
  await expect(panel).toBeVisible()
})

test("the editor is dismissed from the keyboard and leaves the canvas keys alone", async ({
  page,
}) => {
  await openEditor(page)
  const panel = editor(page)
  const size = panel.getByRole("slider", { name: "Size", exact: true })
  const radius = Number(await size.getAttribute("aria-valuenow"))

  // Arrows on the editor's own slider move the slider, and only once.
  await size.focus()
  await size.press("ArrowRight")
  await expect(size).toHaveAttribute("aria-valuenow", String(radius + 0.5))

  // The bracket keys still size the brush while the editor is open.
  await page
    .locator("canvas")
    .first()
    .click({ position: { x: 5, y: 5 } })
  await page.keyboard.press("]")
  await expect(size).not.toHaveAttribute("aria-valuenow", String(radius + 0.5))

  // Escape inside the editor closes it and hands focus back to its button.
  await panel.getByRole("tab", { name: "Shape" }).focus()
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Brush editor" })).toBeFocused()
})

test("at the narrowest window the editor leaves canvas to paint on", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 600 })
  await openEditor(page)
  const panelBox = (await editor(page).boundingBox())!
  // Half the window is still canvas beside the docked column.
  expect(panelBox.x).toBeGreaterThan(768 / 2)
})
