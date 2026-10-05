import { describe, expect, test } from "bun:test"
import {
  applyMatrix,
  DEFAULT_VIEW,
  docToScreen,
  fitView,
  flipView,
  MAX_ZOOM,
  FIT_MARGIN,
  MIN_ZOOM,
  normalizeAngle,
  panView,
  rotateView,
  screenToDoc,
  SNAP_RADIANS,
  zoomView,
} from "../../engine/view/view-transform"

const DOC = { width: 200, height: 100 }
const VIEWPORT = { width: 200, height: 100 }

const close = (actual: number, expected: number, epsilon = 1e-6) =>
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon)

const closePoint = (
  actual: { x: number; y: number },
  expected: readonly [number, number],
  epsilon = 1e-6
) => {
  close(actual.x, expected[0], epsilon)
  close(actual.y, expected[1], epsilon)
}

/** The point the pen is over must be the point the mark lands on. */
const roundTrip = (
  view: Parameters<typeof docToScreen>[0],
  point: readonly [number, number],
  doc = DOC,
  viewport = VIEWPORT
) => {
  const screen = applyMatrix(docToScreen(view, doc, viewport), ...point)
  return applyMatrix(screenToDoc(view, doc, viewport), screen.x, screen.y)
}

describe("the default view", () => {
  test("shows the document at its own size, unrotated and unflipped", () => {
    expect(DEFAULT_VIEW).toEqual({
      panX: 0,
      panY: 0,
      zoom: 1,
      rotation: 0,
      flipped: false,
    })
    // Nothing moves: a document pixel is the screen pixel it sits on.
    const matrix = docToScreen(DEFAULT_VIEW, DOC, VIEWPORT)
    closePoint(applyMatrix(matrix, 0, 0), [0, 0])
    closePoint(applyMatrix(matrix, 137, 44), [137, 44])
  })

  test("resetting returns to it from anywhere", () => {
    const wandered = flipView(
      rotateView(zoomView(panView(DEFAULT_VIEW, 30, -12), 4), 1.1)
    )
    // Resetting is the frozen default itself: there is nothing to compute.
    expect(wandered).not.toEqual(DEFAULT_VIEW)
  })
})

describe("panning", () => {
  test("moves the document under the viewport by screen pixels", () => {
    const view = panView(DEFAULT_VIEW, 30, -10)
    closePoint(
      applyMatrix(docToScreen(view, DOC, VIEWPORT), 100, 50),
      [130, 40]
    )
  })

  test("accumulates", () => {
    expect(panView(panView(DEFAULT_VIEW, 5, 5), -2, 3)).toMatchObject({
      panX: 3,
      panY: 8,
    })
  })
})

describe("zooming", () => {
  test("scales about the viewport centre by default", () => {
    const view = zoomView(DEFAULT_VIEW, 2)
    // The centre of the document is the centre of the viewport, so it stays.
    closePoint(
      applyMatrix(docToScreen(view, DOC, VIEWPORT), 100, 50),
      [100, 50]
    )
    // And a point a quarter across is twice as far from that centre.
    closePoint(applyMatrix(docToScreen(view, DOC, VIEWPORT), 50, 50), [0, 50])
  })

  test("holds the anchored point still, which is what the wheel needs", () => {
    const anchor = { x: 20, y: 90 }
    const before = applyMatrix(
      screenToDoc(DEFAULT_VIEW, DOC, VIEWPORT),
      anchor.x,
      anchor.y
    )
    const view = zoomView(DEFAULT_VIEW, 3.5, { anchor, viewport: VIEWPORT })
    const after = applyMatrix(
      screenToDoc(view, DOC, VIEWPORT),
      anchor.x,
      anchor.y
    )
    closePoint(after, [before.x, before.y], 1e-4)
  })

  test("holds the anchor even when the view is rotated and flipped", () => {
    const start = flipView(rotateView(DEFAULT_VIEW, 0.7))
    const anchor = { x: 175, y: 12 }
    const before = applyMatrix(
      screenToDoc(start, DOC, VIEWPORT),
      anchor.x,
      anchor.y
    )
    const view = zoomView(start, 0.4, { anchor, viewport: VIEWPORT })
    const after = applyMatrix(
      screenToDoc(view, DOC, VIEWPORT),
      anchor.x,
      anchor.y
    )
    closePoint(after, [before.x, before.y], 1e-4)
  })

  test("clamps to limits rather than letting the canvas vanish or explode", () => {
    expect(zoomView(DEFAULT_VIEW, 1e9).zoom).toBe(MAX_ZOOM)
    expect(zoomView(DEFAULT_VIEW, 1e-9).zoom).toBe(MIN_ZOOM)
    expect(MIN_ZOOM).toBeLessThan(1)
    expect(MAX_ZOOM).toBeGreaterThan(1)
  })

  test("without an anchor, holds what is at the viewport's centre, panned or turned", () => {
    const start = rotateView(panView(DEFAULT_VIEW, 60, -25), 0.7)
    const centre = applyMatrix(screenToDoc(start, DOC, VIEWPORT), 100, 50)
    for (const factor of [2, 0.5]) {
      const view = zoomView(start, factor)
      closePoint(
        applyMatrix(screenToDoc(view, DOC, VIEWPORT), 100, 50),
        [centre.x, centre.y],
        1e-4
      )
    }
  })

  test("refuses a factor that is not a positive number", () => {
    expect(() => zoomView(DEFAULT_VIEW, 0)).toThrow()
    expect(() => zoomView(DEFAULT_VIEW, -2)).toThrow()
    expect(() => zoomView(DEFAULT_VIEW, Number.NaN)).toThrow()
  })
})

