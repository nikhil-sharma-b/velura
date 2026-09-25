import { expect, test, type Page } from "@playwright/test"

/**
 * Moving, scaling, turning and mirroring a picture after it has been placed
 * (06). The care is in what does *not* happen: a picture adjusted a dozen
 * times must be exactly as sharp as one adjusted once, which is only true
 * because every adjustment is rendered from the original rather than from the
 * last rendering of it.
 */

const WIDTH = 200
const HEIGHT = 120

type Image = { width: number; data: number[] }

async function openCanvas(page: Page, documentId?: string) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, id]) => {
      window.remountEngine(
        id ? { persistence: { documentId: id as string } } : undefined
      )
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
    },
    [WIDTH, HEIGHT, documentId] as const
  )
}

async function painted(page: Page): Promise<Image> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  return page.evaluate(async () => {
    const pixels = await window.engine.readPixels()
    return { width: pixels.width, data: Array.from(pixels.data) }
  })
}

const channel = (image: Image, at: { x: number; y: number }, index: number) =>
  image.data[(at.y * image.width + at.x) * 4 + index]

/** A picture with a recognisable gradient, so softening is visible. */
async function placeGradient(
  page: Page,
  size: { width: number; height: number }
): Promise<string> {
  return page.evaluate(
    async ([width, height]) => {
      const pixels = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const at = (y * width + x) * 4
          // A hard checker: every resampling of a resampling blurs its edges,
          // which is the degradation this feature exists to avoid.
          const on = (x + y) % 2 === 0
          pixels[at] = on ? 255 : 0
          pixels[at + 1] = on ? 0 : 255
          pixels[at + 2] = 0
          pixels[at + 3] = 255
        }
      await window.engine.dispatch({
        type: "placeImage",
        name: "Reference",
        image: { width, height, pixels },
      })
      return window.engine.getSnapshot().activeLayerId
    },
    [size.width, size.height]
  )
}

type Placement = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipX: boolean
  flipY: boolean
}

const placementOf = (page: Page, id: string) =>
  page.evaluate((layerId) => {
    const found = window.engine
      .getSnapshot()
      .layers.find((layer) => layer.id === layerId)
    return found && found.kind === "raster"
      ? (found.placed?.placement ?? null)
      : null
  }, id) as Promise<Placement | null>

/** One transform, from pick-up to commit. */
async function transform(page: Page, id: string, to: Partial<Placement>) {
  await page.evaluate(
    async ([layerId, patch]) => {
      await window.engine.dispatch({
        type: "beginImageTransform",
        id: layerId as string,
      })
      const from = window.engine.getSnapshot().imageTransform!.placement
      await window.engine.dispatch({
        type: "adjustImageTransform",
        placement: { ...from, ...(patch as object) },
      })
      await window.engine.dispatch({ type: "commitImageTransform" })
    },
    [id, to] as const
  )
}

test("a placed picture keeps its colour through the shader that draws it", async ({
  page,
}) => {
  // The conversion a placed image goes through — sRGB transfer, the lift into
  // the linear P3 working space, premultiplication — is the renderer's now
  // rather than a loop in JavaScript, so this is what pins it: a colour put
  // in comes back out, through the display transform, as the colour it was.
  await openCanvas(page)
  await page.evaluate(async () => {
    const width = 40
    const height = 40
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let at = 0; at < pixels.length; at += 4) {
      // Mid grey: the value that is 21.6% of the light, not 50% of it, so a
      // missing transfer function shows up immediately.
      pixels[at] = 128
      pixels[at + 1] = 128
      pixels[at + 2] = 128
      pixels[at + 3] = 255
    }
    await window.engine.dispatch({
      type: "placeImage",
      name: "Grey",
      image: { width, height, pixels },
    })
  })
  const grey = await painted(page)
  const centre = { x: WIDTH / 2, y: HEIGHT / 2 }
  for (const index of [0, 1, 2])
    // Back through the display transform, a round trip to within a code
    // value: the encode and decode are inverses, whatever space sits between.
    expect(Math.abs(channel(grey, centre, index) - 128)).toBeLessThanOrEqual(1)
  expect(channel(grey, centre, 3)).toBe(255)
})

