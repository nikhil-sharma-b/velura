/**
 * How the artist is looking at the canvas (D28): pan, zoom, rotation and a
 * horizontal flip. All of it is a matrix applied when the document is
 * presented — nothing here is ever baked into a layer's texels, which is what
 * lets a piece painted sideways export exactly as it was painted.
 *
 * The two matrices this produces are the whole seam. One takes document
 * pixels to screen pixels, for drawing; the other takes screen pixels back to
 * document pixels, for the pen. Every stage downstream of input works in
 * document space, so the mark lands under the pen at any view.
 */

/** The view, as state a host can hold and a snapshot can carry. */
export type CanvasView = Readonly<{
  /** Screen-pixel offset of the document's centre from the viewport's. */
  panX: number
  panY: number
  /** Screen pixels per document pixel, in [MIN_ZOOM, MAX_ZOOM]. */
  zoom: number
  /** Clockwise turn of the document on screen, in radians, within one turn. */
  rotation: number
  /** Whether the view is mirrored horizontally, as a fresh-eyes check. */
  flipped: boolean
}>

/**
 * A 2D affine, in the order `DOMMatrix` uses: `x' = a·x + c·y + e`,
 * `y' = b·x + d·y + f`. Six numbers rather than a 3x3 because the last row of
 * an affine is never anything but `[0 0 1]`.
 */
export type ViewMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number,
]

/** A point, in whichever space the function taking it names. */
export type Point = Readonly<{ x: number; y: number }>

/** A width and a height, in pixels: the document's, or the viewport's. */
export type Extent = Readonly<{ width: number; height: number }>

/**
 * Zoom limits. The floor keeps a huge canvas from becoming a speck that
 * cannot be aimed at; the ceiling is where a single texel fills a good part
 * of the screen and there is nothing further to see.
 */
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 64

/**
 * How near a cardinal angle counts as being at it: about three degrees, which
 * is inside the wobble of a two-finger twist and outside a deliberate tilt.
 */
export const SNAP_RADIANS = Math.PI / 60

/** The margin fit-to-window leaves around the document, as a fraction. */
export const FIT_MARGIN = 0.04

/**
 * The view that changes nothing: a document pixel is the screen pixel it sits
 * on. Where a document *opens* is a framing question, and framing belongs to
 * whoever knows what else is on screen — panels are not a fact about geometry.
 */
export const DEFAULT_VIEW: CanvasView = Object.freeze({
  panX: 0,
  panY: 0,
  zoom: 1,
  rotation: 0,
  flipped: false,
})

export const IDENTITY_MATRIX: ViewMatrix = [1, 0, 0, 1, 0, 0]

/** Brings an angle into [-π, π), so a spun canvas reads as a small turn. */
export function normalizeAngle(radians: number): number {
  const turn = Math.PI * 2
  const wrapped = (((radians + Math.PI) % turn) + turn) % turn
  return wrapped - Math.PI
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

function requirePositive(value: number, message: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(message)
}

function requireFinite(value: number, message: string): void {
  if (!Number.isFinite(value)) throw new Error(message)
}

/**
 * Document pixels to screen pixels. Read right to left: the document is
 * centred on its own middle, scaled, turned, mirrored, and then placed at the
 * middle of the viewport plus whatever the artist has dragged it by.
 *
 * The mirror is applied in screen space rather than document space, because
 * flipping is a habit about what the eye sees: it must mirror the image on
 * screen whatever angle the canvas happens to be turned to.
 */
export function docToScreen(
  view: CanvasView,
  doc: Extent,
  viewport: Extent
): ViewMatrix {
  const cos = Math.cos(view.rotation)
  const sin = Math.sin(view.rotation)
  const mirror = view.flipped ? -1 : 1
  // Rotation then scale, with the mirror folded into the x row it precedes.
  const a = mirror * cos * view.zoom
  const b = sin * view.zoom
  const c = mirror * -sin * view.zoom
  const d = cos * view.zoom
  const originX = viewport.width / 2 + view.panX
  const originY = viewport.height / 2 + view.panY
  const docCenterX = doc.width / 2
  const docCenterY = doc.height / 2
  return [
    a,
    b,
    c,
    d,
    originX - (a * docCenterX + c * docCenterY),
    originY - (b * docCenterX + d * docCenterY),
  ]
}

/** Screen pixels back to document pixels: where the pen actually is. */
export function screenToDoc(
  view: CanvasView,
  doc: Extent,
  viewport: Extent
): ViewMatrix {
  return invertMatrix(docToScreen(view, doc, viewport))
}

/**
 * The inverse of an affine. A view matrix is a scaled rotation, possibly
 * mirrored, so its determinant is `±zoom²` and never zero.
 */
export function invertMatrix(matrix: ViewMatrix): ViewMatrix {
  const [a, b, c, d, e, f] = matrix
  const determinant = a * d - b * c
  if (determinant === 0) return IDENTITY_MATRIX
  const ia = d / determinant
  const ib = -b / determinant
  const ic = -c / determinant
  const id = a / determinant
  return [ia, ib, ic, id, -(ia * e + ic * f), -(ib * e + id * f)]
}

export function applyMatrix(
  matrix: ViewMatrix,
  x: number,
  y: number
): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  }
}

