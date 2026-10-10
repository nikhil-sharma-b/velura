import { describe, expect, test } from "bun:test"
import type { Curve } from "../../engine/brush/curve"
import {
  dynamicsForDevice,
  evaluateDynamics,
  type Modulator,
  NEUTRAL_STAMP_CONTEXT,
  type StampContext,
  validateDynamics,
} from "../../engine/brush/dynamics"

/** Halves its input at the midpoint: a stiff, heavy-handed response. */
const HARD: Curve = [
  { x: 0, y: 0 },
  { x: 0.5, y: 0.25 },
  { x: 1, y: 1 },
]

function context(overrides: Partial<StampContext> = {}): StampContext {
  return { ...NEUTRAL_STAMP_CONTEXT, ...overrides }
}

describe("dynamics graph evaluation", () => {
  test("no modulators leaves every parameter neutral", () => {
    const params = evaluateDynamics([], context({ pressure: 0.3 }))
    expect(params).toEqual({
      size: 1,
      opacity: 1,
      flow: 1,
      angle: 0,
      roundness: 1,
      grainDepth: 1,
      scatter: 1,
      pickup: 1,
      hue: 0,
      saturation: 0,
      lightness: 0,
    })
  })

  test("pressure at 0.5 through a hard curve into [0.2, 1] gives size 0.4", () => {
    // The curve turns 0.5 into 0.25; the range turns 0.25 into
    // 0.2 + 0.8 * 0.25 = 0.4; multiplying onto a neutral size leaves 0.4.
    const modulator: Modulator = {
      source: "pressure",
      target: "size",
      curve: HARD,
      range: [0.2, 1],
      mix: "multiply",
    }
    expect(
      evaluateDynamics([modulator], context({ pressure: 0.5 })).size
    ).toBeCloseTo(0.4, 5)
  })

  test("a linear mapping is the plain interpolation of its range", () => {
    const modulator: Modulator = {
      source: "pressure",
      target: "flow",
      range: [0.25, 0.75],
      mix: "multiply",
    }
    expect(
      evaluateDynamics([modulator], context({ pressure: 0 })).flow
    ).toBeCloseTo(0.25, 6)
    expect(
      evaluateDynamics([modulator], context({ pressure: 0.5 })).flow
    ).toBeCloseTo(0.5, 6)
    expect(
      evaluateDynamics([modulator], context({ pressure: 1 })).flow
    ).toBeCloseTo(0.75, 6)
  })

  test("a reversed range inverts the response", () => {
    // Drawing faster thins the line: full velocity maps to the low end.
    const modulator: Modulator = {
      source: "velocity",
      target: "size",
      range: [1, 0.3],
      mix: "multiply",
    }
    expect(
      evaluateDynamics([modulator], context({ velocity: 0 })).size
    ).toBeCloseTo(1, 6)
    expect(
      evaluateDynamics([modulator], context({ velocity: 1 })).size
    ).toBeCloseTo(0.3, 6)
  })

  test("any source can drive any target", () => {
    const sources = [
      "pressure",
      "tilt",
      "tiltDirection",
      "velocity",
      "direction",
      "random",
      "strokeProgress",
    ] as const
    const targets = [
      "size",
      "opacity",
      "flow",
      "angle",
      "roundness",
      "grainDepth",
      "scatter",
      "hue",
    ] as const
    for (const source of sources)
      for (const target of targets) {
        const modulator: Modulator = {
          source,
          target,
          range: [0, 1],
          mix: "replace",
        }
        const params = evaluateDynamics(
          [modulator],
          context({ [source]: 0.5, random: 0.5 })
        )
        expect(params[target]).toBeCloseTo(0.5, 5)
      }
  })

  describe("mixing onto one target", () => {
    const half = (mix: Modulator["mix"]): Modulator => ({
      source: "pressure",
      target: "size",
      range: [0.5, 0.5],
      mix,
    })

    test("multiplies compound, whatever order they sit in", () => {
      const both = [half("multiply"), half("multiply")]
      expect(evaluateDynamics(both, context()).size).toBeCloseTo(0.25, 6)
      expect(evaluateDynamics([...both].reverse(), context()).size).toBeCloseTo(
        0.25,
        6
      )
    })

    test("add offsets what is already there", () => {
      expect(
        evaluateDynamics([half("multiply"), half("add")], context()).size
      ).toBeCloseTo(1, 6)
    })

    test("replace discards the mappings above it and none below", () => {
      const params = evaluateDynamics(
        [half("multiply"), half("replace"), half("multiply")],
        context()
      )
      // The replace wipes the first multiply; the last one still applies.
      expect(params.size).toBeCloseTo(0.25, 6)
    })
  })

  describe("limits", () => {
    test("a stack of adds cannot push opacity above one", () => {
      const add: Modulator = {
        source: "pressure",
        target: "opacity",
        range: [1, 1],
        mix: "add",
      }
      expect(evaluateDynamics([add, add], context()).opacity).toBe(1)
    })

    test("pickup stays in [0, 1], whatever is stacked onto it", () => {
      const add = (amount: number): Modulator => ({
        source: "pressure",
        target: "pickup",
        range: [amount, amount],
        mix: "add",
      })
      expect(evaluateDynamics([add(1), add(1)], context()).pickup).toBe(1)
      expect(evaluateDynamics([add(-4)], context()).pickup).toBe(0)
    })

    test("a negative range cannot produce a negative radius", () => {
      const modulator: Modulator = {
        source: "pressure",
        target: "size",
        range: [-4, -4],
        mix: "add",
      }
      expect(evaluateDynamics([modulator], context()).size).toBe(0)
    })

    test("angle wraps rather than clamping, because a turn is cyclic", () => {
      const modulator: Modulator = {
        source: "direction",
        target: "angle",
        range: [0, 1],
        mix: "add",
      }
      // Two mappings at 0.75 of a turn come back round to a quarter turn.
      expect(
        evaluateDynamics([modulator, modulator], context({ direction: 0.75 }))
          .angle
      ).toBeCloseTo(0.5, 5)
    })
  })

  test("evaluation writes into the object it is given and allocates none", () => {
    const out = evaluateDynamics([], context())
    const again = evaluateDynamics(
      [
        {
          source: "pressure",
          target: "size",
          range: [0, 0.5],
          mix: "multiply",
        },
      ],
      context({ pressure: 1 }),
      out
    )
    expect(again).toBe(out)
    expect(out.size).toBeCloseTo(0.5, 6)
  })

  test("a reused output carries nothing over from the dab before it", () => {
    const out = evaluateDynamics(
      [{ source: "pressure", target: "flow", range: [0, 0.2], mix: "replace" }],
      context({ pressure: 1 })
    )
    expect(out.flow).toBeCloseTo(0.2, 6)
    evaluateDynamics([], context(), out)
    expect(out.flow).toBe(1)
  })

  describe("validation", () => {
    const valid: Modulator = {
      source: "pressure",
      target: "size",
      range: [0, 1],
      mix: "multiply",
    }

    test("accepts a well-formed graph", () => {
      expect(() =>
        validateDynamics([valid, { ...valid, curve: HARD }])
      ).not.toThrow()
    })

    test("rejects an unknown source, target or mix", () => {
      expect(() =>
        validateDynamics([{ ...valid, source: "vibes" as never }])
      ).toThrow(/source/)
      expect(() =>
        validateDynamics([{ ...valid, target: "wetness" as never }])
      ).toThrow(/target/)
      expect(() =>
        validateDynamics([{ ...valid, mix: "blend" as never }])
      ).toThrow(/mix/)
    })

    test("rejects a multiply onto a target that is an offset", () => {
      // Angle and hue start at zero, so a multiply onto them is zero whatever
      // the pen does: an authoring mistake, not a subtle brush.
      for (const target of ["angle", "hue"] as const)
        expect(() =>
          validateDynamics([{ ...valid, target, mix: "multiply" }])
        ).toThrow(/offset/)
      expect(() =>
        validateDynamics([{ ...valid, target: "angle", mix: "add" }])
      ).not.toThrow()
      // Scatter scales the brush's own amount, as size scales its radius.
      expect(() =>
        validateDynamics([{ ...valid, target: "scatter", mix: "multiply" }])
      ).not.toThrow()
    })

    test("rejects a range that is not two finite numbers", () => {
      expect(() =>
        validateDynamics([{ ...valid, range: [0, Infinity] }])
      ).toThrow(/range/)
    })

    test("rejects a curve that is not a function of its input", () => {
      expect(() =>
        validateDynamics([
          {
            ...valid,
            curve: [
              { x: 0, y: 0 },
              { x: 0.5, y: 1 },
              { x: 0.5, y: 0 },
            ],
          },
        ])
      ).toThrow(/increase/)
      expect(() =>
        validateDynamics([{ ...valid, curve: [{ x: 0, y: 0 }] }])
      ).toThrow(/two points/)
      expect(() =>
        validateDynamics([
          {
            ...valid,
            curve: [
              { x: 0, y: 0 },
              { x: 1, y: 4 },
            ],
          },
        ])
      ).toThrow(/unit square/)
    })
  })
})

