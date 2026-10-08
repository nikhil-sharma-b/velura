import { readFile } from "node:fs/promises"
import { expect, test, type Page } from "@playwright/test"
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
        nibAngle: 45,
        fixation: 1,
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

/** Opens the harness with a vector layer and the vector brush set to `name`. */
async function nibCanvas(page: Page, name: string) {
  await page.goto(
    `${process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101"}/tests/harness/`
  )
  await page.waitForFunction(() => !!window.engine)
  const definition = BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!
  await page.evaluate(async (brush) => {
    window.remountEngine()
    const current = window.engine
    await current.dispatch({
      type: "resize",
      width: 240,
      height: 120,
      devicePixelRatio: 1,
    })
    await current.dispatch({ type: "initialize" })
    await current.dispatch({ type: "setStabilization", strength: 0 })
    await current.dispatch({ type: "addVectorLayer" })
    await current.dispatch({ type: "setTool", tool: "pressure" })
    await current.dispatch({ type: "setVectorBrush", brush })
  }, definition)
}

/**
 * A horizontal stroke from constructed pointer events, since Playwright's
 * own pointer cannot tilt; the mouse's reports no tilt, as a real one does.
 */
async function nibStroke(
  page: Page,
  pointerType: "pen" | "mouse",
  tiltX: number,
  tiltY: number,
  id: string
) {
  await page.evaluate(
    async ([type, tx, ty]) => {
      const canvas = document.querySelector("canvas")!
      const bounds = canvas.getBoundingClientRect()
      const send = (event: string, x: number) =>
        canvas.dispatchEvent(
          new PointerEvent(event, {
            pointerId: 1,
            pointerType: type,
            isPrimary: true,
            bubbles: true,
            cancelable: true,
            buttons: event === "pointerup" ? 0 : 1,
            clientX: bounds.left + x,
            clientY: bounds.top + 60,
            pressure: 0.5,
            tiltX: tx,
            tiltY: ty,
          })
        )
      send("pointerdown", 20)
      for (let x = 25; x <= 220; x += 5) send("pointerrawupdate", x)
      send("pointerup", 220)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    },
    [pointerType, tiltX, tiltY] as const
  )
  // Only selected paths are published, so select the stroke just drawn.
  return page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "selectVectorObjects", ids: [id] })
    return window.engine.getSnapshot().vectorPaths[0]
  }, id)
}

test("a tilt nib follows a pen's lean and holds its angle under a mouse", async ({
  page,
}) => {
  await nibCanvas(page, "Pointed tilt nib")
  const pen = await nibStroke(page, "pen", 0, 50, "shape-1")
  expect(pen.brush?.tilt).toBeCloseTo(Math.PI / 2, 2)
  const mouse = await nibStroke(page, "mouse", 0, 0, "shape-2")
  expect(mouse.brush?.definition.kind).toBe("calligraphy")
  expect(mouse.brush?.tilt).toBeUndefined()
  const svg = await page.evaluate(
    async () => (await window.engine.exportSvg({ raster: "omit" })).svg
  )
  const outlines = Array.from(
    svg.matchAll(/<path d="(M[^"]+)" fill="#[0-9a-f]+"[^>]*stroke="none"/g),
    (match) => match[1]
  )
  // Both are drawn as outlines; the leaning nib sits across the stroke, so
  // its outline differs from the fixed one's.
  expect(outlines).toHaveLength(2)
  expect(outlines[0]).not.toEqual(outlines[1])
})

