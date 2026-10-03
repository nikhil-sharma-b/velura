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
        type: "smooth" as const,
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
    await window.engine.dispatch({
      type: "setVectorNodeType",
      nodeType: "smooth",
    })
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

/**
 * A filled triangle drawn with the pen, closed on its first anchor with a
 * click, as an artist would: every anchor a corner.
 */
async function penTriangle(page: Page, box: { x: number; y: number }) {
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setShapeStyle", fill: true })
    await window.engine.dispatch({ type: "setTool", tool: "pen" })
  })
  await page.mouse.click(box.x + 30, box.y + 95)
  await page.mouse.click(box.x + 100, box.y + 20)
  await page.mouse.click(box.x + 170, box.y + 95)
  await page.mouse.click(box.x + 30, box.y + 95)
  await waitForObject(page)
  return (await path(page))!
}

test("the node tool drags a corner anchor of a closed pen path, as one step", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  // Every corner, selected or not, moves where it is dragged.
  for (const [index, from] of [
    [2, { x: 170, y: 95 }],
    [0, { x: 30, y: 95 }],
    [1, { x: 100, y: 20 }],
  ] as const) {
    const before = await page.evaluate(() => window.engine.historyUsage().steps)
    await page.mouse.move(box.x + from.x, box.y + from.y)
    await page.mouse.down()
    await page.mouse.move(box.x + from.x - 10, box.y + from.y + 10, {
      steps: 5,
    })
    await page.mouse.up()
    await page.waitForFunction(
      (n) => window.engine.historyUsage().steps === n + 1,
      before
    )
    const geometry = (await path(page))!.geometry
    if (geometry.kind !== "path") throw new Error("A pen path is a path")
    expect(geometry.nodes[index]).toMatchObject({
      x: from.x - 10,
      y: from.y + 10,
    })
  }
  for (let undo = 0; undo < 3; undo++)
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
})

test("a handle pulled out with the pen still reshapes the curve", async ({
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
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  // Selected by a click on its outline, so its handles can be taken.
  await page.mouse.click(box.x + 30, box.y + 85)
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(box.x + 125, box.y + 25)
  await page.mouse.down()
  await page.mouse.move(box.x + 125, box.y + 45, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps === n + 1,
    before
  )
  const geometry = (await path(page))!.geometry
  if (geometry.kind !== "path") throw new Error("A pen path is a path")
  expect(geometry.nodes[1]).toMatchObject({
    x: 90,
    y: 25,
    out: { x: 125, y: 45 },
  })
})

test("clicking inside a filled path with the node tool selects it", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "node" })
  })
  // Off the shape, nothing is selected.
  await page.mouse.click(box.x + 190, box.y + 10)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorSelection)
  ).toEqual([])
  // Well inside the fill, far from the outline.
  await page.mouse.click(box.x + 100, box.y + 70)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorSelection)
  ).toEqual([object.id])
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

test("the node tool selects many nodes: band, Shift+click, all, Tab, Escape", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  const nodes = () =>
    page.evaluate(() =>
      window.engine.getSnapshot().vectorNodes.map((n) => n.index)
    )
  // Select the path, then band the two bottom corners from empty canvas.
  await page.mouse.click(box.x + 100, box.y + 70)
  await page.mouse.move(box.x + 5, box.y + 80)
  await page.mouse.down()
  await page.mouse.move(box.x + 195, box.y + 115, { steps: 5 })
  await page.mouse.up()
  expect((await nodes()).sort()).toEqual([0, 2])
  // Shift+click adds the apex, and takes it away again.
  await page.keyboard.down("Shift")
  await page.mouse.click(box.x + 100, box.y + 20)
  expect((await nodes()).sort()).toEqual([0, 1, 2])
  await page.mouse.click(box.x + 100, box.y + 20)
  expect((await nodes()).sort()).toEqual([0, 2])
  await page.keyboard.up("Shift")
  // A plain click on a selected-off node makes it the only one.
  await page.mouse.click(box.x + 100, box.y + 20)
  expect(await nodes()).toEqual([1])
  await page.evaluate(() =>
    window.engine.dispatch({ type: "stepVectorNode", direction: 1 })
  )
  expect(await nodes()).toEqual([2])
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  expect(await nodes()).toHaveLength(3)
  // Escape lets go of the nodes, then of the path.
  await page.evaluate(() =>
    window.engine.dispatch({ type: "abandonSelectionGesture" })
  )
  expect(await nodes()).toEqual([])
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorSelection)
  ).toEqual([object.id])
  // Nothing was edited along the way.
  expect(await path(page)).toEqual(object)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "abandonSelectionGesture" })
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorSelection)
  ).toEqual([])
})

