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
