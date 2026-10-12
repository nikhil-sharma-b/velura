import { expect, test } from "@playwright/test"
import { decodeFloat16 } from "../../engine/doc/float16"

for (const radius of [12, 32, 128, 256, 513, 1024])
  for (const tip of [false, true])
    test(`${radius} px ${tip ? "textured tip" : "disc"} wet deposition preserves stored paint and retained load`, async ({
      page,
    }) => {
      await page.goto(
        process.env.VELURA_TEST_HARNESS ??
          "http://127.0.0.1:3101/tests/harness/"
      )
      await page.waitForFunction(() => !!window.wetDepositionProbe)
      const probe = (layerTarget: boolean, cancel: boolean) =>
        page.evaluate((options) => window.wetDepositionProbe(options), {
          radius,
          tip,
          layerTarget,
          cancel,
        })
      const reference = await probe(true, false)
      const scratch = await probe(false, false)
      const cancelled = await probe(false, true)
      const cancelledReference = await probe(true, true)
      expect(
        scratch.texels.filter((bits, i) => bits !== reference.texels[i]).length
      ).toBe(0)
      expect(
        cancelled.texels.filter(
          (bits, i) => bits !== cancelledReference.texels[i]
        ).length
      ).toBe(0)
      expect(scratch.dirty).toBe(true)
      expect(scratch.cleaned).toBe(true)
    })

for (const [name, options] of [
  [
    "aligned pickup without deposition",
    { radius: 33, aligned: true, pickupOnly: true },
  ],
  [
    "aligned pickup from a power-of-two layer",
    { radius: 256, aligned: true, large: true },
  ],
  [
    "aligned pickup with changing radii",
    { radius: 33, aligned: true, changingRadius: true },
  ],
  [
    "aligned pickup within a feathered selection",
    { radius: 33, aligned: true, selected: true },
  ],
  ["aligned pickup on paper", { radius: 33, aligned: true, decorated: true }],
  ["aligned pickup at radius 12", { radius: 12, aligned: true }],
  ["aligned pickup at radius 33", { radius: 33, aligned: true }],
  ["aligned pickup at radius 129", { radius: 129, aligned: true }],
  ["aligned pickup at radius 513", { radius: 513, aligned: true }],
  ["aligned pickup at a fractional centre", { radius: 32, aligned: true }],
  [
    "aligned scattered pickup at partial edges",
    { radius: 256, aligned: true, large: true, spread: true, edge: true },
  ],
  [
    "partial edge tiles and backup row transitions",
    { radius: 256, large: true, spread: true, edge: true },
  ],
  ["pickup without deposition", { radius: 32, pickupOnly: true }],
  ["paper and a feathered selection", { radius: 32, decorated: true }],
  ["a large neighbourhood", { radius: 256, large: true }],
  ["widely scattered dabs", { radius: 128, large: true, spread: true }],
] as const)
  test(`wet deposition with ${name} matches the layer path`, async ({
    page,
  }) => {
    await page.goto(
      process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
    )
    await page.waitForFunction(() => !!window.wetDepositionProbe)
    const probe = (layerTarget: boolean) =>
      page.evaluate((options) => window.wetDepositionProbe(options), {
        ...options,
        tip: !("aligned" in options),
        cancel: true,
        layerTarget,
      })
    const reference = await probe(true)
    const scratch = await probe(false)
    expect(
      scratch.texels.filter((bits, i) => bits !== reference.texels[i]).length
    ).toBe(0)
  })

// Changing interpolation can move stored half-floats. Bound that adjustment
// against the previous raster mapping separately from path equivalence.
for (const radius of [32, 33, 129, 513])
  test(`${radius} px procedural pickup stays near the previous raster mapping`, async ({
    page,
  }) => {
    await page.goto(
      process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
    )
    await page.waitForFunction(() => !!window.wetDepositionProbe)
    const probe = (legacyPickup: boolean) =>
      page.evaluate((options) => window.wetDepositionProbe(options), {
        radius,
        tip: false,
        aligned: true,
        layerTarget: true,
        cancel: true,
        legacyPickup,
      })
    const previous = await probe(true)
    const current = await probe(false)
    const difference = current.texels.reduce(
      (maximum, bits, i) =>
        Math.max(
          maximum,
          Math.abs(decodeFloat16(bits) - decodeFloat16(previous.texels[i]))
        ),
      0
    )
    expect(difference).toBeLessThanOrEqual(1 / 4096)
  })

test("compute and scratch wet steps preserve scattered dabs, selection and retained loads", async ({
  page,
}) => {
  await page.goto(
    process.env.VELURA_TEST_HARNESS ?? "http://127.0.0.1:3101/tests/harness/"
  )
  await page.waitForFunction(() => !!window.wetDepositionProbe)
  const probe = (layerTarget: boolean, scratchTarget = false) =>
    page.evaluate((options) => window.wetDepositionProbe(options), {
      radius: 256,
      tip: false,
      aligned: true,
      large: true,
      spread: true,
      powerOfTwo: true,
      selected: true,
      pickupOnly: true,
      cancel: true,
      layerTarget,
      scratchTarget,
    })
  const reference = await probe(true)
  const scratch = await probe(false, true)
  const computed = await probe(false)
  expect(scratch.texels).toEqual(reference.texels)
  expect(computed.texels).toEqual(reference.texels)
})
