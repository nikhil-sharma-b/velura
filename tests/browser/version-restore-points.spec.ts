import { expect, test, type Page } from "@playwright/test"

declare global {
  interface Window {
    fakeCloud: ReturnType<Window["createFakeCloud"]>
  }
}

/**
 * 20: version restore points, driven through the same seams the panel uses —
 * `engine.restorePoints()` and `engine.restoreVersion()` over the faked
 * `RemoteIndex` in `tests/harness/main.ts`.
 *
 * These are browser tests because a restore is a GPU write before it is
 * anything else: what it puts back has to be visible in `readPixels`, not
 * merely present in the tile index.
 */

const WIDTH = 200
const HEIGHT = 120
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

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
      await window.engine.dispatch({ type: "setBrush", radius: 8 })
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
  await page.mouse.move(origin.x + 60, origin.y + y, { steps: 20 })
  await page.mouse.up()
  await page.waitForFunction(
    (steps) => window.engine.historyUsage().steps > steps,
    before
  )
}

/**
 * Is there ink at this canvas pixel? The harness paints white on a dark
 * ground, so a marked pixel is bright in every channel (as in history.spec).
 */
async function painted(page: Page, x: number, y: number) {
  // The mark is composited on the next frame and read back after that.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
  const pixel = await page.evaluate(
    async ([px, py]) => {
      const pixels = await window.engine.readPixels()
      const offset = (py! * pixels.width + px!) * 4
      return Array.from(pixels.data.slice(offset, offset + 4))
    },
    [x, y] as const
  )
  return pixel[0]! > 200 && pixel[2]! > 200
}

const restorePoints = (page: Page) =>
  page.evaluate(() => window.engine.restorePoints())

test("a flush writes a restore point, and restoring one brings back the earlier state", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())

  // The state worth going back to: one stroke, flushed.
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  expect(earlier).toBeDefined()

  // A later session paints over it — the work undo cannot reach once closed.
  await paint(page, origin, 90)
  expect(await painted(page, 30, 90)).toBe(true)

  const restored = await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  expect(restored).toBe(true)

  // Back to the flushed state: the first stroke is there, the second is not.
  expect(await painted(page, 30, 30)).toBe(true)
  expect(await painted(page, 30, 90)).toBe(false)
})

test("a restore is one undo step, so previewing an old state is reversible", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  await paint(page, origin, 90)

  const steps = await page.evaluate(() => window.engine.historyUsage().steps)
  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    steps + 1
  )

  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))

  // The work the restore covered is back, and so is the restore, by redo.
  expect(await painted(page, 30, 90)).toBe(true)
  await page.evaluate(() => window.engine.dispatch({ type: "redo" }))
  expect(await painted(page, 30, 90)).toBe(false)
  expect(await painted(page, 30, 30)).toBe(true)
})

test("a restore point is a set of tile hashes, not a copy of the pixels", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())

  // Flushing the same document again with nothing painted between writes a
  // second restore point whose tiles are the *same* hashes: history costs
  // rows, not storage.
  await page.evaluate(() => window.engine.save())
  const points = await restorePoints(page)
  expect(points.length).toBeGreaterThanOrEqual(1)

  const snapshots = await page.evaluate(
    async (ids) =>
      await Promise.all(
        (ids as string[]).map((id) =>
          window.fakeCloud.remote.versionSnapshot(id)
        )
      ),
    points.map((point) => point.id)
  )
  const hashesOf = (snapshot: (typeof snapshots)[number]) =>
    snapshot.tiles.map((tile) => tile.hash).sort()
  for (const snapshot of snapshots)
    expect(hashesOf(snapshot)).toEqual(hashesOf(snapshots[0]!))
})

test("restore points decay: frequent for the last day, sparse for the week", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())

  // A fortnight, one flush per simulated hour. Only some hours paint: what
  // is under test here is the ladder the flushes leave behind, and 336
  // strokes through the pen would spend the test's time on the renderer.
  // Pixel-level restore is covered by the tests above; the decay rule itself
  // by tests/unit/version-retention.test.ts.
  for (let hour = 0; hour < 14 * 24; hour++) {
    if (hour % 24 === 0) await paint(page, origin, 20 + (hour % 80))
    await page.evaluate(() => window.engine.save())
    await page.evaluate((by) => window.fakeCloud.ageVersions(by), HOUR)
  }
  await page.evaluate(() => window.engine.save())

  const points = await restorePoints(page)
  const newest = points[0]!.createdAt
  // Bounded, and none of it older than the week the decay retains.
  expect(points.length).toBeLessThan(40)
  for (const point of points)
    expect(newest - point.createdAt).toBeLessThan(8 * DAY)
  // Both bands are represented: today at hourly resolution, and days behind it.
  expect(
    points.filter((p) => newest - p.createdAt < DAY).length
  ).toBeGreaterThan(5)
  expect(points.some((p) => newest - p.createdAt >= DAY)).toBe(true)
})
