/**
 * Where a placed picture sits, as a description rather than as pixels.
 *
 * This is the whole reason a photograph can be nudged a dozen times and stay
 * as sharp as the file that was dropped: an adjustment moves these numbers,
 * and the pixels are made from the original picture at the end of it (06).
 * Applying each adjustment to the result of the last one is what softens an
 * image, and there is nowhere in this model to do that.
 *
 * Pure value math, like `tile-grid`: no GPU, no decoding, no document.
 */

import type { PixelRect } from "./tile-grid"

/** The picture's centre, its drawn size, its angle and its mirroring. */
export type ImagePlacement = Readonly<{
  /** Centre in document pixels. The centre, not a corner: rotation turns
   * about it, and a scale that holds the opposite corner still is expressed
   * against it without the two disagreeing about where the picture is. */
  x: number
  y: number
  /** Drawn size in document pixels, always positive; mirroring is a flag. */
  width: number
  height: number
  /** Clockwise on screen, in radians. */
  rotation: number
  flipX: boolean
  flipY: boolean
}>

export type Point = Readonly<{ x: number; y: number }>

/** The eight box handles, plus the grip that turns the box. */
export type PlacementHandle =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left"
  | "rotate"

/**
 * The smallest a picture may be drawn. Below a pixel there is nothing to see
 * and nothing to grab hold of to get back, so a drag that overshoots stops
 * here rather than losing the picture.
 */
export const MIN_PLACEMENT_SIZE = 1

/**
 * The largest. A placement is rendered into the tiles its box covers, so an
 * absurd size is an absurd allocation: this is a bound on the resampler's
 * work, not a rule about where a picture may go.
 */
export const MAX_PLACEMENT_SIZE = 32_768

/** Differences smaller than this cannot move a document pixel. */
const EPSILON = 1e-6

/** How far off the top edge the grip that turns the box sits, in doc pixels. */
export const ROTATE_HANDLE_GAP = 24

/**
 * Where an image goes when nothing else is asked for: centred, scaled down to
 * fit if it is larger than the canvas, and never scaled up — an image smaller
 * than the canvas is placed at its own resolution rather than blown up to fill
 * a document it was never meant to.
 */
export function centeredPlacement(
  image: { width: number; height: number },
  canvas: { width: number; height: number }
): ImagePlacement {
  const scale = Math.min(
    1,
    canvas.width / image.width,
    canvas.height / image.height
  )
  return {
    x: canvas.width / 2,
    y: canvas.height / 2,
    width: Math.max(MIN_PLACEMENT_SIZE, image.width * scale),
    height: Math.max(MIN_PLACEMENT_SIZE, image.height * scale),
    rotation: 0,
    flipX: false,
    flipY: false,
  }
}

/** The un-turned rectangle a placement covers. */
export function placementRect(placement: ImagePlacement): PixelRect {
  return {
    x: placement.x - placement.width / 2,
    y: placement.y - placement.height / 2,
    width: placement.width,
    height: placement.height,
  }
}

function rotate(point: Point, about: Point, radians: number): Point {
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - about.x
  const dy = point.y - about.y
  return {
    x: about.x + dx * cos - dy * sin,
    y: about.y + dx * sin + dy * cos,
  }
}

/**
 * The four corners in document space, clockwise from the picture's own top
 * left — its own, so a mirrored or turned picture's corners still name the
 * same parts of it and a handle keeps hold of the corner it grabbed.
 */
export function placementCorners(
  placement: ImagePlacement
): readonly [Point, Point, Point, Point] {
  const rect = placementRect(placement)
  const centre = { x: placement.x, y: placement.y }
  const corners: Point[] = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ]
  return corners.map((corner) =>
    rotate(corner, centre, placement.rotation)
  ) as unknown as readonly [Point, Point, Point, Point]
}

/**
 * The same four corners, in the order the picture's own corners map onto
 * them: its top left first, then clockwise round the picture.
 *
 * Mirroring lives here rather than in the geometry. `placementCorners` is the
 * box on screen, which a flip does not move — the box is the same box — while
 * this is which way round the picture is drawn inside it, which is the whole
 * of what a flip changes. Whoever draws the picture reads this; whoever draws
 * the handles reads the other.
 */
