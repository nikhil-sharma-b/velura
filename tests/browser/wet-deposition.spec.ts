import { expect, test } from "@playwright/test"

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
        tip: true,
        cancel: true,
        layerTarget,
      })
    const reference = await probe(true)
    const scratch = await probe(false)
    expect(
      scratch.texels.filter((bits, i) => bits !== reference.texels[i]).length
    ).toBe(0)
  })
