import { describe, expect, test } from "bun:test"

import {
  alignedPlacement,
  placementExtent,
  resolveSnap,
  snapTargets,
} from "../../engine/doc/snap"
import type { ImagePlacement } from "../../engine/doc/image-placement"

const canvas = { width: 200, height: 100 }

const box = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width,
  height,
})

const placement = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation = 0
): ImagePlacement => ({
  x,
  y,
  width,
  height,
  rotation,
  flipX: false,
  flipY: false,
})

describe("what a box can snap to", () => {
  test("the canvas's edges and centre lines, and each other box's", () => {
    expect(snapTargets(canvas, [box(10, 20, 30, 40)])).toEqual({
      x: [0, 100, 200, 10, 25, 40],
      y: [0, 50, 100, 20, 40, 60],
    })
  })
})

describe("resolving a snap", () => {
  const targets = snapTargets(canvas, [])

  test("an edge near a target pulls the box onto it", () => {
    const snap = resolveSnap(box(3, 40, 20, 10), targets, 5)
    expect(snap.dx).toBe(-3)
    expect(snap.guides.x).toBe(0)
  })

  test("a centre snaps to a centre line", () => {
    const snap = resolveSnap(box(88, 44, 20, 10), targets, 5)
    expect(snap).toEqual({ dx: 2, dy: 1, guides: { x: 100, y: 50 } })
  })

  test("the right and bottom edges snap too", () => {
    const snap = resolveSnap(box(178, 88, 20, 10), targets, 5)
    expect(snap).toEqual({ dx: 2, dy: 2, guides: { x: 200, y: 100 } })
  })

  test("beyond the threshold nothing moves and no guide shows", () => {
    expect(resolveSnap(box(30, 20, 10, 10), targets, 5)).toEqual({
      dx: 0,
      dy: 0,
      guides: { x: null, y: null },
    })
  })

  test("the nearest of two candidates wins", () => {
    const near = snapTargets(canvas, [box(12, 70, 2, 5)])
    // The left edge is 3 from 12; the centre is 5 from 14.
    const snap = resolveSnap(box(9, 30, 20, 10), near, 5)
    expect(snap.dx).toBe(3)
    expect(snap.guides.x).toBe(12)
  })

  test("the axes resolve independently", () => {
    const snap = resolveSnap(box(2, 30, 20, 10), targets, 5)
    expect(snap).toEqual({ dx: -2, dy: 0, guides: { x: 0, y: null } })
  })
})

describe("a placement's extent", () => {
  test("is its box when unturned", () => {
    expect(placementExtent(placement(50, 40, 20, 10))).toEqual(
      box(40, 35, 20, 10)
    )
  })

  test("is the box round its turned corners, unrounded", () => {
    const extent = placementExtent(placement(50, 50, 20, 10, Math.PI / 2))
    expect(extent.x).toBeCloseTo(45)
    expect(extent.y).toBeCloseTo(40)
    expect(extent.width).toBeCloseTo(10)
    expect(extent.height).toBeCloseTo(20)
  })
})

describe("aligning a placement", () => {
  const start = placement(50, 40, 20, 10)
  const within = box(0, 0, 200, 100)

  test.each([
    ["left", { x: 10, y: 40 }],
    ["hcenter", { x: 100, y: 40 }],
    ["right", { x: 190, y: 40 }],
    ["top", { x: 50, y: 5 }],
    ["vcenter", { x: 50, y: 50 }],
    ["bottom", { x: 50, y: 95 }],
  ] as const)("%s moves only its own axis", (anchor, centre) => {
    expect(alignedPlacement(start, anchor, within)).toEqual({
      ...start,
      ...centre,
    })
  })

  test("a turned placement aligns by the box round it", () => {
    const turned = placement(50, 50, 20, 10, Math.PI / 2)
    const aligned = alignedPlacement(turned, "left", box(30, 0, 100, 100))
    expect(placementExtent(aligned).x).toBeCloseTo(30)
    expect(aligned.y).toBe(50)
  })
})
