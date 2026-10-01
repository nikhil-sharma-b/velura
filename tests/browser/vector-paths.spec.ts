import { expect, test, type Page } from "@playwright/test"

async function open(page: Page) {
  await page.goto(
    `${process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101"}/tests/harness/`
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    window.remountEngine()
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "addVectorLayer" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
    await window.engine.dispatch({
      type: "setPressureCurve",
      curve: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    })
    await window.engine.dispatch({ type: "setSnapping", enabled: false })
    await window.engine.dispatch({ type: "setColor", hex: "#2a6ad0" })
    await window.engine.dispatch({
      type: "setShapeStyle",
      stroke: true,
      strokeWidth: 12,
    })
  })
  return (await page.locator("canvas").boundingBox())!
}

async function path(page: Page) {
  return page.evaluate(() => window.engine.getSnapshot().vectorPaths[0])
}
async function waitForObject(page: Page) {
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorPaths.length === 1
  )
}

test("pen drag handles, closing, node edits, and undo through the facade", async ({
  page,
}) => {
  const box = await open(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "pen" })
  )
  await page.mouse.click(box.x + 30, box.y + 85)
  await page.mouse.move(box.x + 90, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 125, box.y + 25, { steps: 8 })
  await page.mouse.up()
  await page.mouse.click(box.x + 170, box.y + 85)
  await page.mouse.click(box.x + 30, box.y + 85)
  await waitForObject(page)
  const object = (await path(page))!
  expect(object.geometry).toMatchObject({
    kind: "path",
    closed: true,
    nodes: [
      { x: 30, y: 85 },
      {
        x: 90,
        y: 25,
        in: { x: 55, y: 25 },
        out: { x: 125, y: 25 },
        smooth: true,
      },
      { x: 170, y: 85 },
    ],
  })
  await expect(page.locator("canvas")).toHaveScreenshot("vector-pen-path.png")
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(box.x + 90, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 90, box.y + 45, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  expect((await path(page))!.geometry).toMatchObject({
    nodes: [
      { x: 30, y: 85 },
      { x: 90, y: 45, in: { x: 55, y: 45 }, out: { x: 125, y: 45 } },
      { x: 170, y: 85 },
    ],
  })
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
  await page.evaluate(async (id) => {
    await window.engine.dispatch({
      type: "editVectorNode",
      objectId: id,
      edit: { type: "split", index: 0 },
    })
    await window.engine.dispatch({ type: "toggleVectorNode" })
    await window.engine.dispatch({ type: "deleteVectorNode" })
  }, object.id)
  expect((await path(page))!.geometry).toMatchObject({
    kind: "path",
    nodes: [
      { x: 30, y: 85 },
      { x: 90, y: 25 },
      { x: 170, y: 85 },
    ],
  })
})

/** Tablet input enters the same sampler as real pointer input, including force. */
async function pressureStroke(page: Page) {
  await page.locator("canvas").evaluate((canvas) => {
    const box = canvas.getBoundingClientRect()
    const send = (type: string, x: number, y: number, pressure: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 77,
          pointerType: "pen",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerup" ? 0 : 1,
          clientX: box.x + x,
          clientY: box.y + y,
          pressure,
          bubbles: true,
        })
      )
    send("pointerdown", 20, 70, 0.2)
    for (let i = 1; i <= 30; i++) {
      const x = 20 + i * 5,
        y = 70 - 35 * Math.sin((i * Math.PI) / 30),
        pressure = 0.2 + 0.8 * Math.sin((i * Math.PI) / 30)
      send("pointermove", x, y, pressure)
      send("pointerrawupdate", x, y, pressure)
    }
    send("pointerup", 175, 70, 0.2)
  })
}

test("pressure stroke keeps widths, remains editable, and survives save/import and undo", async ({
  page,
}) => {
  await open(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setShapeStyle", strokeWidth: 20 })
    await window.engine.dispatch({ type: "setTool", tool: "pressure" })
  })
  await pressureStroke(page)
  await waitForObject(page)
  const object = (await path(page))!
  expect(object.geometry.kind).toBe("path")
  if (object.geometry.kind !== "path")
    throw new Error("Pressure is an editable path")
  expect(object.geometry.nodes[0]).toMatchObject({ x: 20, y: 70 })
  expect(object.geometry.nodes[0].width).toBeCloseTo(4, 5)
  expect(object.geometry.nodes.at(-1)).toMatchObject({
    x: 175,
    y: 70,
  })
  expect(object.geometry.nodes.at(-1)!.width).toBeCloseTo(4, 5)
  expect(
    Math.max(...object.geometry.nodes.map((n) => n.width!))
  ).toBeGreaterThan(19)
  await expect(page.locator("canvas")).toHaveScreenshot(
    "vector-pressure-stroke.png"
  )
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "setTool", tool: "node" })
    await window.engine.dispatch({
      type: "editVectorNode",
      objectId: id,
      edit: {
        type: "move",
        index: 0,
        part: "anchor",
        point: { x: 20, y: 100 },
      },
    })
    await window.engine.dispatch({ type: "undo" })
  }, object.id)
  expect(await path(page)).toEqual(object)
  await page.evaluate(async () => {
    const bytes = await window.engine.exportDocument()
    await window.engine.dispatch({ type: "clearDocument" })
    await window.engine.importDocument(bytes)
  })
  await expect(page.locator("canvas")).toHaveScreenshot(
    "vector-pressure-stroke.png"
  )
})

