import { expect, test, type Page } from "@playwright/test"

declare global {
  interface Window {
    fakeCloud: ReturnType<Window["createFakeCloud"]>
    sawReadyWhileLoading: boolean
  }
}

/**
 * 18: reactive load and sync status, through the same engine seams the
 * artist drives — `window.engine` and the `RemoteIndex` a host would wire to
 * Convex, faked in `tests/harness/main.ts` for these.
 */

const WIDTH = 200
const HEIGHT = 120

const newId = () => `doc-${Math.random().toString(36).slice(2)}`

async function openWithCloud(page: Page, documentId: string) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, id]) => {
      const cloud = window.createFakeCloud({
        width: width as number,
        height: height as number,
      })
      window.fakeCloud = cloud
      window.remountEngine({
        persistence: { documentId: id as string },
        cloud: { remote: cloud.remote, idleMs: 60_000 },
      })
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [WIDTH, HEIGHT, documentId] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
}

async function paint(page: Page, origin: { x: number; y: number }, y: number) {
  const before = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.mouse.move(origin.x + 10, origin.y + y)
  await page.mouse.down()
  await page.mouse.move(origin.x + 30, origin.y + y, { steps: 20 })
  await page.mouse.up()
  await page.waitForFunction(
    (steps) => window.engine.historyUsage().steps > steps,
    before
  )
}

const syncStatus = (page: Page) =>
  page.evaluate(() => window.engine.getSnapshot().syncStatus)

test("sync status is genuine: saved-locally until a flush actually lands, syncing mid-flush, fully-synced only once it has", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  expect(await syncStatus(page)).toBe("saved-locally")

  await paint(page, origin, 40)
  expect(await syncStatus(page)).toBe("saved-locally")

  await page.evaluate(() => window.engine.save())
  expect(await syncStatus(page)).toBe("fully-synced")

  // A further stroke changes what the last flush uploaded.
  await paint(page, origin, 60)
  expect(await syncStatus(page)).toBe("saved-locally")
})

test("a flush that fails during an outage leaves the status honest, and a later flush recovers it", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 40)

  await page.evaluate(() => window.fakeCloud.setFailing(true))
  await page.evaluate(() => window.engine.save())
  // The outage did not end the session: the engine is still ready, and the
  // stroke that was on screen is still on screen.
  expect(await page.evaluate(() => window.engine.getSnapshot().status)).toBe(
    "ready"
  )
  expect(await syncStatus(page)).toBe("saved-locally")

  // Painting continues through the outage.
  await paint(page, origin, 60)
  expect(await page.evaluate(() => window.engine.getSnapshot().status)).toBe(
    "ready"
  )

  await page.evaluate(() => window.fakeCloud.setFailing(false))
  await page.evaluate(() => window.engine.save())
  expect(await syncStatus(page)).toBe("fully-synced")
})

test("reopening picks up a change flushed from elsewhere, without a manual refresh", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 40)
  await page.evaluate(() => window.engine.save())

  const activeLayerId = await page.evaluate(
    () => window.engine.getSnapshot().activeLayerId
  )
  // A tile this session never painted, landed by a flush from a different
  // device while this one is closed.
  const injected = { x: 0, y: 0 }
  await page.evaluate(
    async ([layerId, x, y]) => {
      const texels = new Array(256 * 256 * 4).fill(0)
      // Opaque red, premultiplied, in half-float: 1.0 is 0x3C00.
      for (let i = 0; i < texels.length; i += 4) {
        texels[i] = 0x3c00
        texels[i + 3] = 0x3c00
      }
      await window.fakeCloud.injectRemoteTile(
        layerId as string,
        x as number,
        y as number,
        texels
      )
    },
    [activeLayerId, injected.x, injected.y] as const
  )

  // Reopen against the *same* remote — a fresh `createFakeCloud` would lose
  // exactly the state this test is checking gets picked up.
  await page.evaluate(
    async ([width, height, id]) => {
      window.engine.dispose()
      window.remountEngine({
        persistence: { documentId: id as string },
        cloud: { remote: window.fakeCloud.remote, idleMs: 60_000 },
      })
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

  const pixel = await page.evaluate(async () => {
    const pixels = await window.engine.readPixels()
    const offset = (5 * pixels.width + 5) * 4
    return Array.from(pixels.data.slice(offset, offset + 4))
  })
  expect(pixel[0]).toBeGreaterThan(200)
  expect(pixel[1]).toBeLessThan(50)
})

test("the canvas is usable, and the centre resolves, before every tile has loaded", async ({
  page,
}) => {
  // A big viewport so the document (tiles are sparse — only painted ones
  // exist at all) can hold more of them than one immediate viewport-priority
  // batch (engine/index.ts's `IMMEDIATE_TILES`) covers for one layer.
  const size = { width: 1600, height: 1000 }
  await page.setViewportSize(size)
  const documentId = "doc-progressive"
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, id]) => {
      window.remountEngine({ persistence: { documentId: id as string } })
      await window.engine.dispatch({
        type: "resize",
        width: width as number,
        height: height as number,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", radius: 6 })
    },
    [size.width, size.height, documentId] as const
  )
  // Read only after the resize dispatch above: the canvas element has no CSS
  // sizing of its own in this harness, so its rendered box follows whatever
  // `resize` last set — reading it any earlier would still see the bare
  // element's default 300x150.
  const box = (await page.locator("canvas").boundingBox())!
  // Several sweeps across the full width, spread down the height: sparse
  // tiles only exist where paint actually landed, so this is what gives the
  // document more tiles than one layer's immediate batch covers.
  for (const fraction of [0.1, 0.25, 0.4, 0.55, 0.7, 0.85]) {
    const before = await page.evaluate(() => window.engine.historyUsage().steps)
    const y = box.y + size.height * fraction
    await page.mouse.move(box.x + 10, y)
    await page.mouse.down()
    await page.mouse.move(box.x + size.width - 10, y, { steps: 12 })
    await page.mouse.up()
    await page.waitForFunction(
      (steps) => window.engine.historyUsage().steps > steps,
      before,
      { timeout: 20_000 }
    )
  }
  await page.evaluate(() => window.engine.save())
  // More than `IMMEDIATE_TILES` (engine/index.ts), or this test proves
  // nothing about the background tail.
  expect(
    await page.evaluate((id) => window.tileCountFor(id), documentId)
  ).toBeGreaterThan(25)

  await page.evaluate(() => window.engine.dispose())
  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  // A subscriber sees every `publish`, so it cannot miss the instant between
  // "ready" and the background tail finishing the way polling from here
  // could if that instant were shorter than one round trip to the page.
  await page.evaluate(
    ([width, height, id]) => {
      window.sawReadyWhileLoading = false
      window.remountEngine({ persistence: { documentId: id as string } })
      window.engine.subscribe(() => {
        const snapshot = window.engine.getSnapshot()
        if (snapshot.status === "ready" && snapshot.loading)
          window.sawReadyWhileLoading = true
      })
      void window.engine
        .dispatch({
          type: "resize",
          width: width as number,
          height: height as number,
          devicePixelRatio: 1,
        })
        .then(() => window.engine.dispatch({ type: "initialize" }))
    },
    [size.width, size.height, documentId] as const
  )
  await page.waitForFunction(
    () =>
      window.engine.getSnapshot().status === "ready" &&
      !window.engine.getSnapshot().loading
  )
  // The canvas was usable — status "ready" — while tiles outside the
  // immediate viewport batch were still arriving in the background.
  expect(await page.evaluate(() => window.sawReadyWhileLoading)).toBe(true)
})
