import { expect, test } from "bun:test"
import {
  evaluateDynamics,
  NEUTRAL_STAMP_CONTEXT,
} from "@/engine/brush/dynamics"
import { builtinBrush } from "@/engine/brush/presets"

const material = (name: string) => builtinBrush(`builtin:${name}`)!
const response = (name: string, pressure: number, tilt = 0) =>
  evaluateDynamics(material(name).dynamics, {
    ...NEUTRAL_STAMP_CONTEXT,
    pressure,
    tilt,
  })

test("graphite darkens with pressure and broadens when shading with the side", () => {
  expect(response("pencil", 1).flow).toBeGreaterThan(
    response("pencil", 0.1).flow * 3
  )
  expect(response("pencil", 1, 0.8).size).toBeGreaterThan(
    response("pencil", 1).size
  )
  expect(response("pencil", 1, 0.8).roundness).toBeLessThan(
    response("pencil", 1).roundness
  )
})

test("ink varies line width much more than a firm felt nib", () => {
  const inkRange = response("ink", 1).size / response("ink", 0.1).size
  const markerRange = response("marker", 1).size / response("marker", 0.1).size
  expect(inkRange).toBeGreaterThan(markerRange * 3)
  expect(material("marker").shape.roundness).toBeLessThan(0.5)
})

test("spray builds tone through overlap and falls off across the entire tip", () => {
  const spray = material("airbrush")
  expect(spray.rendering.accumulation).toBe("buildup")
  expect(spray.shape.feather).toBeGreaterThanOrEqual(spray.shape.radius)
  expect(spray.rendering.flow).toBeLessThan(0.1)
  expect(response("airbrush", 1).flow).toBeGreaterThan(
    response("airbrush", 0.1).flow
  )
})

test("dry media keep paper tooth anchored to the canvas", () => {
  for (const name of ["pencil", "charcoal"]) {
    expect(material(name).grain?.movement).toBe(0)
    expect(material(name).grain?.depth).toBeGreaterThan(0.7)
    expect(material(name).shape.tipTextureId).toBeDefined()
  }
})
