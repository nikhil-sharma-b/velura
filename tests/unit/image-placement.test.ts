import { describe, expect, test } from "bun:test"

import {
  centeredPlacement,
  flippedPlacement,
  handlePoints,
  movedPlacement,
  nudgedPlacement,
  placementBounds,
  placementCorners,
  placementRect,
  resolution,
  rotatedPlacement,
  samePlacement,
  scaledPlacement,
  validPlacement,
  type ImagePlacement,
} from "@/engine/doc/image-placement"

const CANVAS = { width: 400, height: 300 }

/** A 100x50 placement centred on the canvas, unrotated. */
const plain: ImagePlacement = {
  x: 200,
  y: 150,
  width: 100,
  height: 50,
  rotation: 0,
  flipX: false,
  flipY: false,
}

describe("where a placed image starts", () => {
  test("is centred, and scaled down only when it does not fit", () => {
    const placement = centeredPlacement({ width: 800, height: 300 }, CANVAS)
    expect(placement.x).toBe(200)
    expect(placement.y).toBe(150)
    // Half size: 800 wide into 400 is the binding constraint.
    expect(placement.width).toBeCloseTo(400, 6)
    expect(placement.height).toBeCloseTo(150, 6)
  })

  test("leaves a small picture at its own resolution rather than filling", () => {
    const placement = centeredPlacement({ width: 40, height: 20 }, CANVAS)
    expect(placement.width).toBe(40)
    expect(placement.height).toBe(20)
    expect(placement.rotation).toBe(0)
    expect(placement.flipX).toBe(false)
  })
})

describe("the box a placement covers", () => {
  test("is the rectangle itself while nothing is turned", () => {
    expect(placementRect(plain)).toEqual({
      x: 150,
      y: 125,
      width: 100,
      height: 50,
    })
  })

  test("grows to hold the corners once it is turned", () => {
    const turned = { ...plain, rotation: Math.PI / 2 }
    const bounds = placementBounds(turned)
    // A quarter turn swaps the extents; the box is whole pixels, outwards, so
    // resampling never has to guess at a pixel the box cut in half.
    expect(bounds.width).toBe(50)
    expect(bounds.height).toBe(100)
    expect(bounds.x).toBe(175)
    expect(bounds.y).toBe(100)
  })

  test("is whole pixels around what it holds", () => {
    const bounds = placementBounds({ ...plain, rotation: 0.3 })
    expect(Number.isInteger(bounds.x)).toBe(true)
    expect(Number.isInteger(bounds.width)).toBe(true)
    const corners = placementCorners({ ...plain, rotation: 0.3 })
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(bounds.x)
      expect(corner.x).toBeLessThanOrEqual(bounds.x + bounds.width)
      expect(corner.y).toBeGreaterThanOrEqual(bounds.y)
      expect(corner.y).toBeLessThanOrEqual(bounds.y + bounds.height)
    }
  })

  test("names its corners clockwise from the top left of the picture", () => {
    const corners = placementCorners(plain)
    expect(corners).toEqual([
      { x: 150, y: 125 },
      { x: 250, y: 125 },
      { x: 250, y: 175 },
      { x: 150, y: 175 },
    ])
  })
})

describe("moving a placement", () => {
  test("carries it by the drag, leaving its size and angle alone", () => {
    const moved = movedPlacement(plain, { dx: 10, dy: -4 })
    expect(moved.x).toBe(210)
    expect(moved.y).toBe(146)
    expect(moved.width).toBe(plain.width)
    expect(moved.rotation).toBe(plain.rotation)
  })

  test("a nudge is a move of whole document pixels", () => {
    expect(nudgedPlacement(plain, { dx: 1, dy: 0 }).x).toBe(201)
  })

  test("puts a dragged placement back on the grid rather than carrying its fraction", () => {
    // A drag leaves a placement on a fraction of a pixel; without this, every
    // later nudge would keep that fraction and never land on the grid.
    const dragged = { ...plain, x: 200.4, y: 149.7 }
    expect(nudgedPlacement(dragged, { dx: 1, dy: 0 })).toMatchObject({
      x: 201,
      y: 150,
    })
  })
})

