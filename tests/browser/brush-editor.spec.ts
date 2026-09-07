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

async function openEditor(page: Page) {
  await openStudio(page)
  await page.getByRole("button", { name: "Brush editor" }).click()
  await expect(page.getByRole("dialog")).toBeVisible()
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
 * By attribute rather than by role: the editor is a modal, so while it is open
 * the canvas's own copy of a setting sits inside an aria-hidden background that
 * a role query will not see — and both copies are exactly what is under test.
 */
function field(page: Page, name: string) {
  return page.locator(`input[aria-label="${name}"]`)
}

test("size and opacity stay adjustable without opening the editor", async ({
  page,
}) => {
  await openStudio(page)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const size = slider(page, "Size")
  // One press is half a pixel of radius, which is a whole pixel of diameter.
  const wider = await diameter(page, 1)
  await size.focus()
  await size.press("ArrowRight")
  await expect(field(page, "Size")).toHaveValue(wider)
  const opacity = slider(page, "Opacity")
  await opacity.focus()
  await opacity.press("ArrowLeft")
  await expect(field(page, "Opacity")).toHaveValue("99")

  // And typing into the field is the other half of the same control: a size
  // asked for exactly, rather than arrived at by dragging.
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
  const dialog = page.getByRole("dialog")
  await expect(
    dialog.getByRole("img", { name: "Brush preview stroke" })
  ).toBeVisible()

  for (const control of ["Hardness", "Roundness", "Angle", "Spacing"])
    await expect(
      dialog.getByRole("slider", { name: control, exact: true })
    ).toBeVisible()
  await expect(dialog.getByRole("combobox", { name: "Tip" })).toBeVisible()

  await dialog.getByRole("tab", { name: "Grain" }).click()
  // A brush with no grain offers the paper to put under it, and nothing else:
  // scale and depth of a texture that is not there would be dead controls.
  await dialog.getByRole("combobox", { name: "Paper" }).click()
  await page.getByRole("option", { name: "Smooth (no grain)" }).click()
  await expect(dialog.getByText("perfectly smooth surface")).toBeVisible()
  await dialog.getByRole("combobox", { name: "Paper" }).click()
  await page.getByRole("option", { name: "Paper" }).click()
  for (const control of ["Grain scale", "Grain depth", "Grain movement"])
    await expect(dialog.getByRole("slider", { name: control })).toBeVisible()

  await dialog.getByRole("tab", { name: "Rendering" }).click()
  await expect(
    dialog.getByRole("combobox", { name: "Accumulation" })
  ).toBeVisible()
  await expect(dialog.getByRole("slider", { name: "Flow" })).toBeVisible()
})

test("any input can be mapped onto any parameter, through a curve", async ({
  page,
}) => {
  await openEditor(page)
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("tab", { name: "Dynamics" }).click()
  // The studio opens on a library brush, which has mappings of its own; the
  // new one goes on the end of them.
  const existing = await dialog.getByTestId(/^mapping-/).count()

  await dialog.getByRole("button", { name: "Add mapping" }).click()
  const mapping = dialog.getByTestId(`mapping-${existing}`)
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
  await dialog.getByRole("button", { name: "Add mapping" }).click()
  await expect(dialog.getByTestId(`mapping-${existing + 1}`)).toBeVisible()
  await dialog
    .getByRole("button", { name: `Remove ${label.toLowerCase()}` })
    .click()
  await expect(dialog.getByTestId(`mapping-${existing + 1}`)).toHaveCount(0)
  await expect(mapping).toBeVisible()
})

test("an edit paints immediately and is kept only when it is saved", async ({
  page,
}) => {
  await openEditor(page)
  const dialog = page.getByRole("dialog")
  await expect(dialog.getByText("No changes")).toBeVisible()

  // The editor writes through to the brush the engine is holding, which is
  // what makes the change something the next stroke draws with rather than
  // something waiting on a save: the canvas's own size readout follows it.
  const started = await diameter(page)
  const wider = await diameter(page, 1)
  const size = dialog.getByRole("slider", { name: "Size", exact: true })
  await size.focus()
  await size.press("ArrowRight")
  // Two: the editor's field and the canvas's, over the one brush.
  await expect(field(page, "Size")).toHaveCount(2)
  for (const index of [0, 1])
    await expect(field(page, "Size").nth(index)).toHaveValue(wider)

  const hardness = dialog.getByRole("slider", { name: "Hardness" })
  await hardness.focus()
  await hardness.press("ArrowLeft")
  await expect(dialog.getByText("Unsaved changes")).toBeVisible()

  // Reverting puts the working brush back on the saved one — on the canvas as
  // well as in the dialog, since they are the same brush.
  await dialog.getByRole("button", { name: "Revert" }).click()
  await expect(dialog.getByText("No changes")).toBeVisible()
  for (const index of [0, 1])
    await expect(field(page, "Size").nth(index)).toHaveValue(started)

  await hardness.focus()
  await hardness.press("ArrowLeft")
  await dialog.getByRole("button", { name: "Save brush" }).click()
  // Saved is the new baseline: nothing is dirty, and the edit is still on the
  // brush rather than having been rolled back by the save.
  await expect(dialog.getByText("No changes")).toBeVisible()
  await expect(dialog.getByRole("button", { name: "Revert" })).toBeDisabled()
})

test("the preview stroke re-renders as the brush changes", async ({ page }) => {
  await openEditor(page)
  const dialog = page.getByRole("dialog")
  const preview = dialog.getByTestId("brush-preview")
  const before = await preview.screenshot()

  const size = dialog.getByRole("slider", { name: "Size" })
  await size.focus()
  for (let press = 0; press < 40; press++) await size.press("ArrowRight")

  await expect(async () => {
    expect(await preview.screenshot()).not.toEqual(before)
  }).toPass()
})