export function placementQuad(
  placement: ImagePlacement
): readonly [Point, Point, Point, Point] {
  const [topLeft, topRight, bottomRight, bottomLeft] =
    placementCorners(placement)
  // Mirrored horizontally, the picture's left edge is drawn down the box's
  // right; vertically, its top edge along the box's bottom. Both together is
  // a half turn, which is the two swaps applied in either order.
  const corners: [Point, Point, Point, Point] = placement.flipX
    ? [topRight, topLeft, bottomLeft, bottomRight]
    : [topLeft, topRight, bottomRight, bottomLeft]
  return placement.flipY
    ? [corners[3], corners[2], corners[1], corners[0]]
    : corners
}

/**
 * The whole-pixel box the drawn picture fits inside. Outwards, always: the
 * resampler renders into this box, and a box that cut a pixel in half would
 * leave the resampler guessing where the picture's edge was.
 */
export function placementBounds(placement: ImagePlacement): PixelRect {
  return quadBounds(placementCorners(placement))
}

/** The whole-pixel box any four corners fit inside, rounded outwards. */
export function quadBounds(corners: readonly Point[]): PixelRect {
  const left = Math.floor(Math.min(...corners.map((corner) => corner.x)))
  const top = Math.floor(Math.min(...corners.map((corner) => corner.y)))
  const right = Math.ceil(Math.max(...corners.map((corner) => corner.x)))
  const bottom = Math.ceil(Math.max(...corners.map((corner) => corner.y)))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function movedPlacement(
  placement: ImagePlacement,
  by: { dx: number; dy: number }
): ImagePlacement {
  return { ...placement, x: placement.x + by.dx, y: placement.y + by.dy }
}

/**
 * A keyboard nudge: onto whole document pixels, so repeated taps walk the
 * grid rather than carrying along whatever fraction a drag left behind.
 */
export function nudgedPlacement(
  placement: ImagePlacement,
  by: { dx: number; dy: number }
): ImagePlacement {
  const moved = movedPlacement(placement, {
    dx: Math.round(by.dx),
    dy: Math.round(by.dy),
  })
  return { ...moved, x: Math.round(moved.x), y: Math.round(moved.y) }
}

/** Which box edges a handle moves, in the placement's own frame. */
const HANDLE_EDGES: Record<
  Exclude<PlacementHandle, "rotate">,
  { horizontal: -1 | 0 | 1; vertical: -1 | 0 | 1 }
> = {
  "top-left": { horizontal: -1, vertical: -1 },
  top: { horizontal: 0, vertical: -1 },
  "top-right": { horizontal: 1, vertical: -1 },
  right: { horizontal: 1, vertical: 0 },
  "bottom-right": { horizontal: 1, vertical: 1 },
  bottom: { horizontal: 0, vertical: 1 },
  "bottom-left": { horizontal: -1, vertical: 1 },
  left: { horizontal: -1, vertical: 0 },
}

function clampSize(size: number): number {
  return Math.min(MAX_PLACEMENT_SIZE, Math.max(MIN_PLACEMENT_SIZE, size))
}

/**
 * Drags one handle to a point, holding the opposite corner or edge still.
 *
 * The arithmetic happens in the placement's own frame — the drag point is
 * turned back by the rotation first — so a handle on a picture that has been
 * turned forty degrees still resizes along the picture's edges rather than
 * along the screen's, which is what every transform box anywhere does.
 */
export function scaledPlacement(
  placement: ImagePlacement,
  handle: Exclude<PlacementHandle, "rotate">,
  to: Point,
  options: { preserveAspect?: boolean } = {}
): ImagePlacement {
  const edges = HANDLE_EDGES[handle]
  const centre = { x: placement.x, y: placement.y }
  // Into the placement's frame: the drag as the picture sees it.
  const local = rotate(to, centre, -placement.rotation)
  const half = { x: placement.width / 2, y: placement.height / 2 }

  // The fixed edge is the one the handle is not on. An edge handle has no
  // fixed side across, so that dimension is left exactly as it was.
  const fixedX =
    edges.horizontal === 0 ? null : centre.x - edges.horizontal * half.x
  const fixedY =
    edges.vertical === 0 ? null : centre.y - edges.vertical * half.y

  let width =
    fixedX === null ? placement.width : clampSize(Math.abs(local.x - fixedX))
  let height =
    fixedY === null ? placement.height : clampSize(Math.abs(local.y - fixedY))

  if (options.preserveAspect && fixedX !== null && fixedY !== null) {
    // The larger of the two demands wins, so the picture follows the corner
    // the hand is pulling rather than lagging behind it on one axis.
    const scale = Math.max(width / placement.width, height / placement.height)
    width = clampSize(placement.width * scale)
    height = clampSize(placement.height * scale)
  }

  // The new centre in the placement's frame: half a box from the fixed edge,
  // in the direction the handle was dragged.
  const localCentre = {
    x: fixedX === null ? centre.x : fixedX + edges.horizontal * (width / 2),
    y: fixedY === null ? centre.y : fixedY + edges.vertical * (height / 2),
  }
  const moved = rotate(localCentre, centre, placement.rotation)
  return { ...placement, x: moved.x, y: moved.y, width, height }
}

/** Turns the picture about its own centre. */
export function rotatedPlacement(
  placement: ImagePlacement,
  radians: number
): ImagePlacement {
  return { ...placement, rotation: radians }
}

/**
 * Mirrors the picture. A flag rather than pixels moved: flipping is exact,
 * and a flip that resampled would cost detail for an operation that loses
 * none.
 */
export function flippedPlacement(
  placement: ImagePlacement,
  axis: "horizontal" | "vertical"
): ImagePlacement {
  return axis === "horizontal"
    ? { ...placement, flipX: !placement.flipX }
    : { ...placement, flipY: !placement.flipY }
}

/**
 * Drawn pixels per source pixel: 1 at the size the picture was recorded at,
 * above 1 where more detail is being asked for than the picture holds. The
 * number the artist is shown, rather than a silent stretch (06).
 */
export function resolution(
  placement: ImagePlacement,
  source: { width: number; height: number }
): number {
  return Math.max(
    placement.width / source.width,
    placement.height / source.height
  )
}

/** A placement as input: from a command, a saved document, another machine. */
export function validPlacement(
  placement: ImagePlacement,
  canvas: { width: number; height: number }
): boolean {
  const finite = [
    placement.x,
    placement.y,
    placement.width,
    placement.height,
    placement.rotation,
  ].every((value) => Number.isFinite(value))
  if (!finite) return false
  if (typeof placement.flipX !== "boolean") return false
  if (typeof placement.flipY !== "boolean") return false
  if (
    placement.width < MIN_PLACEMENT_SIZE ||
    placement.height < MIN_PLACEMENT_SIZE
  )
    return false
  // Bounded against the canvas as well as absolutely: what this guards is the
  // resampler's allocation, which is the box, not the document.
  const bounds = placementBounds(placement)
  const limit = Math.max(
    MAX_PLACEMENT_SIZE,
    Math.max(canvas.width, canvas.height)
  )
  return bounds.width <= limit && bounds.height <= limit
}

export function samePlacement(a: ImagePlacement, b: ImagePlacement): boolean {
  return (
    Math.abs(a.x - b.x) < EPSILON &&
    Math.abs(a.y - b.y) < EPSILON &&
    Math.abs(a.width - b.width) < EPSILON &&
    Math.abs(a.height - b.height) < EPSILON &&
    Math.abs(a.rotation - b.rotation) < EPSILON &&
    a.flipX === b.flipX &&
    a.flipY === b.flipY
  )
}

/**
 * Where the handles are in document space. The host draws and hit-tests
 * these; putting them here keeps the box the artist grabs and the box the
 * engine renders from the same box.
 */
export function handlePoints(
  placement: ImagePlacement
): Record<PlacementHandle, Point> {
  const [topLeft, topRight, bottomRight, bottomLeft] =
    placementCorners(placement)
  const midpoint = (a: Point, b: Point): Point => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  })
  const top = midpoint(topLeft, topRight)
  const centre = { x: placement.x, y: placement.y }
  // The grip sits off the top edge along the box's own up direction, so it
  // stays clear of the corners however the picture is turned.
  const up = rotate(
    { x: centre.x, y: centre.y - placement.height / 2 - ROTATE_HANDLE_GAP },
    centre,
    placement.rotation
  )
  return {
    "top-left": topLeft,
    top,
    "top-right": topRight,
    right: midpoint(topRight, bottomRight),
    "bottom-right": bottomRight,
    bottom: midpoint(bottomRight, bottomLeft),
    "bottom-left": bottomLeft,
    left: midpoint(bottomLeft, topLeft),
    rotate: up,
  }
}
