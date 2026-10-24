/**
 * Snapping and alignment (15): where a box being moved wants to land, and
 * where an align command puts it.
 *
 * One resolver for every transform: the box's left, centre and right are
 * tried against every vertical line it could meet — the canvas's edges and
 * centre, and the same three lines of every other piece of content — and
 * likewise down the other axis. The nearest within reach wins, per axis, so a
 * box can sit on the canvas's left edge and another layer's middle at once.
 *
 * Pure value math: the host decides the threshold, since how near is "near"
 * is a question of screen pixels, not document ones.
 */

import { placementCorners, type ImagePlacement } from "./image-placement"

/** A rectangle that need not be whole pixels. */
export type Extent = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

/** Vertical lines (`x`) and horizontal ones (`y`) a box may snap onto. */
export type SnapTargets = Readonly<{
  x: readonly number[]
  y: readonly number[]
}>

export type Snap = Readonly<{
  /** How far to move the box to land on the lines below. */
  dx: number
  dy: number
  /** The lines engaged, to be drawn as guides; null where none is. */
  guides: Readonly<{ x: number | null; y: number | null }>
}>

export type AlignAnchor =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"

/** The canvas's edges and centre lines, then each other box's. */
export function snapTargets(
  canvas: { width: number; height: number },
  others: readonly Extent[]
): SnapTargets {
  const x = [0, canvas.width / 2, canvas.width]
  const y = [0, canvas.height / 2, canvas.height]
  for (const other of others) {
    x.push(other.x, other.x + other.width / 2, other.x + other.width)
    y.push(other.y, other.y + other.height / 2, other.y + other.height)
  }
  return { x, y }
}

/** The nearest pairing of one of `lines` with a target, within `threshold`. */
function nearest(
  lines: readonly number[],
  targets: readonly number[],
  threshold: number
): { offset: number; guide: number } | null {
  let best: { offset: number; guide: number } | null = null
  for (const target of targets)
    for (const line of lines) {
      const offset = target - line
      if (Math.abs(offset) > threshold) continue
      if (!best || Math.abs(offset) < Math.abs(best.offset))
        best = { offset, guide: target }
    }
  return best
}

/** Where `box` should move by to snap, and the guides that shows. */
export function resolveSnap(
  box: Extent,
  targets: SnapTargets,
  threshold: number
): Snap {
  const x = nearest(
    [box.x, box.x + box.width / 2, box.x + box.width],
    targets.x,
    threshold
  )
  const y = nearest(
    [box.y, box.y + box.height / 2, box.y + box.height],
    targets.y,
    threshold
  )
  return {
    dx: x?.offset ?? 0,
    dy: y?.offset ?? 0,
    guides: { x: x?.guide ?? null, y: y?.guide ?? null },
  }
}

/**
 * The upright box round a placement's corners, unrounded: what it snaps and
 * aligns by, so a turned picture lines up by what the eye sees of it.
 */
export function placementExtent(placement: ImagePlacement): Extent {
  const corners = placementCorners(placement)
  const xs = corners.map((corner) => corner.x)
  const ys = corners.map((corner) => corner.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return {
    x: left,
    y: top,
    width: Math.max(...xs) - left,
    height: Math.max(...ys) - top,
  }
}

/** Moves a placement, along one axis only, to line up with `within`. */
export function alignedPlacement(
  placement: ImagePlacement,
  anchor: AlignAnchor,
  within: Extent
): ImagePlacement {
  const extent = placementExtent(placement)
  // The centre is fixed relative to the extent, so moving the extent by some
  // amount moves the centre by the same.
  switch (anchor) {
    case "left":
      return { ...placement, x: placement.x + within.x - extent.x }
    case "hcenter":
      return {
        ...placement,
        x:
          placement.x +
          within.x +
          within.width / 2 -
          (extent.x + extent.width / 2),
      }
    case "right":
      return {
        ...placement,
        x: placement.x + within.x + within.width - (extent.x + extent.width),
      }
    case "top":
      return { ...placement, y: placement.y + within.y - extent.y }
    case "vcenter":
      return {
        ...placement,
        y:
          placement.y +
          within.y +
          within.height / 2 -
          (extent.y + extent.height / 2),
      }
    case "bottom":
      return {
        ...placement,
        y: placement.y + within.y + within.height - (extent.y + extent.height),
      }
  }
}
