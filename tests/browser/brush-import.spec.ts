import { expect, test, type Page } from "@playwright/test"

/**
 * Importing brushes from Krita and GIMP (brush library 07), and the editor's
 * Scatter and Colour sections.
 *
 * The files are built here rather than committed, as the unit fixtures are:
 * a `.kpp` is a PNG with the preset in a `tEXt` chunk, and a `.gih` is a
 * header line and GIMP brushes back to back. What is claimed is what an
 * artist would see: the brush arrives in their library, says what it lost,
 * and paints.
 */

function words(...values: number[]): Buffer {
  const out = Buffer.alloc(values.length * 4)
  values.forEach((value, i) => out.writeUInt32BE(value, i * 4))
  return out
}

function kpp(engine: string, ...params: string[]): Buffer {
  const xml = `<Preset name="b)_Imported_Round" paintopid="${engine}">${params.join("")}</Preset>`
  const chunk = (type: string, data: Buffer) =>
    Buffer.concat([
      words(data.length),
      Buffer.from(type),
      data,
      Buffer.alloc(4),
    ])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("tEXt", Buffer.from(`preset\0${xml}`, "latin1")),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

/** A greyscale GIMP brush: a filled disc, ink where it is 255. */
function gbr(name: string, size: number): Buffer {
  const label = Buffer.from(`${name}\0`)
  const pixels = Buffer.alloc(size * size)
  const centre = (size - 1) / 2
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (Math.hypot(x - centre, y - centre) <= size / 2 - 1)
        pixels[y * size + x] = 255
  return Buffer.concat([
    words(28 + label.length, 2, size, size, 1),
    Buffer.from("GIMP"),
    words(30),
    label,
    pixels,
  ])
}

function gih(name: string, cells: Buffer[]): Buffer {
  return Buffer.concat([
    Buffer.from(
      `${name}\n${cells.length} ncells:${cells.length} sel0:random\n`
    ),
    ...cells,
  ])
}

async function openLibrary(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: /^Choose brush:/ }).click()
  await expect(page.getByTestId("brush-library")).toBeVisible()
}

async function importFiles(
  page: Page,
  files: { name: string; buffer: Buffer }[]
) {
  await page
    .getByTestId("brush-library")
    .getByLabel("Import brush")
    .setInputFiles(
      files.map((file) => ({ ...file, mimeType: "application/octet-stream" }))
    )
}

/** Paints one stroke across the canvas and says whether it left a mark. */
async function paintsAMark(page: Page) {
  await page.keyboard.press("Escape")
  const canvas = page.locator("canvas").first()
  const box = (await canvas.boundingBox())!
  const before = await canvas.screenshot()
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + 80, y)
  await page.mouse.down()
  await page.mouse.move(box.x + 260, y + 30, { steps: 25 })
  await page.mouse.up()
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled()
  await expect(async () => {
    expect(await canvas.screenshot()).not.toEqual(before)
  }).toPass()
}

test("a Krita preset is imported, reports what it lost, and paints", async ({
  page,
}) => {
  await openLibrary(page)
  await importFiles(page, [
    {
      name: "b)_Imported_Round.kpp",
      buffer: kpp(
        "paintbrush",
        `<param type="string" name="brush_definition"><![CDATA[<Brush type="auto_brush" spacing="0.1"><MaskGenerator diameter="24" hfade="0.8" vfade="0.8" type="circle"/></Brush>]]></param>`,
        `<param type="internal" name="HorizontalMirrorEnabled">true</param>`
      ),
    },
  ])
  const report = page.getByRole("region", { name: "Import report" })
  await expect(report.getByText("Imported 1 brush")).toBeVisible()
  await expect(report.getByText("Imported Round")).toBeVisible()
  await expect(report.getByText("mirroring")).toBeVisible()

  // Shelved in the artist's own library, and already in the hand.
  const library = page.getByTestId("brush-library")
  await expect(
    library.getByRole("heading", { name: "Imported", exact: true })
  ).toBeVisible()
  await expect(
    library.getByRole("button", { name: "Paint with Imported Round" })
  ).toHaveAttribute("aria-pressed", "true")
  // By attribute: the library is open, and modal, so the rail is hidden
  // from the accessibility tree.
  await expect(
    page.locator('button[aria-label="Choose brush: Imported Round"]')
  ).toBeVisible()
  await paintsAMark(page)
})

