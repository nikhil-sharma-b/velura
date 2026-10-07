import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import { BUILTIN_VECTOR_BRUSHES } from "../../engine/brush/vector-brush"

test("the solid vector brush sets its tapers from the tool options", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page
    .getByRole("region", { name: "Layers" })
    .getByRole("button", { name: "Add vector layer" })
    .click()
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  // Pressure is the default, with no taper to set.
  await expect(page.getByRole("button", { name: /^Taper:/ })).toHaveCount(0)
  const rails = page.getByTestId("tool-rails")
  const railHeight = (await rails.boundingBox())!.height
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await page
    .getByRole("dialog", { name: "Choose a vector brush" })
    .getByRole("button", { name: /Solid vector brush/ })
    .click()
  const taper = page.getByRole("button", { name: /^Taper:/ })
  await expect(taper).toHaveAccessibleName("Taper: None")
  // It joins the tool's own options, not the rail, which keeps its height.
  await expect(
    page.getByTestId("tool-options").getByRole("button", { name: /^Taper:/ })
  ).toBeVisible()
  expect((await rails.boundingBox())!.height).toBe(railHeight)
  await taper.click()
  for (const [name, value] of [
    ["Start taper", "30"],
    ["End taper", "50"],
  ]) {
    const field = page.getByRole("textbox", { name })
    await field.fill(value)
    await field.press("Enter")
  }
  await page.keyboard.press("Escape")
  await expect(taper).toHaveAccessibleName("Taper: Start 30%, end 50%")
})

test("pick a preset, draw, and apply another preset to the selected stroke", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page
    .getByRole("region", { name: "Layers" })
    .getByRole("button", { name: "Add vector layer" })
    .click()
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await page
    .getByRole("button", { name: "Solid vector brush", exact: true })
    .click()
  const box = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  await page.mouse.move(x - 100, y)
  await page.mouse.down()
  await page.mouse.move(x + 100, y, { steps: 20 })
  await page.mouse.up()
  await page
    .getByRole("button", { name: "Select objects", exact: true })
    .click()
  await page.mouse.click(x, y)
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await page
    .getByRole("button", { name: "Pressure vector brush", exact: true })
    .click()
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await expect(
    page.getByRole("button", { name: "Apply brush", exact: true })
  ).toBeEnabled()
  await page.getByRole("button", { name: "Apply brush", exact: true }).click()
  // One undo restores the restyling and leaves the original stroke selected.
  await page.keyboard.press("ControlOrMeta+z")
  await page.getByRole("button", { name: /^Choose vector brush/ }).click()
  await expect(
    page.getByRole("button", { name: "Apply brush", exact: true })
  ).toBeEnabled()
})

test("custom vector brushes can be created, renamed, duplicated, reloaded and deleted", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  const picker = page.getByRole("button", { name: /^Choose vector brush/ })
  await picker.click()
  await page.getByRole("button", { name: "New brush", exact: true }).click()
  await page.getByRole("textbox", { name: "Vector brush name" }).fill("My pen")
  await page.getByRole("button", { name: "Save vector brush" }).click()
  await expect(picker).toHaveAccessibleName("Choose vector brush: My pen")
  await picker.click()
  await page.getByRole("button", { name: "Edit My pen", exact: true }).click()
  await page.getByRole("textbox", { name: "Vector brush name" }).fill("My ink")
  await page.getByRole("button", { name: "Save vector brush" }).click()
  await picker.click()
  await page
    .getByRole("button", { name: "Duplicate brush", exact: true })
    .click()
  await page.getByRole("button", { name: "Save vector brush" }).click()
  await page.reload()
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  await picker.click()
  await expect(
    page.getByRole("button", { name: "My ink vector brush", exact: true })
  ).toBeVisible()
  await expect(
    page.getByRole("button", { name: "My ink copy vector brush", exact: true })
  ).toBeVisible()
  await page.getByRole("button", { name: "Delete My ink", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "My ink vector brush", exact: true })
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Solid vector brush", exact: true })
  ).toBeVisible()
})

