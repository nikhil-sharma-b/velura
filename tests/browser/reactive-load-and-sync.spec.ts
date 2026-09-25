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

test("a change made while tiles are still loading never saves the document without them", async ({
  page,
}) => {
  const size = { width: 1600, height: 1000 }
  await page.setViewportSize(size)
  const documentId = newId()
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
  const box = (await page.locator("canvas").boundingBox())!
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
  const saved = await page.evaluate((id) => window.tileCountFor(id), documentId)
  expect(saved).toBeGreaterThan(25)

  // Reopen, and the moment the canvas is usable with tiles still arriving,
  // change the document and leave: the commit's save must not write a
  // manifest naming only the tiles loaded so far.
  await page.evaluate(
    ([width, height, id]) =>
      new Promise<void>((resolve) => {
        window.remountEngine({ persistence: { documentId: id as string } })
        let acted = false
        window.engine.subscribe(() => {
          const snapshot = window.engine.getSnapshot()
          if (acted || snapshot.status !== "ready" || !snapshot.loading) return
          acted = true
          void window.engine.dispatch({ type: "addLayer" }).then(() => {
            window.engine.dispose()
            setTimeout(resolve, 500)
          })
        })
        void window.engine
          .dispatch({
            type: "resize",
            width: width as number,
            height: height as number,
            devicePixelRatio: 1,
          })
          .then(() => window.engine.dispatch({ type: "initialize" }))
      }),
    [size.width, size.height, documentId] as const
  )

  expect(await page.evaluate((id) => window.tileCountFor(id), documentId)).toBe(
    saved
  )
})

test("leaving the canvas before the idle flush still uploads the work and its preview", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 40)

  // The library link is an in-app navigation: no pagehide, no
  // visibilitychange, only the host unmounting the canvas.
  await page.evaluate(() => window.engine.dispose())

  await page.waitForFunction(() => window.fakeCloud.previewVersion() === 1)
  const meta = await page.evaluate(() => window.fakeCloud.remote.documentMeta())
  expect(meta.structure).not.toBeNull()
})

test("reopening a document the cloud has no preview of uploads one", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  // A flush whose preview never landed, as when the canvas was torn down
  // while one was in flight: the tiles are in the cloud, the picture is not.
  await page.evaluate((id) => {
    const { presignPreviewUpload, commitPreview, ...remote } =
      window.fakeCloud.remote
    void presignPreviewUpload
    void commitPreview
    window.remountEngine({
      persistence: { documentId: id },
      cloud: { remote, idleMs: 60_000 },
    })
  }, documentId)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
  })
  await paint(page, origin, 40)
  await page.evaluate(() => window.engine.save())
  expect(await page.evaluate(() => window.fakeCloud.previewVersion())).toBe(
    undefined
  )

  await page.evaluate(async (id) => {
    window.remountEngine({
      persistence: { documentId: id },
      cloud: { remote: window.fakeCloud.remote, idleMs: 60_000 },
    })
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
  }, documentId)

  await page.waitForFunction(() => window.fakeCloud.previewVersion() === 1)
})

test("leaving mid-flush still lands its preview and reports the sync as over", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await page.evaluate((id) => {
    const statuses: string[] = []
    ;(window as unknown as { statuses: string[] }).statuses = statuses
    window.remountEngine({
      persistence: { documentId: id },
      cloud: {
        remote: window.fakeCloud.remote,
        idleMs: 60_000,
        onSyncStatus: (status) => statuses.push(status),
      },
    })
  }, documentId)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
  })
  await paint(page, origin, 40)

  await page.evaluate(async () => {
    window.fakeCloud.setCommitDelay(300)
    // A flush already under way — the idle one, or a reopen's repair — when
    // the artist heads back to the library.
    void window.engine.save()
    await new Promise((resolve) => setTimeout(resolve, 50))
    window.engine.dispose()
  })

  await page.waitForFunction(() => window.fakeCloud.previewVersion() === 1)
  await page.waitForFunction(
    () =>
      (window as unknown as { statuses: string[] }).statuses.at(-1) !==
      "syncing"
  )
})

test("leaving while a reopen's repair is in flight still finishes it", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await page.evaluate((id) => {
    const { presignPreviewUpload, commitPreview, ...remote } =
      window.fakeCloud.remote
    void presignPreviewUpload
    void commitPreview
    window.remountEngine({
      persistence: { documentId: id },
      cloud: { remote, idleMs: 60_000 },
    })
  }, documentId)
  await page.evaluate(async () => {
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    await window.engine.dispatch({ type: "setStabilization", strength: 0 })
  })
  await paint(page, origin, 40)
  await page.evaluate(() => window.engine.save())

  await page.evaluate(async (id) => {
    const statuses: string[] = []
    ;(window as unknown as { statuses: string[] }).statuses = statuses
    window.fakeCloud.setCommitDelay(300)
    window.remountEngine({
      persistence: { documentId: id },
      cloud: {
        remote: window.fakeCloud.remote,
        idleMs: 60_000,
        onSyncStatus: (status) => statuses.push(status),
      },
    })
    await window.engine.dispatch({
      type: "resize",
      width: 200,
      height: 120,
      devicePixelRatio: 1,
    })
    await window.engine.dispatch({ type: "initialize" })
    // The repair starts once everything has loaded; leave while it runs.
    const deadline = Date.now() + 2_000
    while (!statuses.includes("syncing") && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 10))
    window.engine.dispose()
  }, documentId)

  await page.waitForFunction(() => window.fakeCloud.previewVersion() === 1)
  await page.waitForFunction(
    () =>
      (window as unknown as { statuses: string[] }).statuses.at(-1) !==
      "syncing"
  )
})

test("reopening an untouched, synced document uploads nothing", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 40)
  await page.evaluate(() => window.engine.save())
  const versionsAfterSave = await page.evaluate(
    async () => (await window.fakeCloud.remote.listVersions()).length
  )

  // The first reopen finds the cloud's flush newer than the local save and
  // reads it back; the second must then see the two as in step.
  for (let open = 0; open < 2; open++) {
    await page.evaluate(async (id) => {
      window.remountEngine({
        persistence: { documentId: id },
        cloud: { remote: window.fakeCloud.remote, idleMs: 60_000 },
      })
      await window.engine.dispatch({
        type: "resize",
        width: 200,
        height: 120,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      // Long enough for a repair flush to have landed, were one started.
      await new Promise((resolve) => setTimeout(resolve, 500))
    }, documentId)
  }

  expect(
    await page.evaluate(
      async () => (await window.fakeCloud.remote.listVersions()).length
    )
  ).toBe(versionsAfterSave)
})
