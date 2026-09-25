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
  return pixel[0]! < 128 && pixel[2]! < 128
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

/**
 * Reverting a preview. The panel offers "Cancel" on a previewed restore, and
 * what stands behind that button is `revertRestore` — which must refuse
 * rather than undo the wrong step once the artist has painted over the
 * preview (see `engine.canRevertRestore`).
 */

const canRevert = (page: Page) =>
  page.evaluate(() => window.engine.canRevertRestore())

const revert = (page: Page) =>
  page.evaluate(() => window.engine.revertRestore())

/** Paints a stroke, flushes it, and hands back that flush's restore point. */
async function flushedPoint(page: Page, origin: { x: number; y: number }) {
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [point] = await restorePoints(page)
  return point!
}

test("reverting a preview puts the artist back where they started", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())
  const earlier = await flushedPoint(page, origin)
  await paint(page, origin, 90)

  expect(await canRevert(page)).toBe(false)
  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier.id
  )
  expect(await canRevert(page)).toBe(true)
  expect(await painted(page, 30, 90)).toBe(false)

  expect(await revert(page)).toBe(true)

  // The work the preview covered is back, and the preview is not.
  expect(await painted(page, 30, 90)).toBe(true)
  expect(await painted(page, 30, 30)).toBe(true)
  // Nothing left to revert: a second Cancel must not eat the stroke beneath.
  expect(await canRevert(page)).toBe(false)
  expect(await revert(page)).toBe(false)
})

test("a stroke painted over a preview ends the revert, rather than being eaten by it", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())
  const earlier = await flushedPoint(page, origin)
  await paint(page, origin, 90)
  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier.id
  )

  // The canvas stays live during a preview: the artist paints on top of it.
  await paint(page, origin, 60)
  expect(await painted(page, 30, 60)).toBe(true)

  expect(await canRevert(page)).toBe(false)
  expect(await revert(page)).toBe(false)

  // Their stroke is untouched — this is the hazard the guard exists for —
  // and the restored state is still restored rather than half taken back.
  expect(await painted(page, 30, 60)).toBe(true)
  expect(await painted(page, 30, 90)).toBe(false)
})

test("previewing a second point leaves one step over the artist's work, not two", async ({
  page,
}) => {
  const origin = await openWithCloud(page, newId())
  const first = await flushedPoint(page, origin)
  await paint(page, origin, 60)
  await page.evaluate(() => window.engine.save())
  const points = await restorePoints(page)
  const second = points.find((point) => point.id !== first.id)!
  await paint(page, origin, 90)
  const own = await page.evaluate(() => window.engine.historyUsage().steps)

  // What the panel does when a second point is picked while one is previewed.
  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    first.id
  )
  await page.evaluate(() => window.engine.revertRestore())
  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    second.id
  )

  expect(await page.evaluate(() => window.engine.historyUsage().steps)).toBe(
    own + 1
  )
  // One revert is enough to get the whole session's work back.
  expect(await revert(page)).toBe(true)
  expect(await painted(page, 30, 90)).toBe(true)
})

/** Opens the same document again against the same fake cloud, as a reload would. */
async function reopen(page: Page, documentId: string) {
  await page.evaluate(
    async ([width, height, id]) => {
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
}

test("a preview that is never kept is not saved, so a reload comes back to now", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  await paint(page, origin, 90)
  await page.evaluate(() => window.engine.save())
  const versionsBefore = (await restorePoints(page)).length

  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  expect(await painted(page, 30, 90)).toBe(false)
  // What a hidden or closing tab asks for — and what an idle flush would do.
  await page.evaluate(() => window.engine.save())

  // The tab goes without the preview being taken back: nothing reverts it.
  await reopen(page, documentId)

  expect(await painted(page, 30, 90)).toBe(true)
  expect((await restorePoints(page)).length).toBe(versionsBefore)
})

test("keeping a preview saves it, locally and to the cloud", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  await paint(page, origin, 90)
  await page.evaluate(() => window.engine.save())

  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  await page.evaluate(() => window.engine.keepRestore())
  expect(await page.evaluate(() => window.engine.canRevertRestore())).toBe(
    false
  )

  await reopen(page, documentId)
  expect(await painted(page, 30, 90)).toBe(false)
  expect(await painted(page, 30, 30)).toBe(true)
})

test("painting over a preview makes it the artist's work, saved like any other", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  await paint(page, origin, 90)
  await page.evaluate(() => window.engine.save())

  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  await paint(page, origin, 60)
  await page.evaluate(() => window.engine.save())

  await reopen(page, documentId)
  expect(await painted(page, 30, 60)).toBe(true)
  expect(await painted(page, 30, 90)).toBe(false)
})

test("once painted over, a preview stays the artist's even after undoing that paint", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openWithCloud(page, documentId)
  await paint(page, origin, 30)
  await page.evaluate(() => window.engine.save())
  const [earlier] = await restorePoints(page)
  await paint(page, origin, 90)
  await page.evaluate(() => window.engine.save())

  await page.evaluate(
    (versionId) => window.engine.restoreVersion(versionId as string),
    earlier!.id
  )
  await paint(page, origin, 60)
  // The paint ends the trial for good: undoing it lands on a restore the
  // artist has already made theirs, which nothing may now take back.
  await page.evaluate(() => window.engine.dispatch({ type: "undo" }))
  expect(await page.evaluate(() => window.engine.canRevertRestore())).toBe(
    false
  )
  await page.evaluate(() => window.engine.save())

  await reopen(page, documentId)
  expect(await painted(page, 30, 30)).toBe(true)
  expect(await painted(page, 30, 60)).toBe(false)
  expect(await painted(page, 30, 90)).toBe(false)
})