test("a click on one of several selected nodes selects it alone", async ({
  page,
}) => {
  const box = await open(page)
  await penTriangle(page, box)
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "setTool", tool: "node" })
  })
  await page.mouse.click(box.x + 100, box.y + 70)
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  await page.mouse.click(box.x + 170, box.y + 95)
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorNodes.length === 1
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorNodes)
  ).toEqual([{ objectId: expect.any(String), index: 2 }])
})

test("dragging a selected node moves every selected node, across paths, as one step", async ({
  page,
}) => {
  const box = await open(page)
  const triangle = await penTriangle(page, box)
  const small = {
    ...triangle,
    id: "small",
    geometry: {
      kind: "path" as const,
      closed: true,
      nodes: [
        { x: 10, y: 5, in: null, out: null, type: "cusp" as const },
        { x: 50, y: 5, in: null, out: null, type: "cusp" as const },
        { x: 30, y: 35, in: null, out: null, type: "cusp" as const },
      ],
    },
  }
  await page.evaluate(async (object) => {
    const engine = window.engine
    await engine.dispatch({
      type: "editVectorLayer",
      id: engine.getSnapshot().activeLayerId,
      commands: [{ type: "add", object }],
    })
    await engine.dispatch({ type: "setTool", tool: "node" })
  }, small)
  const nodesOf = () =>
    page.evaluate(() =>
      Object.fromEntries(
        window.engine
          .getSnapshot()
          .vectorPaths.map((o) => [
            o.id,
            o.geometry.kind === "path"
              ? o.geometry.nodes.map((n) => [Math.round(n.x), Math.round(n.y)])
              : [],
          ])
      )
    )
  // Select the triangle, then Shift+click a corner of each path.
  await page.mouse.click(box.x + 100, box.y + 70)
  await page.keyboard.down("Shift")
  await page.mouse.click(box.x + 10, box.y + 5)
  await page.mouse.click(box.x + 100, box.y + 20)
  await page.keyboard.up("Shift")
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorNodes.length)
  ).toBe(2)
  // Only the paths being edited are listed, so both are now.
  const before = await nodesOf()
  // Drag the triangle's apex; the small path's corner follows it.
  await page.mouse.move(box.x + 100, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 110, box.y + 30, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(() =>
    window.engine
      .getSnapshot()
      .vectorPaths.some(
        (o) =>
          o.id === "small" &&
          o.geometry.kind === "path" &&
          o.geometry.nodes[0].x !== 10
      )
  )
  const after = await nodesOf()
  expect(after[triangle.id][1]).toEqual([110, 30])
  expect(after.small[0]).toEqual([20, 15])
  expect(after.small[1]).toEqual([50, 5])
  // A held arrow's nudges are one step, as the drag was.
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "nudgeVectorNodes", dx: 2, dy: 0 })
    await window.engine.dispatch({
      type: "nudgeVectorNodes",
      dx: 2,
      dy: 0,
      repeat: true,
    })
  })
  expect((await nodesOf()).small[0]).toEqual([24, 15])
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await nodesOf()).toEqual(after)
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await nodesOf()).toEqual(before)
})