describe("dynamics for a device without a pressure sensor", () => {
  const brush: Modulator[] = [
    { source: "pressure", target: "flow", range: [0.1, 1], mix: "multiply" },
    { source: "pressure", target: "size", range: [0.6, 1.15], mix: "multiply" },
    { source: "tilt", target: "size", range: [1, 2.6], mix: "multiply" },
    { source: "velocity", target: "size", range: [1, 0.5], mix: "multiply" },
    { source: "random", target: "angle", range: [0, 1], mix: "add" },
  ]

  test("a device with no sensor draws at the brush's nominal size and flow", () => {
    const params = evaluateDynamics(
      dynamicsForDevice(brush, false),
      context({ pressure: 1 })
    )
    expect(params.size).toBeCloseTo(1)
    expect(params.flow).toBeCloseTo(1)
  })

  test("a device with no sensor picks up at the brush's own setting", () => {
    const graph: Modulator[] = [
      { source: "pressure", target: "pickup", range: [0, 1], mix: "multiply" },
    ]
    expect(
      evaluateDynamics(dynamicsForDevice(graph, false), context()).pickup
    ).toBe(1)
    expect(
      evaluateDynamics(
        dynamicsForDevice(graph, true),
        context({ pressure: 0.25 })
      ).pickup
    ).toBeCloseTo(0.25)
  })

  test("tilt, velocity and randomness still reach the dab", () => {
    const params = evaluateDynamics(
      dynamicsForDevice(brush, false),
      context({ tilt: 1, velocity: 1, random: 0.25 })
    )
    expect(params.size).toBeCloseTo(1.3)
    expect(params.angle).toBeCloseTo(0.25)
  })

  test("a pen reporting zero keeps its zero", () => {
    const params = evaluateDynamics(
      dynamicsForDevice(brush, true),
      context({ pressure: 0 })
    )
    expect(params.flow).toBeCloseTo(0.1)
    expect(params.size).toBeCloseTo(0.6)
  })

  test("the answer is stable per graph, so a stroke allocates nothing per dab", () => {
    expect(dynamicsForDevice(brush, true)).toBe(brush)
    expect(dynamicsForDevice(brush, false)).toBe(
      dynamicsForDevice(brush, false)
    )
  })
})