test("applying to several legacy strokes preserves their spines and undoes as one step", async ({
  page,
}) => {
  await page.goto(
    `${process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101"}/tests/harness/`
  )
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    window.remountEngine()
    const current = window.engine
    await current.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await current.dispatch({ type: "initialize" })
    await current.dispatch({ type: "addVectorLayer" })
    const id = current.getSnapshot().activeLayerId!
    await current.dispatch({
      type: "editVectorLayer",
      id,
      commands: [20, 60].map((y, index) => ({
        type: "add" as const,
        object: {
          id: `legacy-${index}`,
          transform: [1, 0, 0, 1, 0, 0] as const,
          geometry: {
            kind: "path" as const,
            closed: false,
            nodes: [
              {
                x: 20,
                y,
                in: null,
                out: null,
                type: "cusp" as const,
                width: 4,
              },
              {
                x: 180,
                y,
                in: null,
                out: null,
                type: "cusp" as const,
                width: 12,
              },
            ],
          },
          style: {
            fill: null,
            stroke: {
              color: "#000000",
              opacity: 1,
              width: 12,
              cap: "round" as const,
              join: "round" as const,
            },
          },
        },
      })),
    })
    await current.dispatch({
      type: "selectVectorObjects",
      ids: ["legacy-0", "legacy-1"],
    })
    const before = current.getSnapshot().vectorPaths
    const legacySvg = (await current.exportSvg({ raster: "omit" })).svg
    const steps = current.historyUsage().steps
    const brush = {
      id: "test:pressure",
      name: "Pressure",
      kind: "profile" as const,
      params: {
        pressure: true,
        pressureCurve: 1,
        thinning: 0,
        minWidth: 0,
        taper: { start: 0, end: 0 },
        caps: "round" as const,
        smoothing: 0,
        tremor: 0,
        wiggle: 0,
      },
    }
    await current.dispatch({ type: "applyVectorBrush", brush })
    const after = current.getSnapshot().vectorPaths
    const pressureSvg = (await current.exportSvg({ raster: "omit" })).svg
    const afterSteps = current.historyUsage().steps
    // Changing the source brush does not mutate already authored objects.
    brush.params.pressure = false
    const retainedPressure = current
      .getSnapshot()
      .vectorPaths.every((object) => object.brush?.definition.params.pressure)
    await current.dispatch({ type: "undo" })
    const undone = current.getSnapshot().vectorPaths
    await current.dispatch({ type: "applyVectorBrush", brush })
    const solidSvg = (await current.exportSvg({ raster: "omit" })).svg
    return {
      before,
      after,
      undone,
      steps,
      afterSteps,
      retainedPressure,
      legacySvg,
      pressureSvg,
      solidSvg,
    }
  })
  expect(result.afterSteps).toBe(result.steps + 1)
  expect(result.after.map((object) => object.geometry)).toEqual(
    result.before.map((object) => object.geometry)
  )
  expect(result.after.every((object) => object.brush?.seed === 0)).toBe(true)
  expect(result.retainedPressure).toBe(true)
  expect(result.undone).toEqual(result.before)
  const outlines = (svg: string) =>
    Array.from(svg.matchAll(/<path d="([^"]+)"/g), (match) => match[1])
  expect(outlines(result.pressureSvg)).toEqual(outlines(result.legacySvg))
  expect(outlines(result.solidSvg)).not.toEqual(outlines(result.legacySvg))
})

for (const name of [
  "Fineliner",
  "Technical pen",
  "Dip pen",
  "Brush pen",
  "Marker",
  "Wiggly",
  "Splotchy",
]) {
  test(`golden: a ${name} profile stroke`, async ({ page }) => {
    await page.goto(
      `${process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101"}/tests/harness/`
    )
    await page.waitForFunction(() => !!window.engine)
    const definition = BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!
    const image = await page.evaluate(async (definition) => {
      window.remountEngine()
      const current = window.engine
      await current.dispatch({
        type: "resize",
        width: 240,
        height: 120,
        devicePixelRatio: 1,
      })
      await current.dispatch({ type: "initialize" })
      await current.dispatch({ type: "addVectorLayer" })
      const id = current.getSnapshot().activeLayerId!
      // A pressure ramp over an S-curve, so curve, taper and noise all show.
      await current.dispatch({
        type: "editVectorLayer",
        id,
        commands: [
          {
            type: "add",
            object: {
              id: "golden",
              transform: [1, 0, 0, 1, 0, 0],
              geometry: {
                kind: "path",
                closed: false,
                nodes: [
                  {
                    x: 20,
                    y: 80,
                    in: null,
                    out: { x: 70, y: 20 },
                    type: "smooth",
                    width: 3,
                  },
                  {
                    x: 120,
                    y: 60,
                    in: { x: 90, y: 75 },
                    out: { x: 150, y: 45 },
                    type: "smooth",
                    width: 14,
                  },
                  {
                    x: 220,
                    y: 40,
                    in: { x: 170, y: 100 },
                    out: null,
                    type: "smooth",
                    width: 8,
                  },
                ],
              },
              style: {
                fill: null,
                stroke: {
                  color: "#000000",
                  opacity: 1,
                  width: 14,
                  cap: "round",
                  join: "round",
                },
              },
              brush: { definition, seed: 42 },
            },
          },
        ],
      })
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      const pixels = await current.readPixels()
      return {
        width: pixels.width,
        height: pixels.height,
        data: Array.from(pixels.data),
      }
    }, definition)
    const png = new PNG({ width: image.width, height: image.height })
    png.data = Buffer.from(image.data)
    expect(PNG.sync.write(png)).toMatchSnapshot(
      `profile-${name.toLowerCase().replace(/\s+/g, "-")}.png`,
      { maxDiffPixelRatio: 0.01 }
    )
  })
}