test("golden: calligraphy lettering", async ({ page }) => {
  await page.goto(
    `${process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101"}/tests/harness/`
  )
  await page.waitForFunction(() => !!window.engine)
  const brushes = ["Broad nib", "Italic", "Pointed tilt nib"].map((name) =>
    BUILTIN_VECTOR_BRUSHES.find((b) => b.name === name)!
  )
  const image = await page.evaluate(async (brushes) => {
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
    type P = { x: number; y: number }
    const node = (at: P, inH: P | null, out: P | null, width = 12) => ({
      ...at,
      in: inH,
      out,
      type: "smooth" as const,
      width,
    })
    // An "l", an "o" and an "n" in turn, one per preset, so thick downstrokes
    // and thin hairlines show for each nib.
    const letters = [
      [
        node({ x: 30, y: 100 }, null, { x: 45, y: 70 }, 8),
        node({ x: 50, y: 20 }, { x: 60, y: 30 }, { x: 40, y: 10 }),
        node({ x: 40, y: 100 }, { x: 30, y: 60 }, null, 10),
      ],
      [
        node({ x: 120, y: 50 }, null, { x: 90, y: 45 }, 10),
        node({ x: 100, y: 100 }, { x: 85, y: 90 }, { x: 115, y: 110 }),
        node({ x: 125, y: 55 }, { x: 135, y: 80 }, null, 8),
      ],
      [
        node({ x: 160, y: 100 }, null, { x: 160, y: 80 }, 12),
        node({ x: 175, y: 55 }, { x: 160, y: 55 }, { x: 195, y: 50 }),
        node({ x: 215, y: 100 }, { x: 210, y: 60 }, null, 10),
      ],
    ]
    await current.dispatch({
      type: "editVectorLayer",
      id,
      commands: letters.map((nodes, i) => ({
        type: "add" as const,
        object: {
          id: `letter-${i}`,
          transform: [1, 0, 0, 1, 0, 0] as const,
          geometry: { kind: "path" as const, closed: false, nodes },
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
          // The tilt nib leans the way a right hand's pen does.
          brush: { definition: brushes[i], seed: 7, tilt: Math.PI / 3 },
        },
      })),
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
  }, brushes)
  const png = new PNG({ width: image.width, height: image.height })
  png.data = Buffer.from(image.data)
  expect(PNG.sync.write(png)).toMatchSnapshot("calligraphy-lettering.png", {
    maxDiffPixelRatio: 0.01,
  })
})

test("make a pattern brush from a selection and draw with it", async ({
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
  const box = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  // The art: a long, low rectangle.
  await page.getByRole("button", { name: "Rectangle tool" }).click()
  await page.mouse.move(x - 60, y - 10)
  await page.mouse.down()
  await page.mouse.move(x + 60, y + 10, { steps: 5 })
  await page.mouse.up()
  await page
    .getByRole("button", { name: "Select objects", exact: true })
    .click()
  // On its edge: an unfilled shape is picked by its outline.
  await page.mouse.click(x - 60, y)
  // Choosing the vector brush tool would drop the selection.
  const picker = page.getByRole("button", { name: /^Choose vector brush/ })
  await picker.click()
  await page
    .getByRole("button", { name: "Make pattern brush", exact: true })
    .click()
  const pattern = page.getByRole("region", { name: "Pattern" })
  await pattern
    .getByRole("combobox", { name: "Pattern fit" })
    .selectOption("repeat")
  await page.getByRole("textbox", { name: "Vector brush name" }).fill("Bricks")
  await page.getByRole("button", { name: "Save vector brush" }).click()
  await expect(picker).toHaveAccessibleName("Choose vector brush: Bricks")
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  await page.mouse.move(x - 150, y + 80)
  await page.mouse.down()
  await page.mouse.move(x + 150, y + 80, { steps: 30 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Export or import" }).click()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export SVG" }).click(),
  ])
  const svg = await readFile(await download.path(), "utf8")
  const group = svg.match(
    /<g data-vector-brush="([^"]+)" data-spine="([^"]+)">(.*?)<\/g>/
  )
  const exported = group && {
    brush: JSON.parse(group[1].replaceAll("&quot;", '"')),
    paths: group[3].match(/<path /g)?.length ?? 0,
  }
  expect(exported?.brush.definition.name).toBe("Bricks")
  expect(exported?.brush.definition.pattern.mode).toBe("repeat")
  // A 300 pixel stroke repeats the six-to-one brick several times.
  expect(exported!.paths).toBeGreaterThan(2)
})

test("make a scatter brush from a selection and draw with it", async ({
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
  const box = (await page
    .getByRole("img", { name: "Drawing canvas" })
    .boundingBox())!
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2
  // The art: a small square.
  await page.getByRole("button", { name: "Rectangle tool" }).click()
  await page.mouse.move(x - 10, y - 10)
  await page.mouse.down()
  await page.mouse.move(x + 10, y + 10, { steps: 5 })
  await page.mouse.up()
  await page
    .getByRole("button", { name: "Select objects", exact: true })
    .click()
  // On its edge: an unfilled shape is picked by its outline.
  await page.mouse.click(x - 10, y)
  const picker = page.getByRole("button", { name: /^Choose vector brush/ })
  await picker.click()
  await page
    .getByRole("button", { name: "Make scatter brush", exact: true })
    .click()
  const scatter = page.getByRole("region", { name: "Scatter" })
  await scatter.getByRole("spinbutton", { name: "Scatter spacing" }).fill("300")
  await scatter.getByRole("checkbox", { name: "Align to path" }).check()
  await page.getByRole("textbox", { name: "Vector brush name" }).fill("Tiles")
  await page.getByRole("button", { name: "Save vector brush" }).click()
  await expect(picker).toHaveAccessibleName("Choose vector brush: Tiles")
  await page.getByRole("button", { name: "Vector brush tool" }).click()
  await page.mouse.move(x - 150, y + 80)
  await page.mouse.down()
  await page.mouse.move(x + 150, y + 80, { steps: 30 })
  await page.mouse.up()
  await page.getByRole("button", { name: "Export or import" }).click()
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export SVG" }).click(),
  ])
  const svg = await readFile(await download.path(), "utf8")
  const group = svg.match(
    /<g data-vector-brush="([^"]+)" data-spine="([^"]+)">(.*?)<\/g>/
  )
  const exported = group && {
    brush: JSON.parse(group[1].replaceAll("&quot;", '"')),
    paths: group[3].match(/<path /g)?.length ?? 0,
  }
  expect(exported?.brush.definition.name).toBe("Tiles")
  expect(exported?.brush.definition.scatter.align).toBe(true)
  // A 300 pixel stroke drops a copy every three stroke widths.
  expect(exported!.paths).toBeGreaterThan(2)
})