test("stabilized pressure strokes suppress tremor and flush the raw endpoint", async ({
  page,
}) => {
  await open(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "pressure" })
    await window.engine.dispatch({ type: "setStabilization", strength: 1 })
  })
  await page.locator("canvas").evaluate((canvas) => {
    const box = canvas.getBoundingClientRect()
    const send = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 88,
          pointerType: "pen",
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: box.x + x,
          clientY: box.y + y,
          pressure: 1,
          bubbles: true,
        })
      )
    send("pointerdown", 20, 60)
    for (const y of [62, 58, 63, 57]) {
      send("pointermove", 30, y)
      send("pointerrawupdate", 30, y)
    }
    send("pointerup", 100, 60)
  })
  await waitForObject(page)
  const geometry = (await path(page))!.geometry
  if (geometry.kind !== "path") throw new Error("Expected a path")
  expect(geometry.nodes.at(-1)).toMatchObject({ x: 100, y: 60 })
  expect(geometry.nodes.every((n) => Math.abs(n.y - 60) < 0.001)).toBe(true)
})

test("Alt places unsnapped pen anchors; open paths finish and idle drafts cancel on layer changes", async ({
  page,
}) => {
  const box = await open(page)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setSnapping", enabled: true })
    await window.engine.dispatch({ type: "setTool", tool: "pen" })
  })
  await page.keyboard.down("Alt")
  await page.mouse.click(box.x + 3, box.y + 20)
  await page.mouse.click(box.x + 80, box.y + 20)
  await page.keyboard.up("Alt")
  await page.evaluate(() => window.engine.dispatch({ type: "finishPenPath" }))
  await waitForObject(page)
  expect((await path(page))!.geometry).toMatchObject({
    kind: "path",
    closed: false,
    nodes: [
      { x: 3, y: 20 },
      { x: 80, y: 20 },
    ],
  })
  await page.mouse.click(box.x + 40, box.y + 80)
  await page.mouse.click(box.x + 100, box.y + 80)
  await page.evaluate(async () => {
    const id = window.engine.getSnapshot().layers[0].id
    await window.engine.dispatch({ type: "selectLayer", id })
    await window.engine.dispatch({ type: "finishPenPath" })
  })
  expect(
    await page.evaluate(() => window.engine.getSnapshot().penNodes)
  ).toEqual([])
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layers.at(-1))
  ).toMatchObject({ objects: 1 })
})

test("live pen handles bypass snapshot subscribers and nodes insert through double click", async ({
  page,
}) => {
  await open(page)
  const movements = await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "pen" })
    const canvas = document.querySelector("canvas")!,
      box = canvas.getBoundingClientRect()
    const send = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          pointerId: 90,
          pointerType: "pen",
          isPrimary: true,
          button: 0,
          buttons: 1,
          clientX: box.x + x,
          clientY: box.y + y,
          pressure: 1,
          bubbles: true,
        })
      )
    const frame = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
    send("pointerdown", 30, 80)
    await frame()
    let changes = 0
    const stop = window.engine.subscribe(() => {
      changes++
    })
    send("pointermove", 40, 70)
    send("pointerrawupdate", 40, 70)
    await frame()
    const result = changes
    send("pointerup", 40, 70)
    stop()
    return result
  })
  expect(movements).toBe(0)
  const box = (await page.locator("canvas").boundingBox())!
  await page.mouse.click(box.x + 160, box.y + 80)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "finishPenPath" })
  })
  await waitForObject(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  // The first dragged anchor bends the path; split the straight end region.
  const object = (await path(page))!
  await page.evaluate(async (id) => {
    await window.engine.dispatch({
      type: "editVectorNode",
      objectId: id,
      edit: { type: "move", index: 0, part: "out", point: { x: 30, y: 80 } },
    })
  }, object.id)
  await page.mouse.dblclick(box.x + 100, box.y + 80)
  await page.waitForFunction(() => {
    const geometry = window.engine.getSnapshot().vectorPaths[0]?.geometry
    return geometry?.kind === "path" && geometry.nodes.length === 3
  })
  const geometry = (await path(page))!.geometry
  if (geometry.kind !== "path") throw new Error("Expected a path")
  expect(geometry.nodes[1].x).toBeCloseTo(100, 1)
})
