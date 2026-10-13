import { test, type Page } from "@playwright/test"

// TEMPORARY (issue 27): times the settle PR #101's first run did not see
// within fifteen seconds. Removed before this branch merges.

const settled = (page: Page) =>
  page.evaluate(() => {
    const { steps, wetSteps } = window.engine.historyUsage()
    return steps - wetSteps
  })

for (const probe of [
  { name: "four tiles, 400 steps", width: 300, from: 110, to: 190, steps: 400 },
  { name: "two tiles, 250 steps", width: 240, from: 80, to: 160, steps: 250 },
  { name: "four tiles, 0 steps", width: 300, from: 110, to: 190, steps: 0 },
])
  test(`settle probe: ${probe.name}`, async ({ page }) => {
    test.setTimeout(300_000)
    await page.goto(
      process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
    )
    await page.waitForFunction(() => !!window.engine)
    await page.evaluate(async (width) => {
      window.remountEngine({ manualFluidClock: true })
      await window.engine.dispatch({
        type: "resize",
        width,
        height: 400,
        devicePixelRatio: 1,
      })
      await window.engine.dispatch({ type: "initialize" })
      await window.engine.dispatch({ type: "setStabilization", strength: 0 })
      await window.engine.dispatch({ type: "setBrush", spacing: 0.125 })
      await window.engine.dispatch({ type: "setColor", hex: "#1040e0" })
      await window.engine.dispatch({ type: "addLayer" })
      await window.engine.dispatch({
        type: "setBrush",
        fluid: { water: 1, drying: 0, bleed: 0.5, edge: 0, granulation: 0 },
        radius: 30,
        flow: 0.3,
      })
    }, probe.width)
    const box = (await page.locator("canvas").boundingBox())!
    const row = 256 - 30 - 3
    await page.mouse.move(box.x + probe.from, box.y + row)
    await page.mouse.down()
    await page.mouse.move(box.x + probe.to, box.y + row, { steps: 30 })
    await page.mouse.up()
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        )
    )
    const before = await settled(page)
    const started = Date.now()
    await page.evaluate(
      (steps) => window.engine.dispatch({ type: "advanceFluid", steps }),
      probe.steps
    )
    const advanced = Date.now() - started
    await page.evaluate(() => window.engine.dispatch({ type: "dryNow" }))
    const dried = Date.now() - started
    const arrived = await page
      .waitForFunction(
        (n) =>
          window.engine.historyUsage().steps -
            window.engine.historyUsage().wetSteps >
          n,
        before,
        { timeout: 240_000 }
      )
      .then(
        () => `${Date.now() - started}ms`,
        () => "not within 240s"
      )
    console.log(
      `SETTLE PROBE ${probe.name}: advance returned ${advanced}ms, dryNow returned ${dried}ms, settle step arrived ${arrived}`
    )
  })