describe("scaling a placement by a handle", () => {
  test("holds the opposite corner still", () => {
    // Dragging the bottom-right corner to (300, 200) should leave the top-left
    // where it was: that is what makes a handle feel attached to the picture.
    const scaled = scaledPlacement(plain, "bottom-right", { x: 300, y: 200 })
    const corners = placementCorners(scaled)
    expect(corners[0].x).toBeCloseTo(150, 6)
    expect(corners[0].y).toBeCloseTo(125, 6)
    expect(corners[2].x).toBeCloseTo(300, 6)
    expect(corners[2].y).toBeCloseTo(200, 6)
  })

  test("keeps the proportions when asked, which is the usual want", () => {
    const scaled = scaledPlacement(
      plain,
      "bottom-right",
      { x: 400, y: 200 },
      {
        preserveAspect: true,
      }
    )
    expect(scaled.width / scaled.height).toBeCloseTo(
      plain.width / plain.height,
      6
    )
  })

  test("an edge handle moves one dimension only", () => {
    const scaled = scaledPlacement(plain, "right", { x: 300, y: 999 })
    expect(scaled.width).toBeCloseTo(150, 6)
    expect(scaled.height).toBeCloseTo(plain.height, 6)
  })

  test("works in the placement's own frame once it is turned", () => {
    const turned = { ...plain, rotation: Math.PI / 2 }
    const corners = placementCorners(turned)
    const scaled = scaledPlacement(turned, "bottom-right", corners[2])
    // Dragging a handle to where it already is changes nothing.
    expect(samePlacement(scaled, turned)).toBe(true)
  })

  test("never collapses a picture to nothing, however far the drag goes", () => {
    const scaled = scaledPlacement(plain, "bottom-right", { x: 100, y: 100 })
    expect(scaled.width).toBeGreaterThan(0)
    expect(scaled.height).toBeGreaterThan(0)
    expect(validPlacement(scaled, CANVAS)).toBe(true)
  })
})

describe("turning and mirroring a placement", () => {
  test("rotates about its own centre", () => {
    const turned = rotatedPlacement(plain, Math.PI / 4)
    expect(turned.x).toBe(plain.x)
    expect(turned.y).toBe(plain.y)
    expect(turned.rotation).toBeCloseTo(Math.PI / 4, 6)
  })

  test("a flip is a flag rather than pixels moved", () => {
    const flipped = flippedPlacement(plain, "horizontal")
    expect(flipped.flipX).toBe(true)
    expect(flipped.width).toBe(plain.width)
    expect(flippedPlacement(flipped, "horizontal").flipX).toBe(false)
    expect(flippedPlacement(plain, "vertical").flipY).toBe(true)
  })
})

describe("how much of the picture's own detail is left", () => {
  test("is one to one at the size it was placed", () => {
    expect(resolution(plain, { width: 100, height: 50 })).toBeCloseTo(1, 6)
  })

  test("is under one where the picture is shown smaller than it is", () => {
    expect(resolution(plain, { width: 400, height: 200 })).toBeCloseTo(0.25, 6)
  })

  test("is over one where it is being asked for detail it does not hold", () => {
    // The honest number: a 50-wide photo drawn 100 wide is at 200%, and the
    // extra pixels are invented by the resampler, not recorded by the camera.
    expect(resolution(plain, { width: 50, height: 25 })).toBeCloseTo(2, 6)
  })
})

describe("a placement as input", () => {
  test("refuses one that is not finite, positive and on a real angle", () => {
    expect(validPlacement(plain, CANVAS)).toBe(true)
    expect(validPlacement({ ...plain, width: 0 }, CANVAS)).toBe(false)
    expect(validPlacement({ ...plain, height: Number.NaN }, CANVAS)).toBe(false)
    expect(
      validPlacement({ ...plain, rotation: Number.POSITIVE_INFINITY }, CANVAS)
    ).toBe(false)
    expect(validPlacement({ ...plain, x: Number.NaN }, CANVAS)).toBe(false)
  })

  test("refuses one so large it would cost the whole document in tiles", () => {
    expect(validPlacement({ ...plain, width: 1e9, height: 1e9 }, CANVAS)).toBe(
      false
    )
  })

  test("allows one dragged clear off the canvas: it is still where it is", () => {
    expect(validPlacement({ ...plain, x: -900, y: -900 }, CANVAS)).toBe(true)
  })
})

describe("telling two placements apart", () => {
  test("ignores differences too small to move a pixel", () => {
    expect(samePlacement(plain, { ...plain, x: plain.x + 1e-9 })).toBe(true)
    expect(samePlacement(plain, { ...plain, x: plain.x + 0.5 })).toBe(false)
    expect(samePlacement(plain, { ...plain, flipX: true })).toBe(false)
  })
})

describe("the handles a transform box offers", () => {
  test("are the four corners, the four edges and a grip to turn by", () => {
    const points = handlePoints(plain)
    expect(Object.keys(points).sort()).toEqual(
      [
        "bottom",
        "bottom-left",
        "bottom-right",
        "left",
        "right",
        "rotate",
        "top",
        "top-left",
        "top-right",
      ].sort()
    )
    expect(points.top).toEqual({ x: 200, y: 125 })
    expect(points["bottom-left"]).toEqual({ x: 150, y: 175 })
    // The grip sits off the top edge, outside the picture, where it cannot be
    // confused with the corner next to it.
    expect(points.rotate.y).toBeLessThan(125)
    expect(points.rotate.x).toBe(200)
  })

  test("turn with the box", () => {
    const turned = { ...plain, rotation: Math.PI / 2 }
    const points = handlePoints(turned)
    expect(points.rotate.x).toBeGreaterThan(200)
    expect(points.rotate.y).toBeCloseTo(150, 6)
  })
})
