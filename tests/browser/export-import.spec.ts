import { expect, test } from "@playwright/test"

test("an editable backup restores layers, groups, masks, settings and pixels", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "resize",
      width: 160,
      height: 96,
      devicePixelRatio: 1,
    })
    await engine.dispatch({ type: "initialize" })
    const bottom = engine.getSnapshot().activeLayerId
    await engine.dispatch({
      type: "setLayer",
      id: bottom,
      name: "Paint",
      opacity: 0.63,
      blend: "multiply",
      locked: true,
    })
    await engine.dispatch({ type: "addMask", id: bottom })
    await engine.dispatch({
      type: "setMaskEnabled",
      id: bottom,
      enabled: false,
    })
    await engine.dispatch({ type: "addLayer" })
    const top = engine.getSnapshot().activeLayerId
    await engine.dispatch({
      type: "setLayer",
      id: top,
      name: "Highlights",
      clip: true,
    })
    await engine.dispatch({ type: "addGroup", ids: [bottom, top] })
    const before = engine.getSnapshot()
    const pixelsBefore = await engine.readPixels()
    const backup = await engine.exportDocument()

    await engine.dispatch({
      type: "setLayer",
      id: bottom,
      opacity: 0.1,
      visible: false,
    })
    await engine.importDocument(backup)
    const after = engine.getSnapshot()
    const pixelsAfter = await engine.readPixels()
    return {
      layersBefore: before.layers,
      layersAfter: after.layers,
      activeBefore: before.activeLayerId,
      activeAfter: after.activeLayerId,
      pixelsMatch: pixelsBefore.data.every(
        (value, index) => value === pixelsAfter.data[index]
      ),
    }
  })

  expect(result.layersAfter).toEqual(result.layersBefore)
  expect(result.activeAfter).toBe(result.activeBefore)
  expect(result.pixelsMatch).toBe(true)
})

test("a corrupt backup leaves the open document untouched", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "resize",
      width: 96,
      height: 64,
      devicePixelRatio: 1,
    })
    await engine.dispatch({ type: "initialize" })
    const before = JSON.stringify(engine.getSnapshot().layers)
    let message = ""
    try {
      await engine.importDocument(new TextEncoder().encode("not a backup"))
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    return {
      before,
      after: JSON.stringify(engine.getSnapshot().layers),
      message,
    }
  })
  expect(result.after).toBe(result.before)
  expect(result.message).toMatch(/velura|truncated|valid/i)
})

test("SVG facade exports editable vectors, embedded paint and valid alpha masks", async ({
  page,
}) => {
  await page.goto(
    process.env.SVG_HARNESS_URL ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "resize",
      width: 64,
      height: 48,
      devicePixelRatio: 1,
    })
    await engine.dispatch({ type: "initialize" })
    const paint = engine.getSnapshot().activeLayerId
    await engine.dispatch({ type: "addMask", id: paint })
    await engine.dispatch({ type: "addVectorLayer" })
    const vector = engine.getSnapshot().activeLayerId
    await engine.dispatch({
      type: "editVectorLayer",
      id: vector,
      commands: [
        {
          type: "add",
          object: {
            id: "shape",
            geometry: { kind: "rect", x: 8, y: 8, width: 16, height: 16 },
            transform: [1, 0, 0, 1, 0, 0],
            style: {
              fill: { color: "#ff0000", opacity: 1, rule: "nonzero" },
              stroke: null,
            },
          },
        },
      ],
    })
    const embedded = await engine.exportSvg({ raster: "embed" })
    const omitted = await engine.exportSvg({ raster: "omit" })
    const parsed = new DOMParser().parseFromString(
      embedded.svg,
      "image/svg+xml"
    )
    const url = URL.createObjectURL(
      new Blob([embedded.svg], { type: "image/svg+xml" })
    )
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = new OffscreenCanvas(64, 48)
      const context = canvas.getContext("2d")!
      context.drawImage(image, 0, 0)
      return {
        errors: parsed.querySelectorAll("parsererror").length,
        png: parsed.querySelector("image")?.getAttribute("href"),
        masks: parsed.querySelectorAll("mask").length,
        rects: parsed.querySelectorAll("rect").length,
        pixel: [...context.getImageData(12, 12, 1, 1).data],
        omitted: omitted.svg,
        warnings: omitted.warnings,
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  expect(result.errors).toBe(0)
  expect(result.png).toMatch(/^data:image\/png;base64,/)
  expect(result.masks).toBe(1)
  expect(result.rects).toBe(1)
  expect(result.pixel).toEqual([255, 0, 0, 255])
  // Mask PNGs remain, even when paint layers are intentionally omitted.
  expect(result.omitted).toContain("<rect")
  expect(
    result.warnings.some((warning) => warning.includes("raster layer omitted"))
  ).toBe(true)
})

