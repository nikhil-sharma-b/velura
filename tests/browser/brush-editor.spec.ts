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

test("size and opacity stay adjustable without opening the editor", async ({
  page,
}) => {
  await openStudio(page)
  await expect(page.getByRole("dialog")).toHaveCount(0)
  const size = slider(page, "Size")
  await size.focus()
  await size.press("ArrowRight")
  await expect(page.getByText("13.0 px")).toBeVisible()
  const opacity = slider(page, "Opacity")
  await opacity.focus()
  await opacity.press("ArrowLeft")
  await expect(page.getByText("99%")).toBeVisible()
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
  await expect(dialog.getByText("Add a mapping")).toBeVisible()

  await dialog.getByRole("button", { name: "Add mapping" }).click()
  const mapping = dialog.getByTestId("mapping-0")
  await expect(mapping).toBeVisible()
  // The curve is the pressure-curve widget the repo already had, over the same
  // engine spline the graph is evaluated with.
  await expect(
    mapping.getByRole("application", { name: "Pressure curve editor" })
  ).toBeVisible()

  // Any source onto any target: speed onto roundness is nothing like the
  // pressure-onto-size a mapping is born as.
  await mapping.getByRole("combobox", { name: "Mapping 1 input" }).click()
  await page.getByRole("option", { name: "Speed" }).click()
  await mapping.getByRole("combobox", { name: "Mapping 1 parameter" }).click()
  await page.getByRole("option", { name: "Roundness" }).click()
  await expect(
    mapping.getByRole("combobox", { name: "Mapping 1 input" })
  ).toContainText("Speed")

  // A second mapping stands beside the first, and either can be taken away.
  await dialog.getByRole("button", { name: "Add mapping" }).click()
  await expect(dialog.getByTestId("mapping-1")).toBeVisible()
  await dialog.getByRole("button", { name: "Remove mapping 1" }).click()
  await expect(dialog.getByTestId("mapping-1")).toHaveCount(0)
  await expect(dialog.getByTestId("mapping-0")).toBeVisible()
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
  const size = dialog.getByRole("slider", { name: "Size", exact: true })
  await size.focus()
  await size.press("ArrowRight")
  await expect(page.getByText("13.0 px")).toHaveCount(2)

  const hardness = dialog.getByRole("slider", { name: "Hardness" })
  await hardness.focus()
  await hardness.press("ArrowLeft")
  await expect(dialog.getByText("Unsaved changes")).toBeVisible()

  // Reverting puts the working brush back on the saved one — on the canvas as
  // well as in the dialog, since they are the same brush.
  await dialog.getByRole("button", { name: "Revert" }).click()
  await expect(dialog.getByText("No changes")).toBeVisible()
  await expect(page.getByText("12.0 px")).toHaveCount(2)

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