/** Drags the canvas by a screen-pixel delta. */
export function panView(view: CanvasView, dx: number, dy: number): CanvasView {
  requireFinite(dx, "Pan must be finite.")
  requireFinite(dy, "Pan must be finite.")
  return { ...view, panX: view.panX + dx, panY: view.panY + dy }
}

/**
 * Multiplies the zoom, keeping one screen point over the same document point.
 *
 * The anchor is what makes a wheel or a pinch feel attached to the canvas
 * rather than to the window: without it, zooming towards a detail walks that
 * detail off the screen. Passing nothing holds the viewport's centre, which
 * is what a keyboard zoom wants.
 */
export function zoomView(
  view: CanvasView,
  factor: number,
  // One argument, because an anchor without the viewport it is measured in is
  // not an anchor: splitting them is what lets a caller pass half of a pair.
  about?: { anchor: Point; viewport: Extent }
): CanvasView {
  requirePositive(factor, "Zoom factor must be a positive, finite number.")
  const zoom = clampZoom(view.zoom * factor)
  const zoomed = { ...view, zoom }
  // Scaling happens about the document's centre, which sits `pan` from the
  // viewport's, so an anchor anywhere moves by the same ratio the zoom
  // actually changed by — clamping included, or a wheel at the zoom limit
  // would still slide the canvas.
  const ratio = zoom / view.zoom
  // The viewport's own centre is an anchor at no offset from it: the pan
  // scales with the zoom, or what was in view drifts towards the document's.
  if (!about)
    return { ...zoomed, panX: view.panX * ratio, panY: view.panY * ratio }
  const { anchor, viewport } = about
  const originX = viewport.width / 2 + view.panX
  const originY = viewport.height / 2 + view.panY
  return {
    ...zoomed,
    panX: view.panX + (anchor.x - originX) * (1 - ratio),
    panY: view.panY + (anchor.y - originY) * (1 - ratio),
  }
}

/**
 * Turns the canvas, snapping when it comes to rest near square. Relative by
 * default, because a twist gesture and a rotate key both report a delta.
 */
export function rotateView(
  view: CanvasView,
  radians: number,
  options: { absolute?: boolean; snap?: boolean } = {}
): CanvasView {
  requireFinite(radians, "Rotation must be finite.")
  const target = options.absolute ? radians : view.rotation + radians
  const normalized = normalizeAngle(target)
  const snap = options.snap ?? true
  const quarter = Math.PI / 2
  const nearest = Math.round(normalized / quarter) * quarter
  const rotation =
    snap && Math.abs(normalizeAngle(normalized - nearest)) <= SNAP_RADIANS
      ? normalizeAngle(nearest)
      : normalized
  return { ...view, rotation }
}

/** Mirrors the view horizontally, and back. */
export function flipView(view: CanvasView): CanvasView {
  return { ...view, flipped: !view.flipped }
}

/**
 * The overview, in one action: the whole document inside the window, centred,
 * at the angle the artist is working at. Rotation and flip are kept because
 * fitting is about seeing the whole piece, not about undoing how it is being
 * looked at — that is what resetting is for.
 */
export function fitView(
  view: CanvasView,
  doc: Extent,
  viewport: Extent,
  /**
   * A strip along the right edge the artist cannot see into, in the same
   * pixels as `viewport` — an open panel sits over it. The document is fitted
   * to what is left and centred in it, rather than behind the panel.
   */
  occludedRight = 0
): CanvasView {
  const cos = Math.abs(Math.cos(view.rotation))
  const sin = Math.abs(Math.sin(view.rotation))
  // What the turned document actually occupies on screen at zoom 1.
  const width = doc.width * cos + doc.height * sin
  const height = doc.width * sin + doc.height * cos
  const hidden = Math.max(0, occludedRight)
  const visible = Math.max(1, viewport.width - hidden)
  const usableWidth = visible * (1 - FIT_MARGIN)
  const usableHeight = Math.max(1, viewport.height) * (1 - FIT_MARGIN)
  const zoom =
    width <= 0 || height <= 0
      ? view.zoom
      : Math.min(usableWidth / width, usableHeight / height)
  // Half the hidden strip: centring in the visible part is the same as
  // centring in the whole viewport, shifted left by half of what is covered.
  return {
    ...view,
    panX: hidden ? -hidden / 2 : 0,
    panY: 0,
    zoom: clampZoom(zoom),
  }
}