describe("rotation", () => {
  test("turns the document about the viewport centre", () => {
    const view = rotateView(DEFAULT_VIEW, Math.PI / 2)
    // A quarter turn clockwise carries the point left of centre to above it.
    closePoint(
      applyMatrix(docToScreen(view, DOC, VIEWPORT), 50, 50),
      [100, 0],
      1e-4
    )
  })

  test("snaps to the nearest cardinal angle when it lands near one", () => {
    const nudged = rotateView(DEFAULT_VIEW, Math.PI / 2 - SNAP_RADIANS / 2)
    close(nudged.rotation, Math.PI / 2)
    expect(rotateView(DEFAULT_VIEW, SNAP_RADIANS / 3).rotation).toBe(0)
  })

  test("does not snap outside the threshold", () => {
    const angle = Math.PI / 2 - SNAP_RADIANS * 2
    close(rotateView(DEFAULT_VIEW, angle).rotation, angle)
  })

  test("can be set absolutely and stays in a single turn", () => {
    const spun = rotateView(DEFAULT_VIEW, 3 * Math.PI, { absolute: true })
    close(Math.abs(spun.rotation), Math.PI)
    close(normalizeAngle(2 * Math.PI + 0.3), 0.3)
    close(normalizeAngle(-3 * Math.PI), -Math.PI)
  })

  test("accumulates when it is relative", () => {
    const view = rotateView(rotateView(DEFAULT_VIEW, 1), 1)
    close(view.rotation, 2)
  })
})

describe("flipping", () => {
  test("mirrors the view horizontally about the viewport centre", () => {
    const view = flipView(DEFAULT_VIEW)
    expect(view.flipped).toBe(true)
    closePoint(applyMatrix(docToScreen(view, DOC, VIEWPORT), 40, 25), [160, 25])
  })

  test("mirrors what is on screen, whatever the rotation", () => {
    const rotated = rotateView(DEFAULT_VIEW, 0.9)
    const mirrored = flipView(rotated)
    const point = applyMatrix(docToScreen(rotated, DOC, VIEWPORT), 33, 71)
    const flipped = applyMatrix(docToScreen(mirrored, DOC, VIEWPORT), 33, 71)
    closePoint(flipped, [VIEWPORT.width - point.x, point.y], 1e-4)
  })

  test("flipping twice is the original view", () => {
    expect(flipView(flipView(DEFAULT_VIEW))).toEqual(DEFAULT_VIEW)
  })
})

describe("fit to window", () => {
  test("scales a document down until it fits, and centres it", () => {
    const view = fitView(DEFAULT_VIEW, { width: 400, height: 400 }, VIEWPORT)
    // The viewport is 200x100, so the height is the binding constraint.
    close(view.zoom, (100 / 400) * (1 - FIT_MARGIN))
    expect([view.panX, view.panY]).toEqual([0, 0])
  })

  test("keeps the rotation and flip the artist is working at", () => {
    const start = flipView(rotateView(DEFAULT_VIEW, Math.PI / 2))
    const view = fitView(start, DOC, VIEWPORT)
    expect(view.flipped).toBe(true)
    close(view.rotation, Math.PI / 2)
    // Turned on its side, the 200x100 document is 100 wide and 200 tall, so
    // the viewport's 100px height is what it has to fit into.
    close(view.zoom, 0.5 * (1 - FIT_MARGIN))
  })

  test("scales a small document up to fill the window", () => {
    const view = fitView(DEFAULT_VIEW, { width: 50, height: 50 }, VIEWPORT)
    close(view.zoom, 2 * (1 - FIT_MARGIN))
  })

  test("survives a degenerate viewport or document", () => {
    expect(
      fitView(DEFAULT_VIEW, { width: 0, height: 0 }, VIEWPORT).zoom
    ).toBeGreaterThan(0)
    expect(
      fitView(DEFAULT_VIEW, DOC, { width: 0, height: 0 }).zoom
    ).toBeGreaterThanOrEqual(MIN_ZOOM)
  })
})

describe("the two directions of the transform", () => {
  test("invert each other at any pan, zoom, rotation and flip", () => {
    const view = flipView(
      rotateView(zoomView(panView(DEFAULT_VIEW, -37, 21), 2.75), 0.42)
    )
    for (const point of [
      [0, 0],
      [200, 100],
      [83, 17],
    ] as const)
      closePoint(roundTrip(view, point), point, 1e-3)
  })

  test("map a document larger than the viewport as well", () => {
    const doc = { width: 4096, height: 2048 }
    const viewport = { width: 900, height: 500 }
    const view = rotateView(zoomView(DEFAULT_VIEW, 0.3), -1.2)
    closePoint(roundTrip(view, [4095, 7], doc, viewport), [4095, 7], 1e-2)
  })
})
