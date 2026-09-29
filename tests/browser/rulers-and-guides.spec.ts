import { expect, test, type Page } from "@playwright/test"

/**
 * Rulers and guides (16). The guide model is checked through the engine's
 * facade — one step each, saved with the document, snapped to while shown —
 * and the rulers and guide dragging through the studio an artist uses.
 */

const WIDTH = 200
const HEIGHT = 120

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

const guides = (page: Page) =>
  page.evaluate(() =>
    window.engine
      .getSnapshot()
      .guides.map(({ axis, position }) => ({ axis, position }))
  )

const dispatch = (page: Page, command: unknown) =>
  page.evaluate((command) => window.engine.dispatch(command as never), command)

test("laying down, moving and removing a guide are each one step", async ({
  page,
}) => {
  await openCanvas(page)
  await dispatch(page, { type: "addGuide", axis: "x", position: 50 })
  await dispatch(page, { type: "addGuide", axis: "y", position: 30 })
  expect(await guides(page)).toEqual([
    { axis: "x", position: 50 },
    { axis: "y", position: 30 },
  ])
  const id = await page.evaluate(() => window.engine.getSnapshot().guides[0].id)
  await dispatch(page, { type: "moveGuide", id, position: 75 })
  expect((await guides(page))[0]).toEqual({ axis: "x", position: 75 })
  await dispatch(page, { type: "removeGuide", id })
  expect(await guides(page)).toEqual([{ axis: "y", position: 30 }])

  await dispatch(page, { type: "undo" })
  expect((await guides(page))[0]).toEqual({ axis: "x", position: 75 })
  await dispatch(page, { type: "undo" })
  expect((await guides(page))[0]).toEqual({ axis: "x", position: 50 })
  await dispatch(page, { type: "undo" })
  await dispatch(page, { type: "undo" })
  expect(await guides(page)).toEqual([])
  await dispatch(page, { type: "redo" })
  expect(await guides(page)).toEqual([{ axis: "x", position: 50 }])
})

test("guides are saved with the document and come back with it", async ({
  page,
}) => {
  const documentId = `doc-${Math.random().toString(36).slice(2)}`
  await openCanvas(page, documentId)
  await dispatch(page, { type: "addGuide", axis: "x", position: 64 })
  await dispatch(page, { type: "addGuide", axis: "y", position: 12.5 })
  await page.evaluate(() => window.engine.save())

  await page.reload()
  await page.waitForFunction(() => !!window.engine)
  await openCanvas(page, documentId)
  expect(await guides(page)).toEqual([
    { axis: "x", position: 64 },
    { axis: "y", position: 12.5 },
  ])
})

test("a transform snaps to guides while they are shown, and not once hidden", async ({
  page,
}) => {
  await openCanvas(page)
  const targets = () =>
    page.evaluate(async () => {
      const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(255)
      if (window.engine.getSnapshot().layers.length < 2)
        await window.engine.dispatch({
          type: "placeImage",
          name: "Small",
          image: { width: 10, height: 10, pixels },
        })
      const id = window.engine.getSnapshot().activeLayerId
      await window.engine.dispatch({ type: "beginImageTransform", id })
      const found = window.engine.getSnapshot().imageTransform!.snapTargets
      await window.engine.dispatch({ type: "cancelImageTransform" })
      return found
    })
  await dispatch(page, { type: "addGuide", axis: "x", position: 33 })
  await dispatch(page, { type: "addGuide", axis: "y", position: 77 })
  const shown = await targets()
  expect(shown.x).toContain(33)
  expect(shown.y).toContain(77)

  await dispatch(page, { type: "setGuidesVisible", visible: false })
  const hidden = await targets()
  expect(hidden.x).not.toContain(33)
  expect(hidden.y).not.toContain(77)
  // Hidden, not deleted.
  expect(await guides(page)).toHaveLength(2)
})

test("rulers toggle, and guides drag out of them, move, hide and go back", async ({
  page,
}) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  const canvas = page.getByRole("img", { name: "Drawing canvas" })
  const top = page.getByTestId("ruler-top")
  await expect(top).not.toBeAttached()
  await page.keyboard.press("ControlOrMeta+r")
  await expect(top).toBeVisible()
  await expect(page.getByTestId("ruler-left")).toBeVisible()

  const bounds = (await canvas.boundingBox())!
  const guide = page.getByTestId("guide")

  // Down out of the top ruler: a horizontal guide where it is let go.
  const startX = bounds.x + bounds.width / 2
  await page.mouse.move(startX, bounds.y + 8)
  await page.mouse.down()
  await page.mouse.move(startX, bounds.y + 150, { steps: 5 })
  await expect(page.getByTestId("guide-preview")).toBeAttached()
  await page.mouse.up()
  await expect(guide).toHaveCount(1)
  await expect(guide).toHaveAttribute("data-axis", "y")
  const placed = Number(await guide.getAttribute("data-position"))

  // Dragged along: it moves, as one step.
  const line = (await guide.boundingBox())!
  const y = line.y + line.height / 2
  await page.mouse.move(startX + 40, y)
  await page.mouse.down()
  await page.mouse.move(startX + 40, y + 60, { steps: 5 })
  await page.mouse.up()
  await expect
    .poll(async () => Number(await guide.getAttribute("data-position")))
    .toBeGreaterThan(placed)

  // Hidden, then shown again, without being deleted.
  await page.keyboard.press("ControlOrMeta+'")
  await expect(guide).toHaveCount(0)
  await page.keyboard.press("ControlOrMeta+'")
  await expect(guide).toHaveCount(1)

  // Back onto the ruler: gone.
  const moved = (await guide.boundingBox())!
  await page.mouse.move(startX + 40, moved.y + moved.height / 2)
  await page.mouse.down()
  await page.mouse.move(startX + 40, bounds.y + 6, { steps: 5 })
  await page.mouse.up()
  await expect(guide).toHaveCount(0)
})

test("the rulers follow the view as it zooms and turns", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("main")).toHaveAttribute(
    "data-engine-status",
    "ready"
  )
  await page.keyboard.press("ControlOrMeta+r")
  const top = page.getByTestId("ruler-top")
  const labels = () => top.locator("text").allTextContents()
  const fitted = await labels()
  expect(fitted.length).toBeGreaterThan(1)

  await page.keyboard.press("=")
  await expect.poll(labels).not.toEqual(fitted)
  const zoomed = await labels()

  await page.keyboard.press(".")
  await expect.poll(labels).not.toEqual(zoomed)
})
