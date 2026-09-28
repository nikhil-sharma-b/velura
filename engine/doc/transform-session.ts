/**
 * A transform in progress, for anything that can be drawn from an untouched
 * source through an affine matrix: a placed image today, and a layer, a
 * selection or a vector object next.
 *
 * The rule it keeps is the one placed images already lived by (06): every
 * preview is drawn from the original through the matrix being asked for,
 * never from the last preview, and the pixels are made once, on commit. A
 * dozen adjustments soften nothing because there is only ever one resample.
 *
 * Pure bookkeeping: what to draw is the target's business, and this module
 * only decides when, with which matrix, and over which region.
 */

import {
  placementQuad,
  quadBounds,
  type ImagePlacement,
  type Point,
} from "./image-placement"
import { unionRect, type PixelRect } from "./tile-grid"

/**
 * Source pixels to document pixels, as `[a, b, c, d, e, f]`:
 * `x' = a·x + c·y + e`, `y' = b·x + d·y + f` — the canvas `setTransform`
 * order, so a matrix can be handed to one without being rearranged.
 */
export type Affine = readonly [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

/** Differences smaller than this cannot move a document pixel. */
const EPSILON = 1e-6

export function applyAffine(matrix: Affine, point: Point): Point {
  const [a, b, c, d, e, f] = matrix
  return { x: a * point.x + c * point.y + e, y: b * point.x + d * point.y + f }
}

/** A matrix that can be drawn: finite, and not collapsing the source flat. */
export function validAffine(matrix: Affine): boolean {
  if (!matrix.every((value) => Number.isFinite(value))) return false
  const [a, b, c, d] = matrix
  return Math.abs(a * d - b * c) > EPSILON
}

export function sameAffine(a: Affine, b: Affine): boolean {
  return a.every((value, index) => Math.abs(value - b[index]!) < EPSILON)
}

/**
 * Where the source's own corners land, its top left first and then clockwise
 * round it — the order the renderer draws a textured quad in.
 */
export function affineQuad(
  matrix: Affine,
  source: { width: number; height: number }
): readonly [Point, Point, Point, Point] {
  return [
    applyAffine(matrix, { x: 0, y: 0 }),
    applyAffine(matrix, { x: source.width, y: 0 }),
    applyAffine(matrix, { x: source.width, y: source.height }),
    applyAffine(matrix, { x: 0, y: source.height }),
  ]
}

/** The whole-pixel box the transformed source fits inside, rounded outwards. */
export function affineBounds(
  matrix: Affine,
  source: { width: number; height: number }
): PixelRect {
  return quadBounds(affineQuad(matrix, source))
}

/**
 * The matrix a placement draws its picture through. A placement is the
 * artist's description — centre, size, angle, mirroring — and this is the
 * same thing as the resampler sees it: the picture's corners onto the quad.
 */
export function affineFromPlacement(
  placement: ImagePlacement,
  source: { width: number; height: number }
): Affine {
  const [origin, right, , down] = placementQuad(placement)
  return [
    (right.x - origin.x) / source.width,
    (right.y - origin.y) / source.width,
    (down.x - origin.x) / source.height,
    (down.y - origin.y) / source.height,
    origin.x,
    origin.y,
  ]
}

/** What a session drives. Each hook draws from the untouched source. */
export type TransformTarget = {
  source: { width: number; height: number }
  /** Show the source through this matrix, without recording anything. */
  preview(matrix: Affine): void
  /**
   * Resample once through this matrix and record it as one step. `region`
   * is everywhere the preview has been, so what it left is recorded too.
   */
  commit(matrix: Affine, region: PixelRect): void
  /** Put the source back through the matrix it was picked up at. `moved`
   * says whether any preview drew somewhere else in the meantime. */
  cancel(start: Affine, moved: boolean): void
}

export type TransformSession = {
  readonly start: Affine
  readonly matrix: Affine
  /** Everything the preview has covered since the session began. */
  readonly touched: PixelRect
  readonly active: boolean
  update(matrix: Affine): void
  /**
   * True if a step was recorded; false for a put-down that moved nothing.
   * `changed` records one anyway, for a target whose description moved
   * while its matrix did not — two flips are the same drawing as a half turn.
   */
  commit(options?: { changed?: boolean }): boolean
  cancel(): void
}

export function beginTransform(
  target: TransformTarget,
  start: Affine
): TransformSession {
  let matrix = start
  let touched = affineBounds(start, target.source)
  let active = true
  return {
    start,
    get matrix() {
      return matrix
    },
    get touched() {
      return touched
    },
    get active() {
      return active
    },
    update(next) {
      if (!validAffine(next)) throw new Error("That transform cannot be drawn.")
      if (!active || sameAffine(next, matrix)) return
      matrix = next
      touched = unionRect(touched, affineBounds(next, target.source))
      target.preview(next)
    },
    commit(options = {}) {
      if (!active) return false
      active = false
      if (!options.changed && sameAffine(matrix, start)) return false
      target.commit(
        matrix,
        unionRect(touched, affineBounds(matrix, target.source))
      )
      return true
    },
    cancel() {
      if (!active) return
      active = false
      target.cancel(start, !sameAffine(matrix, start))
    },
  }
}