test("node types: set on the selection, Ctrl+click cycles, undo restores", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  const types = async () => {
    const geometry = (await path(page))!.geometry
    return geometry.kind === "path" ? geometry.nodes.map((n) => n.type) : []
  }
  expect(await types()).toEqual(["cusp", "cusp", "cusp"])
  // Click the apex, make it symmetric: it pulls out even, level handles.
  await page.mouse.click(box.x + 100, box.y + 20)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setVectorNodeType", nodeType: "symmetric" })
  )
  expect(await types()).toEqual(["cusp", "symmetric", "cusp"])
  const apex = async () => {
    const geometry = (await path(page))!.geometry
    if (geometry.kind !== "path") throw new Error("Expected a path")
    return geometry.nodes[1]
  }
  const node = await apex()
  expect(node.in!.y).toBeCloseTo(node.y, 3)
  expect(node.out!.y).toBeCloseTo(node.y, 3)
  expect(node.x - node.in!.x).toBeCloseTo(node.out!.x - node.x, 3)
  // Ctrl+click on the apex turns it to the next type: auto-smooth.
  await page.keyboard.down("Control")
  await page.mouse.click(box.x + 100, box.y + 20)
  await page.keyboard.up("Control")
  await page.waitForFunction(() => {
    const g = window.engine.getSnapshot().vectorPaths[0]?.geometry
    return g?.kind === "path" && g.nodes[1].type === "auto"
  })
  // Each change was one step.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await types()).toEqual(["cusp", "symmetric", "cusp"])
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
})

test("selected segments become curves and lines, each one step", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  await page.mouse.click(box.x + 100, box.y + 70)
  await page.evaluate(() => window.engine.dispatch({ type: "selectAll" }))
  const handles = async () => {
    const geometry = (await path(page))!.geometry
    return geometry.kind === "path"
      ? geometry.nodes.map((n) => [!!n.in, !!n.out])
      : []
  }
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setVectorSegmentShape", shape: "curve" })
  )
  // Every segment, the closing one too, is bendable now.
  expect(await handles()).toEqual([
    [true, true],
    [true, true],
    [true, true],
  ])
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setVectorSegmentShape", shape: "line" })
  )
  expect(await handles()).toEqual([
    [false, false],
    [false, false],
    [false, false],
  ])
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await handles()).toEqual([
    [true, true],
    [true, true],
    [true, true],
  ])
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
})

test("dragging a segment bends it through the pointer, as one step; a click selects its ends", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  // The closing segment runs from the last corner back to the first.
  await page.mouse.click(box.x + 100, box.y + 95)
  expect(
    await page.evaluate(() =>
      window.engine.getSnapshot().vectorNodes.map((n) => n.index)
    )
  ).toEqual([2, 0])
  // Long enough after the click that the press is not a double-click.
  await page.waitForTimeout(450)
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(box.x + 100, box.y + 95)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 125, { steps: 5 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps === n + 1,
    before
  )
  const geometry = (await path(page))!.geometry
  if (geometry.kind !== "path") throw new Error("A pen path is a path")
  const a = geometry.nodes[2],
    d = geometry.nodes[0]
  // A straight segment has grown handles, and its middle follows the pointer.
  expect(a.out).not.toBeNull()
  expect(d.in).not.toBeNull()
  const middle = (k: "x" | "y") =>
    (a[k] + 3 * a.out![k] + 3 * d.in![k] + d[k]) / 8
  expect(Math.abs(middle("x") - 100)).toBeLessThan(0.5)
  expect(Math.abs(middle("y") - 125)).toBeLessThan(0.5)
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
})