test("a half-transparent picture is premultiplied like every other surface", async ({
  page,
}) => {
  await openCanvas(page)
  const scene = await painted(page)
  await page.evaluate(
    async ([width, height]) => {
      const pixels = new Uint8ClampedArray(width * height * 4)
      for (let at = 0; at < pixels.length; at += 4) {
        pixels[at + 2] = 255
        pixels[at + 3] = 128
      }
      await window.engine.dispatch({
        type: "placeImage",
        name: "Half",
        image: { width, height, pixels },
      })
    },
    [WIDTH, HEIGHT]
  )
  const half = await painted(page)
  // Over the seeded scene's opaque green, where a change in either direction
  // is visible.
  const centre = { x: 20, y: 10 }
  // Half-covered blue over the scene: blue has risen and what is under it
  // still shows through, which is only true if the alpha was carried rather
  // than dropped — a picture that lost it would hide the scene completely.
  expect(channel(half, centre, 2)).toBeGreaterThan(channel(scene, centre, 2))
  expect(channel(half, centre, 1)).toBeLessThan(channel(scene, centre, 1))
  expect(channel(half, centre, 1)).toBeGreaterThan(20)
})

test("a placed image can be moved after it has been placed", async ({
  page,
}) => {
  await openCanvas(page)
  const scene = await painted(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const centre = { x: WIDTH / 2, y: HEIGHT / 2 }
  const left = { x: 30, y: HEIGHT / 2 }
  const placed = await painted(page)

  await transform(page, id, { x: 30 })
  const moved = await painted(page)
  // Where it went, and — the part a fill would get wrong — where it no
  // longer is: the middle is back to whatever was under the picture.
  expect(channel(moved, left, 0) + channel(moved, left, 1)).toBeGreaterThan(200)
  const pixel = (image: Image, at: { x: number; y: number }) =>
    [0, 1, 2, 3].map((index) => channel(image, at, index))
  expect(pixel(moved, centre)).not.toEqual(pixel(placed, centre))
  expect(pixel(moved, centre)).toEqual(pixel(scene, centre))
})

test("the canvas shows the picture moving while it is still being dragged", async ({
  page,
}) => {
  // The artist has to see what they are doing. Mid-drag there is no undo step
  // yet — the step is the whole drag — but the pixels on screen must already
  // be the picture at the placement under their hand.
  await openCanvas(page)
  const scene = await painted(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const centre = { x: WIDTH / 2, y: HEIGHT / 2 }
  const left = { x: 30, y: HEIGHT / 2 }

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, x: 30 },
    })
  }, id)

  const dragging = await painted(page)
  const pixel = (image: Image, at: { x: number; y: number }) =>
    [0, 1, 2, 3].map((index) => channel(image, at, index))
  expect(
    channel(dragging, left, 0) + channel(dragging, left, 1)
  ).toBeGreaterThan(200)
  expect(pixel(dragging, centre)).toEqual(pixel(scene, centre))
})

test("a flipped picture is mirrored, and flipping back restores it", async ({
  page,
}) => {
  // A flip is a flag on the placement rather than pixels moved, so it costs
  // no detail — but it has to reach the draw, or it changes nothing at all.
  await openCanvas(page)
  const id = await page.evaluate(async () => {
    const width = 40
    const height = 40
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        // Red down the left half, blue down the right: a picture that says
        // which way round it is.
        pixels[at] = x < width / 2 ? 255 : 0
        pixels[at + 2] = x < width / 2 ? 0 : 255
        pixels[at + 3] = 255
      }
    await window.engine.dispatch({
      type: "placeImage",
      name: "Sided",
      image: { width, height, pixels },
    })
    return window.engine.getSnapshot().activeLayerId
  })

  const left = { x: WIDTH / 2 - 15, y: HEIGHT / 2 }
  const right = { x: WIDTH / 2 + 15, y: HEIGHT / 2 }
  const placed = await painted(page)
  expect(channel(placed, left, 0)).toBeGreaterThan(200)
  expect(channel(placed, right, 2)).toBeGreaterThan(200)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, flipX: true },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
  }, id)

  const flipped = await painted(page)
  // The sides have swapped: blue is now on the left and red on the right.
  expect(channel(flipped, left, 2)).toBeGreaterThan(200)
  expect(channel(flipped, right, 0)).toBeGreaterThan(200)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, flipX: false },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
  }, id)
  // And flipping back is exactly the picture that was placed: mirroring is
  // its own inverse and costs nothing on the way.
  expect((await painted(page)).data).toEqual(placed.data)
})

