import { expect, test, type Page } from "@playwright/test"

/**
 * Local persistence, through the same seams the artist drives.
 *
 * The claim is not that a manifest round-trips — that is settled in unit tests
 * against an in-memory blob store — but that pixels which have been through
 * GPU textures, half-float tile blobs and the browser's own filesystem come
 * back to the tab byte for byte, without an account and without a save button.
 */

declare global {
  interface Window {
    /** What the engine said about work it could not keep. */
    restoreErrors: string[]
  }
}

const WIDTH = 200
const HEIGHT = 120

/** A point the test stroke passes through, inside the seeded scene. */
const MARKED = { x: 20, y: 10 }

type Image = { width: number; data: number[] }

async function openDocument(
  page: Page,
  documentId: string,
  size: { width: number; height: number } = { width: WIDTH, height: HEIGHT }
) {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.engine)
  await page.evaluate(
    async ([width, height, id]) => {
      window.restoreErrors = []
      window.remountEngine({
        persistence: {
          documentId: id as string,
          onError: (error: unknown) => window.restoreErrors.push(String(error)),
        },
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
    [size.width, size.height, documentId] as const
  )
  const box = (await page.locator("canvas").boundingBox())!
  return { x: box.x, y: box.y }
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

const channel = (image: Image, at: { x: number; y: number }, index: number) =>
  image.data[(at.y * image.width + at.x) * 4 + index]

const isInk = (image: Image, at: { x: number; y: number }) =>
  channel(image, at, 0) > 200 && channel(image, at, 2) > 200

/** A fresh id per test: OPFS outlives the page, which is the whole point. */
const newId = () => `doc-${Math.random().toString(36).slice(2)}`

test("a document reopens with its pixels after the tab is gone", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openDocument(page, documentId)
  await paint(page, origin, MARKED.y)
  const marked = await painted(page)
  expect(isInk(marked, MARKED)).toBe(true)
  await page.evaluate(() => window.engine.save())

  // No dispose, no unload handler: the tab simply stops existing.
  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openDocument(page, documentId)
  expect(await painted(page)).toEqual(marked)
})

test("layers come back with the stack they were left in", async ({ page }) => {
  const documentId = newId()
  const origin = await openDocument(page, documentId)
  await page.evaluate(() => window.engine.dispatch({ type: "addLayer" }))
  await paint(page, origin, 40)
  await page.evaluate(() =>
    window.engine.dispatch({
      type: "setLayer",
      id: window.engine.getSnapshot().activeLayerId,
      opacity: 0.5,
    })
  )
  const marked = await painted(page)
  const stack = await page.evaluate(() => {
    const snapshot = window.engine.getSnapshot()
    return {
      ids: snapshot.layers.map((layer) => layer.id),
      active: snapshot.activeLayerId,
    }
  })
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openDocument(page, documentId)
  expect(
    await page.evaluate(() => {
      const snapshot = window.engine.getSnapshot()
      return {
        ids: snapshot.layers.map((layer) => layer.id),
        active: snapshot.activeLayerId,
      }
    })
  ).toEqual(stack)
  expect(await painted(page)).toEqual(marked)
})

test("a completed stroke is durable without any save being asked for", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openDocument(page, documentId)
  await paint(page, origin, MARKED.y)
  const marked = await painted(page)
  // The stroke ended; nothing else is called. What is on disk is whatever the
  // commit itself put there.
  await page.waitForFunction(
    (id) =>
      navigator.storage
        .getDirectory()
        .then((root) => root.getDirectoryHandle("velura"))
        .then((dir) => dir.getFileHandle(encodeURIComponent(`documents/${id}`)))
        .then(() => true)
        .catch(() => false),
    documentId
  )

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openDocument(page, documentId)
  expect(await painted(page)).toEqual(marked)
})

test("an unknown document opens on a fresh canvas", async ({ page }) => {
  const origin = await openDocument(page, newId())
  const scene = await painted(page)
  expect(isInk(scene, MARKED)).toBe(false)
  await paint(page, origin, MARKED.y)
  expect(isInk(await painted(page), MARKED)).toBe(true)
})

test("a document opened at the wrong size is shown but not written over", async ({
  page,
}) => {
  const documentId = newId()
  const origin = await openDocument(page, documentId)
  await paint(page, origin, MARKED.y)
  const marked = await painted(page)
  await page.evaluate(() => window.engine.save())

  // The same document in a smaller window: the canvas is the document's extent
  // until ticket 29, so saving here would drop everything past the new edge.
  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  const narrow = await openDocument(page, documentId, {
    width: WIDTH / 2,
    height: HEIGHT,
  })
  expect(isInk(await painted(page), MARKED)).toBe(true)
  expect(await page.evaluate(() => window.restoreErrors)).toEqual([
    expect.stringContaining("nothing will be saved"),
  ])
  await paint(page, narrow, 60)
  await page.evaluate(() => window.engine.save())

  // Back at the size it was painted at, the work is untouched.
  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openDocument(page, documentId)
  expect(await painted(page)).toEqual(marked)
})
