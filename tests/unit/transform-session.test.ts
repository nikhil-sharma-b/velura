import { describe, expect, test } from "bun:test"

import {
  placementBounds,
  placementQuad,
  type ImagePlacement,
} from "@/engine/doc/image-placement"
import {
  IDENTITY,
  affineBounds,
  affineFromPlacement,
  affineQuad,
  applyAffine,
  beginTransform,
  type Affine,
  type TransformTarget,
} from "@/engine/doc/transform-session"

const SOURCE = { width: 100, height: 50 }

function recorder() {
  const calls: { kind: string; matrix: Affine; region?: unknown }[] = []
  const target: TransformTarget = {
    source: SOURCE,
    preview: (matrix) => calls.push({ kind: "preview", matrix }),
    commit: (matrix, region) => calls.push({ kind: "commit", matrix, region }),
    cancel: (matrix) => calls.push({ kind: "cancel", matrix }),
  }
  return { calls, target }
}

const shift = (dx: number, dy: number): Affine => [1, 0, 0, 1, dx, dy]

describe("affine maths", () => {
  test("maps points and the source rectangle's corners", () => {
    expect(applyAffine(shift(3, 4), { x: 1, y: 2 })).toEqual({ x: 4, y: 6 })
    expect(affineQuad(IDENTITY, SOURCE)).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 0, y: 50 },
    ])
    expect(affineBounds(shift(0.5, 0), SOURCE)).toEqual({
      x: 0,
      y: 0,
      width: 101,
      height: 50,
    })
  })

  test("a placement's matrix draws the same quad the placement does", () => {
    const placements: ImagePlacement[] = [
      {
        x: 200,
        y: 150,
        width: 100,
        height: 50,
        rotation: 0,
        flipX: false,
        flipY: false,
      },
      {
        x: 120,
        y: 80,
        width: 300,
        height: 40,
        rotation: 0.7,
        flipX: true,
        flipY: false,
      },
      {
        x: 50,
        y: 60,
        width: 20,
        height: 90,
        rotation: -2,
        flipX: true,
        flipY: true,
      },
    ]
    for (const placement of placements) {
      const matrix = affineFromPlacement(placement, SOURCE)
      const expected = placementQuad(placement)
      affineQuad(matrix, SOURCE).forEach((corner, index) => {
        expect(corner.x).toBeCloseTo(expected[index]!.x, 6)
        expect(corner.y).toBeCloseTo(expected[index]!.y, 6)
      })
      expect(affineBounds(matrix, SOURCE)).toEqual(placementBounds(placement))
    }
  })
})

describe("a transform session", () => {
  test("previews every update from the matrix given, never a composition", () => {
    const { calls, target } = recorder()
    const session = beginTransform(target, IDENTITY)
    session.update(shift(10, 0))
    session.update(shift(10, 0))
    session.update(shift(20, 0))
    expect(calls.map((call) => call.matrix)).toEqual([
      shift(10, 0),
      shift(20, 0),
    ])
    expect(session.matrix).toEqual(shift(20, 0))
    expect(session.start).toEqual(IDENTITY)
  })

  test("commits once over everywhere the preview has been", () => {
    const { calls, target } = recorder()
    const session = beginTransform(target, IDENTITY)
    session.update(shift(300, 0))
    session.update(shift(0, 200))
    expect(session.commit()).toBe(true)
    const commits = calls.filter((call) => call.kind === "commit")
    expect(commits).toHaveLength(1)
    expect(commits[0]!.matrix).toEqual(shift(0, 200))
    expect(commits[0]!.region).toEqual({ x: 0, y: 0, width: 400, height: 250 })
    // Finished: nothing more reaches the target.
    expect(session.commit()).toBe(false)
    session.update(shift(1, 1))
    expect(calls.filter((call) => call.kind !== "preview")).toHaveLength(1)
    expect(session.active).toBe(false)
  })

  test("an untouched commit is not a step", () => {
    const { calls, target } = recorder()
    const session = beginTransform(target, shift(5, 5))
    session.update(shift(5, 5))
    expect(session.commit()).toBe(false)
    expect(calls).toEqual([])
  })

  test("a changed description commits even when its matrix did not move", () => {
    const { calls, target } = recorder()
    const session = beginTransform(target, IDENTITY)
    expect(session.commit({ changed: true })).toBe(true)
    expect(calls.map((call) => call.kind)).toEqual(["commit"])
  })

  test("cancel discards and hands back where it started", () => {
    const { calls, target } = recorder()
    const session = beginTransform(target, shift(5, 5))
    session.update(shift(50, 5))
    session.cancel()
    expect(calls.at(-1)).toEqual({ kind: "cancel", matrix: shift(5, 5) })
    expect(calls.some((call) => call.kind === "commit")).toBe(false)
    expect(session.active).toBe(false)
    session.cancel()
    expect(calls.filter((call) => call.kind === "cancel")).toHaveLength(1)
  })

  test("rejects a matrix that cannot be drawn", () => {
    const { target } = recorder()
    const session = beginTransform(target, IDENTITY)
    expect(() => session.update([0, 0, 0, 0, 0, 0])).toThrow()
    expect(() => session.update([1, 0, 0, 1, Number.NaN, 0])).toThrow()
  })
})