test("Shift+drag pulls a handle out of a corner; Ctrl+click retracts it, one step", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  await page.mouse.click(box.x + 100, box.y + 70)
  const steps = () => page.evaluate(() => window.engine.historyUsage().steps)
  const before = await steps()
  await page.keyboard.down("Shift")
  await page.mouse.move(box.x + 100, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 130, box.y + 20, { steps: 5 })
  const held = () =>
    page.evaluate(() => window.engine.getSnapshot().vectorHandleHeld)
  // The hint bar names the handle modifiers while one is held.
  expect(await held()).toBe(true)
  await page.mouse.up()
  await page.keyboard.up("Shift")
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps === n + 1,
    before
  )
  expect(await held()).toBe(false)
  const pulled = (await path(page))!.geometry
  if (pulled.kind !== "path") throw new Error("A pen path is a path")
  expect(pulled.nodes[1]).toMatchObject({
    x: 100,
    y: 20,
    out: { x: 130, y: 20 },
  })

  await page.keyboard.down("Control")
  await page.mouse.click(box.x + 130, box.y + 20)
  await page.keyboard.up("Control")
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps === n + 2,
    before
  )
  const retracted = (await path(page))!.geometry
  if (retracted.kind !== "path") throw new Error("A pen path is a path")
  expect(retracted.nodes[1].out).toBeNull()
  expect(retracted.nodes[1]).toMatchObject({ x: 100, y: 20 })
  for (let undo = 0; undo < 2; undo++)
    await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await path(page)).toEqual(object)
})

test("deleting nodes that leave too few removes the path, as one step", async ({
  page,
}) => {
  const box = await open(page)
  const object = await penTriangle(page, box)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  await page.mouse.click(box.x + 100, box.y + 20)
  await page.keyboard.down("Shift")
  await page.mouse.click(box.x + 30, box.y + 95)
  await page.keyboard.up("Shift")
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorNodes.length === 2
  )
  await page.evaluate(() =>
    window.engine.dispatch({ type: "deleteVectorNode" })
  )
  expect(await path(page)).toBeUndefined()
  expect(
    await page.evaluate(() => window.engine.getSnapshot().vectorNodes)
  ).toEqual([])
  // One undo brings the path back whole; selecting it shows it.
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "undo" })
    await window.engine.dispatch({ type: "selectVectorObjects", ids: [id] })
  }, object.id)
  expect(await path(page)).toEqual(object)
})

test("breaking an open path makes two objects above one another, one step", async ({
  page,
}) => {
  const box = await open(page)
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "pen" })
  )
  await page.mouse.click(box.x + 20, box.y + 60)
  await page.mouse.click(box.x + 100, box.y + 60)
  await page.mouse.click(box.x + 180, box.y + 60)
  await page.evaluate(() => window.engine.dispatch({ type: "finishPenPath" }))
  await waitForObject(page)
  const object = (await path(page))!
  await page.evaluate(() =>
    window.engine.dispatch({ type: "setTool", tool: "node" })
  )
  await page.mouse.click(box.x + 100, box.y + 60)
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorNodes.length === 1
  )
  await page.evaluate(() =>
    window.engine.dispatch({ type: "breakVectorNodes" })
  )
  await page.waitForFunction(
    () => window.engine.getSnapshot().vectorPaths.length === 2
  )
  const [first, second] = await page.evaluate(
    () => window.engine.getSnapshot().vectorPaths
  )
  expect(first.id).toBe(object.id)
  expect(second.style).toEqual(object.style)
  const xs = (o: typeof first) =>
    o.geometry.kind === "path" ? o.geometry.nodes.map((n) => n.x) : []
  expect(xs(first)).toEqual([20, 100])
  expect(xs(second)).toEqual([100, 180])
  // The new path sits directly above the one it came from.
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layers.at(-1))
  ).toMatchObject({ objects: 2 })
  await page.evaluate(async (id) => {
    await window.engine.dispatch({ type: "undo" })
    await window.engine.dispatch({ type: "selectVectorObjects", ids: [id] })
  }, object.id)
  expect(await path(page)).toEqual(object)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().layers.at(-1))
  ).toMatchObject({ objects: 1 })
})
