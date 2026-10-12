import { expect, test, type Page } from "@playwright/test"
import type { SmearOptions } from "../harness/smudge-probe"

/**
 * A run of dragging dabs shares a compute pass and a dab too large for a run
 * is drawn by a render pass (live brushes 22). The two are one smear (live
 * brushes 27): the same dabs through either leave the layer the same, in
 * every bit of every channel as it is stored.
 */

const smear = (page: Page, options: SmearOptions) =>
  page.evaluate((options) => window.smearProbe(options), options)

/** The probe's canvas, across; `SMEAR_WIDTH` there. */
const WIDTH = 240
/** Alpha between the bar and the stripe on the first leg, where nothing was. */
const DRAGGED_INTO = (56 * WIDTH + 110) * 4 + 3

const dabs: [string, Omit<SmearOptions, "pass">][] = [
  ["a 2 px disc", { radius: 2 }],
  ["a 4 px disc", { radius: 4 }],
  ["an 8 px disc", { radius: 8 }],
  ["a 16 px disc", { radius: 16 }],
  ["a 40 px disc", { radius: 40 }],
  ["a hard-edged 16 px disc", { radius: 16, feather: 0 }],
  ["a soft 16 px disc", { radius: 16, feather: 12 }],
  [
    "a turned, narrowed 16 px tip",
    { radius: 16, tip: true, angle: 0.13, roundness: 0.6 },
  ],
]

for (const [name, options] of dabs)
  test(`${name} smears the same through the run pass and the render pass`, async ({
    page,
  }) => {
    await page.goto("http://127.0.0.1:3101/tests/harness/")
    await page.waitForFunction(() => !!window.smearProbe)
    const run = await smear(page, { ...options, pass: "run" })
    const render = await smear(page, { ...options, pass: "render" })
    // Each went the way it was sent, and paint was dragged.
    expect(run.computePasses).toBeGreaterThan(0)
    expect(run.renderPasses).toBe(0)
    expect(render.computePasses).toBe(0)
    expect(render.renderPasses).toBeGreaterThan(0)
    expect(run.texels[DRAGGED_INTO]).not.toBe(0)
    const differing = run.texels.filter(
      (bits, index) => bits !== render.texels[index]
    )
    expect(differing.length).toBe(0)
  })

test("a dab that grows past the run's limit in mid-stroke smears as it would through the render pass alone", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3101/tests/harness/")
  await page.waitForFunction(() => !!window.smearProbe)
  const options = { radius: 8, growsTo: 40, runSize: 96 }
  const mixed = await smear(page, { ...options, pass: "run" })
  const render = await smear(page, { ...options, pass: "render" })
  // The stroke began in runs and outgrew them.
  expect(mixed.computePasses).toBeGreaterThan(0)
  expect(mixed.renderPasses).toBeGreaterThan(0)
  expect(render.computePasses).toBe(0)
  const differing = mixed.texels.filter(
    (bits, index) => bits !== render.texels[index]
  )
  expect(differing.length).toBe(0)
})