test("a flipped picture is mirrored the other way too", async ({ page }) => {
  await openCanvas(page)
  const id = await page.evaluate(async () => {
    const width = 40
    const height = 40
    const pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4
        pixels[at] = y < height / 2 ? 255 : 0
        pixels[at + 2] = y < height / 2 ? 0 : 255
        pixels[at + 3] = 255
      }
    await window.engine.dispatch({
      type: "placeImage",
      name: "Stacked",
      image: { width, height, pixels },
    })
    return window.engine.getSnapshot().activeLayerId
  })
  const top = { x: WIDTH / 2, y: HEIGHT / 2 - 15 }
  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, flipY: true },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
  }, id)
  expect(channel(await painted(page), top, 2)).toBeGreaterThan(200)
})

test("adjusting a picture over and over does not soften it", async ({
  page,
}) => {
  // The criterion in full: a dozen adjustments ending at a placement must
  // produce exactly the pixels one adjustment to that placement would.
  await openCanvas(page)
  const id = await placeGradient(page, { width: 60, height: 60 })

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const start = window.engine.getSnapshot().imageTransform!.placement
    for (let step = 1; step <= 12; step++)
      await window.engine.dispatch({
        type: "adjustImageTransform",
        placement: {
          ...start,
          x: start.x + step * 3,
          y: start.y - step,
          width: start.width * (1 + step / 20),
          height: start.height * (1 + step / 20),
          rotation: step / 10,
        },
      })
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: {
        ...start,
        x: 80,
        y: 60,
        width: 90,
        height: 90,
        rotation: 0.4,
      },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
  }, id)
  const worked = await painted(page)

  // The same picture, the same end placement, reached in one move.
  await openCanvas(page)
  const fresh = await placeGradient(page, { width: 60, height: 60 })
  await transform(page, fresh, {
    x: 80,
    y: 60,
    width: 90,
    height: 90,
    rotation: 0.4,
  })
  const once = await painted(page)

  expect(worked.data).toEqual(once.data)
})

test("a whole drag decodes the original once, not once per adjustment", async ({
  page,
}) => {
  // A drag is a run of adjustments. Decoding the file for each one would
  // mean a full decode per pointer sample, and the picture would trail the
  // hand dragging it — so the original is opened once and drawn from.
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const placing = await page.evaluate(() => window.imageDecodes)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const start = window.engine.getSnapshot().imageTransform!.placement
    for (let step = 1; step <= 20; step++)
      await window.engine.dispatch({
        type: "adjustImageTransform",
        placement: { ...start, x: start.x + step },
      })
    await window.engine.dispatch({ type: "commitImageTransform" })
  }, id)

  expect(await page.evaluate(() => window.imageDecodes)).toBe(placing + 1)
})

test("a transform is one step of undo, and undo restores the placement", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const placed = await painted(page)
  const start = await placementOf(page, id)

  await transform(page, id, { x: 40, rotation: 0.3 })
  expect((await placementOf(page, id))!.x).toBe(40)

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  // The placement, not merely the pixels: the picture is back where it was
  // and is still a picture that can be moved from there.
  expect(await placementOf(page, id)).toEqual(start)
  expect((await painted(page)).data).toEqual(placed.data)

  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect((await placementOf(page, id))!.x).toBe(40)
})

