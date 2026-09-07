import { expect, test } from "bun:test"
import { eraserBrush } from "@/engine/brush/eraser"
import {
  evaluateDynamics,
  NEUTRAL_STAMP_CONTEXT,
} from "@/engine/brush/dynamics"

test("solid eraser stays fully opaque and full width at every pressure and tilt", () => {
  const eraser = eraserBrush()
  for (const pressure of [0, 0.01, 0.5, 1]) {
    const response = evaluateDynamics(eraser.dynamics, {
      ...NEUTRAL_STAMP_CONTEXT,
      pressure,
      tilt: 0.8,
    })
    expect(response.size).toBe(1)
    expect(response.flow * eraser.rendering.flow).toBe(1)
    expect(response.opacity * eraser.rendering.opacity).toBe(1)
  }
  expect(eraser.shape.feather).toBe(0)
  expect(eraser.shape.tipTextureId).toBeUndefined()
  expect(eraser.grain).toBeUndefined()
})

test("pressure eraser changes width without leaving a translucent residue", () => {
  const eraser = eraserBrush("pressure")
  const light = evaluateDynamics(eraser.dynamics, {
    ...NEUTRAL_STAMP_CONTEXT,
    pressure: 0.1,
  })
  const heavy = evaluateDynamics(eraser.dynamics, {
    ...NEUTRAL_STAMP_CONTEXT,
    pressure: 1,
  })
  expect(heavy.size).toBeGreaterThan(light.size * 4)
  expect(light.flow).toBe(1)
  expect(light.opacity).toBe(1)
})

test("eraser settings reject invalid sizes and opacity", () => {
  expect(() => eraserBrush("solid", 0)).toThrow()
  expect(() => eraserBrush("solid", NaN)).toThrow()
  expect(() => eraserBrush("solid", 12, 2)).toThrow()
})