test("SVG clipping follows a vector base's painted mask and opacity", async ({
  page,
}) => {
  await page.goto(
    process.env.SVG_HARNESS_URL ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "resize",
      width: 64,
      height: 48,
      devicePixelRatio: 1,
    })
    await engine.dispatch({ type: "initialize" })
    await engine.dispatch({ type: "clearDocument" })
    await engine.dispatch({ type: "addVectorLayer" })
    const base = engine.getSnapshot().activeLayerId
    await engine.dispatch({
      type: "editVectorLayer",
      id: base,
      commands: [
        {
          type: "add",
          object: {
            id: "base",
            geometry: { kind: "rect", x: 8, y: 8, width: 32, height: 32 },
            transform: [1, 0, 0, 1, 0, 0],
            style: {
              fill: { color: "#ff0000", opacity: 1, rule: "nonzero" },
              stroke: null,
            },
          },
        },
      ],
    })
    await engine.dispatch({ type: "setLayer", id: base, opacity: 0.5 })
    await engine.dispatch({ type: "addMask", id: base })
    await engine.dispatch({ type: "selectMask", id: base })
    await engine.dispatch({ type: "setStabilization", strength: 0 })
    await engine.dispatch({ type: "setBrush", radius: 4 })
  })
  const origin = (await page.locator("canvas").boundingBox())!
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(origin.x + 10, origin.y + 16)
  await page.mouse.down()
  await page.mouse.move(origin.x + 35, origin.y + 16, { steps: 20 })
  await page.mouse.up()
  await page.waitForFunction(
    (n) => window.engine.historyUsage().steps > n,
    before
  )
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({ type: "addVectorLayer" })
    const top = engine.getSnapshot().activeLayerId
    await engine.dispatch({
      type: "editVectorLayer",
      id: top,
      commands: [
        {
          type: "add",
          object: {
            id: "top",
            geometry: { kind: "rect", x: 0, y: 0, width: 64, height: 48 },
            transform: [1, 0, 0, 1, 0, 0],
            style: {
              fill: { color: "#0000ff", opacity: 1, rule: "nonzero" },
              stroke: null,
            },
          },
        },
      ],
    })
    await engine.dispatch({ type: "setLayer", id: top, clip: true })
    const { svg } = await engine.exportSvg({ raster: "omit" })
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const context = new OffscreenCanvas(64, 48).getContext("2d")!
      context.drawImage(image, 0, 0)
      const at = (x: number, y: number) => [
        ...context.getImageData(x, y, 1, 1).data,
      ]
      return { outside: at(4, 4), inside: at(24, 30), masked: at(24, 16) }
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  expect(result.outside).toEqual([0, 0, 0, 0])
  expect(result.inside[0]).toBeCloseTo(85, -1)
  expect(result.inside[2]).toBeCloseTo(170, -1)
  expect(result.inside[3]).toBeCloseTo(191, -1)
  expect(result.masked[3]).toBeLessThan(30)
})

test("SVG facade preserves pen curves and transformed pressure outlines without overlap darkening", async ({
  page,
}) => {
  await page.goto(
    process.env.SVG_HARNESS_URL ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.engine)
  const result = await page.evaluate(async () => {
    const engine = window.engine
    await engine.dispatch({
      type: "resize",
      width: 128,
      height: 80,
      devicePixelRatio: 1,
    })
    await engine.dispatch({ type: "initialize" })
    await engine.dispatch({ type: "clearDocument" })
    await engine.dispatch({ type: "addVectorLayer" })
    await engine.dispatch({
      type: "editVectorLayer",
      id: engine.getSnapshot().activeLayerId,
      commands: [
        {
          type: "add",
          object: {
            id: "pen",
            transform: [1, 0, 0, 1, 0, 0],
            geometry: {
              kind: "path",
              closed: true,
              nodes: [
                { x: 10, y: 10, in: null, out: { x: 10, y: 0 }, smooth: false },
                { x: 50, y: 10, in: { x: 50, y: 0 }, out: null, smooth: false },
                { x: 50, y: 30, in: null, out: null, smooth: false },
              ],
            },
            style: {
              fill: { color: "#0000ff", opacity: 1, rule: "nonzero" },
              stroke: null,
            },
          },
        },
        {
          type: "add",
          object: {
            id: "pressure",
            transform: [1.5, 0, 0, 1.5, 3, 6],
            geometry: {
              kind: "path",
              closed: false,
              nodes: [
                { x: 10, y: 40, width: 4, in: null, out: null, smooth: false },
                { x: 30, y: 40, width: 12, in: null, out: null, smooth: false },
                { x: 50, y: 40, width: 20, in: null, out: null, smooth: false },
              ],
            },
            style: {
              fill: null,
              stroke: {
                color: "#ff0000",
                opacity: 0.5,
                width: 20,
                cap: "round",
                join: "round",
              },
            },
          },
        },
      ],
    })
    const { svg } = await engine.exportSvg({ raster: "omit" })
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }))
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = new OffscreenCanvas(128, 80),
        context = canvas.getContext("2d")!
      context.drawImage(image, 0, 0)
      const at = (x: number, y: number) => [
        ...context.getImageData(x, y, 1, 1).data,
      ]
      return {
        errors: parsed.querySelectorAll("parsererror").length,
        images: parsed.querySelectorAll("image").length,
        pen: at(40, 20),
        overlap: at(48, 66),
        thin: at(20, 58),
        wide: at(75, 58),
        outside: at(100, 66),
      }
    } finally {
      URL.revokeObjectURL(url)
    }
  })
  expect(result.errors).toBe(0)
  expect(result.images).toBe(0)
  expect(result.pen).toEqual([0, 0, 255, 255])
  // Chromium's SVG backends quantize 0.5 alpha to either adjacent byte.
  // Both remain half opaque; repeated blending would be around 192.
  for (const pixel of [result.overlap, result.wide]) {
    expect(pixel.slice(0, 3)).toEqual([255, 0, 0])
    expect(pixel[3]).toBeGreaterThanOrEqual(127)
    expect(pixel[3]).toBeLessThanOrEqual(128)
  }
  expect(result.thin).toEqual([0, 0, 0, 0])
  expect(result.outside).toEqual([0, 0, 0, 0])
})