test("a transform can be cancelled and leaves the picture exactly as it was", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const before = await painted(page)
  const steps = await page.evaluate(() => window.engine.historyUsage().steps)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const start = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start, x: 20, y: 20, rotation: 0.9 },
    })
    await window.engine.dispatch({ type: "cancelImageTransform" })
  }, id)

  expect((await painted(page)).data).toEqual(before.data)
  // And it cost nothing to take back, because there was nothing to take back.
  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    steps
  )
  expect(
    await page.evaluate(() => window.engine.getSnapshot().imageTransform)
  ).toBeNull()
})

test("scaling past the picture's own resolution is allowed and says so", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 20, height: 20 })
  const reported = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const start = window.engine.getSnapshot().imageTransform!
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start.placement, width: 40, height: 40 },
    })
    return window.engine.getSnapshot().imageTransform!.resolution
  }, id)
  // Allowed, and reported as what it is rather than passed off as detail.
  expect(reported).toBeCloseTo(2, 3)
})

test("converting to paint after a transform keeps the transformed result", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  await transform(page, id, { x: 40, y: 40 })
  const transformed = await painted(page)

  await page.evaluate(
    (layerId) =>
      window.engine.dispatch({ type: "makeLayerPaintable", id: layerId }),
    id
  )
  expect((await painted(page)).data).toEqual(transformed.data)

  // And there is no original left to re-render from, so the transform is no
  // longer on offer.
  const refused = await page.evaluate(
    (layerId) =>
      window.engine
        .dispatch({ type: "beginImageTransform", id: layerId })
        .then(() => null)
        .catch((error: Error) => error.message),
    id
  )
  expect(refused).toMatch(/placed image/i)
  expect(await placementOf(page, id)).toBeNull()
})

test("the layer's own settings behave as before while a transform is in flight", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const opaque = await painted(page)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    await window.engine.dispatch({
      type: "setLayer",
      id: layerId,
      opacity: 0.5,
    })
  }, id)
  const faded = await painted(page)
  expect(channel(faded, { x: WIDTH / 2, y: HEIGHT / 2 }, 1)).not.toBe(
    channel(opaque, { x: WIDTH / 2, y: HEIGHT / 2 }, 1)
  )

  // And the transform is still the one that was picked up, unaffected.
  await page.evaluate(async (layerId) => {
    const start = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start, x: 40 },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
    return layerId
  }, id)
  expect((await placementOf(page, id))!.x).toBe(40)
  expect(
    (await page.evaluate(() => window.engine.getSnapshot())).layers[1].opacity
  ).toBe(0.5)
})

test("blend mode and clipping hold through a transform", async ({ page }) => {
  // The rest of what a layer is, while it is being moved and after: a
  // transform changes where the picture sits, not how the layer combines.
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({
      type: "setLayer",
      id: layerId,
      blend: "multiply",
      clip: true,
    })
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
  }, id)

  // In flight, the layer still says what it is.
  const during = await page.evaluate(
    (layerId) =>
      window.engine.getSnapshot().layers.find((node) => node.id === layerId)!,
    id
  )
  expect(during.blend).toBe("multiply")
  expect(during.clip).toBe(true)

  await page.evaluate(async (layerId) => {
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, x: 60, y: 50 },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
    return layerId
  }, id)

  const after = await page.evaluate(
    (layerId) =>
      window.engine.getSnapshot().layers.find((node) => node.id === layerId)!,
    id
  )
  expect(after.blend).toBe("multiply")
  expect(after.clip).toBe(true)
  // And taking the transform back leaves them alone too: they were never
  // part of the step.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  const undone = await page.evaluate(
    (layerId) =>
      window.engine.getSnapshot().layers.find((node) => node.id === layerId)!,
    id
  )
  expect(undone.blend).toBe("multiply")
  expect(undone.clip).toBe(true)
})