test("colour offsets clamp saturation and lightness and reject multiplication", () => {
  const graph: Modulator[] = [
    { source: "random", target: "saturation", range: [-2, 2], mix: "replace" },
    { source: "pressure", target: "lightness", range: [-2, 2], mix: "add" },
  ]
  expect(() => validateDynamics(graph)).not.toThrow()
  const params = evaluateDynamics(graph, context({ random: 0, pressure: 1 }))
  expect(params.saturation).toBe(-1)
  expect(params.lightness).toBe(1)
  expect(() => validateDynamics([{ ...graph[0], mix: "multiply" }])).toThrow()
})

test("a fixed seed reproduces all colour jitter offsets", async () => {
  const { createStampContextTracker } =
    await import("../../engine/brush/stamp-context")
  const graph: Modulator[] = [
    { source: "random", target: "hue", range: [-0.2, 0.2], mix: "add" },
    { source: "random", target: "saturation", range: [-0.4, 0.4], mix: "add" },
    { source: "random", target: "lightness", range: [-0.1, 0.1], mix: "add" },
  ]
  const sample = (seed: number) => {
    const tracker = createStampContextTracker()
    tracker.begin(0, 0, 1, 0, 0, 0, seed)
    return Array.from({ length: 12 }, (_, i) => {
      const { hue, saturation, lightness } = evaluateDynamics(
        graph,
        tracker.next(i, 0, 1, 0, 0, i)
      )
      return [hue, saturation, lightness]
    })
  }
  expect(sample(42)).toEqual(sample(42))
  expect(sample(43)).not.toEqual(sample(42))
  expect(new Set(sample(42).map((dab) => dab[0])).size).toBe(12)
})

test("hue offsets keep their signed magnitude until the brush base scales them", () => {
  const graph: Modulator[] = [
    { source: "random", target: "hue", range: [-0.25, -0.25], mix: "replace" },
  ]
  expect(evaluateDynamics(graph, context()).hue).toBe(-0.25)
})