test("a GIMP image hose is imported as a tip set and paints", async ({
  page,
}) => {
  await openLibrary(page)
  await importFiles(page, [
    {
      name: "pebbles.gih",
      buffer: gih("Pebbles", [gbr("a", 24), gbr("b", 16)]),
    },
  ])
  await expect(page.getByText("Imported 1 brush")).toBeVisible()
  await expect(
    page.locator('button[aria-label="Choose brush: Pebbles"]')
  ).toBeVisible()
  await paintsAMark(page)

  // The editor shows the imported tip set, picking a frame at random.
  await page.getByRole("button", { name: "Brush editor" }).click()
  const editor = page.getByRole("region", { name: "Brush editor" })
  await expect(editor.getByRole("combobox", { name: "Tip" })).toHaveText(
    /Pebbles/i
  )
  await expect(
    editor.getByRole("combobox", { name: "Frame selection" })
  ).toHaveText("Random")
})

test("a preset for another Krita engine is refused with the reason", async ({
  page,
}) => {
  await openLibrary(page)
  await importFiles(page, [{ name: "smudge.kpp", buffer: kpp("colorsmudge") }])
  await expect(
    page.getByText(
      "smudge.kpp: Only Krita's pixel brush engine can be imported, not colorsmudge."
    )
  ).toBeVisible()
})

async function openEditor(page: Page) {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Brush editor" }).click()
  return page.getByRole("region", { name: "Brush editor" })
}

test("scatter and colour are edited with a live preview", async ({ page }) => {
  const editor = await openEditor(page)
  const preview = editor.getByTestId("brush-preview")

  await editor.getByRole("tab", { name: "Scatter" }).click()
  let before = await preview.screenshot()
  const amount = editor.getByRole("slider", { name: "Scatter amount" })
  await amount.focus()
  for (let press = 0; press < 40; press++) await amount.press("ArrowRight")
  await expect(async () => {
    expect(await preview.screenshot()).not.toEqual(before)
  }).toPass()
  await expect(editor.getByText("Unsaved changes")).toBeVisible()

  await editor.getByRole("tab", { name: "Colour" }).click()
  before = await preview.screenshot()
  await editor.getByRole("button", { name: "Vary hue per dab" }).click()
  await expect(async () => {
    expect(await preview.screenshot()).not.toEqual(before)
  }).toPass()
  await expect(
    editor.getByRole("button", { name: "Vary hue per dab" })
  ).toHaveCount(0)
})

test("a scatter mapping with no amount to scale is flagged and converted", async ({
  page,
}) => {
  const editor = await openEditor(page)
  await editor.getByRole("tab", { name: "Dynamics" }).click()
  await editor.getByRole("button", { name: "Add mapping" }).click()
  const last = editor.locator("[data-testid^=mapping-]").last()
  await last.getByRole("combobox", { name: /parameter$/ }).click()
  await page.getByRole("option", { name: "Scatter" }).click()
  await last.getByRole("combobox", { name: /mix$/ }).click()
  await page.getByRole("option", { name: "Adds to it" }).click()

  await editor.getByRole("tab", { name: "Scatter" }).click()
  const flag = editor.getByRole("status").filter({ hasText: "throws nothing" })
  await expect(flag).toBeVisible()
  await flag.getByRole("button", { name: "Convert to an amount" }).click()
  await expect(flag).toHaveCount(0)
  await expect(
    editor.getByRole("slider", { name: "Scatter amount" })
  ).not.toHaveAttribute("aria-valuenow", "0")
})