test("a mask on a placed image survives the transform and still applies", async ({
  page,
}) => {
  await openCanvas(page)
  const id = await placeGradient(page, { width: 40, height: 40 })
  await page.evaluate(
    (layerId) => window.engine.dispatch({ type: "addMask", id: layerId }),
    id
  )
  await transform(page, id, { x: 40, y: 40 })

  const layer = await page.evaluate(
    (layerId) =>
      window.engine.getSnapshot().layers.find((node) => node.id === layerId)!,
    id
  )
  // The mask came through the step with the layer, enabled as it was: a
  // transform changes where the picture sits, not what the layer is. The
  // mask itself stays where it was painted — it is the artist's own marks,
  // with no original behind them, so moving it would mean resampling it.
  expect(layer.mask?.enabled).toBe(true)
  expect(
    await page.evaluate(() => window.engine.getSnapshot().imageTransform)
  ).toBeNull()

  // And it is still the undoable way to hide part of the picture: the pen
  // reaches the mask on a layer the pen itself is refused on.
  const masked = await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "selectMask", id: layerId })
    return window.engine.getSnapshot().paintingMask
  }, id)
  expect(masked).toBe(true)
})

test("a save landing mid-drag writes the placement its tiles actually hold", async ({
  page,
}) => {
  // The drag is deliberately not recorded until it is committed, so during
  // one the tiles on disk are the ones the picture was picked up with. A
  // save in that window must write that placement, not the one the artist is
  // still dragging, or reopening would show the picture in the wrong place.
  const documentId = `mid-drag-${Date.now()}`
  await openCanvas(page, documentId)
  const id = await placeGradient(page, { width: 40, height: 40 })
  const start = await placementOf(page, id)

  await page.evaluate(async (layerId) => {
    await window.engine.dispatch({ type: "beginImageTransform", id: layerId })
    const from = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...from, x: 160 },
    })
    // An autosave lands here, mid-drag.
    await window.engine.save()
  }, id)

  // Read off disk rather than out of the engine: the question is what a
  // reopen would find.
  expect(
    await page.evaluate(
      (storedId) => window.storedPlacement(storedId),
      documentId
    )
  ).toEqual(start)

  // And committing writes the pair together.
  await page.evaluate(async () => {
    await window.engine.dispatch({ type: "commitImageTransform" })
    await window.engine.save()
  })
  expect(
    await page.evaluate(
      (storedId) => window.storedPlacement(storedId),
      documentId
    )
  ).toMatchObject({ x: 160 })
})

test("a placed image reopens where it was left, still movable", async ({
  page,
}) => {
  const documentId = `transform-${Date.now()}`
  await openCanvas(page, documentId)
  const id = await placeGradient(page, { width: 40, height: 40 })
  await transform(page, id, { x: 40, y: 30, rotation: 0.2 })
  const left = await painted(page)
  await page.evaluate(() => window.engine.save())

  // A fresh engine over the same stored document: the tree, the tiles, and
  // the original each picture was made from.
  await openCanvas(page, documentId)
  await page.waitForFunction(
    () => window.engine.getSnapshot().layers.length > 1
  )

  expect((await painted(page)).data).toEqual(left.data)
  const placement = await page.evaluate(() => {
    const layer = window.engine.getSnapshot().layers[1]
    return layer.kind === "raster" ? (layer.placed?.placement ?? null) : null
  })
  expect(placement!.x).toBe(40)
  // Still movable, which is the whole reason the original was kept.
  const moved = await page.evaluate(async () => {
    const layer = window.engine.getSnapshot().layers[1]
    await window.engine.dispatch({ type: "beginImageTransform", id: layer.id })
    const start = window.engine.getSnapshot().imageTransform!.placement
    await window.engine.dispatch({
      type: "adjustImageTransform",
      placement: { ...start, x: 100 },
    })
    await window.engine.dispatch({ type: "commitImageTransform" })
    const after = window.engine.getSnapshot().layers[1]
    return after.kind === "raster" ? (after.placed?.placement.x ?? null) : null
  })
  expect(moved).toBe(100)
})
