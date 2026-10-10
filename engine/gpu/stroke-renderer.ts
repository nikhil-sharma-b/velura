import type { PixelRect } from "../doc/tile-grid"

/**
 * One way of turning a stroke's dabs into pixels (§6.2). A stroke begins,
 * takes dabs a frame's worth at a time, and ends kept or cancelled.
 *
 * There are two. The buffered stroke (D27) draws every brush's dabs into the
 * stroke buffer and lands them on the layer once, at the stroke's opacity.
 * The direct stroke (D29) reads and writes the surface itself as it goes,
 * which is what smudge and wet brushes (D41) need: a buffer of new paint
 * holds nothing to drag.
 *
 * `Opening` is what a stroke has to be told as it begins, and `dabs` are in
 * the layout its implementation names; the two differ, so the engine fills
 * each its own array.
 */
export interface StrokeRenderer<Opening> {
  /**
   * Opens a stroke, ending any still in flight. The direct stroke answers
   * false, having opened none, when it lays nothing and its surface holds
   * nothing; the buffered stroke always opens, and throws before the
   * renderer has been sized.
   */
  begin(opening: Opening): boolean
  /** Draws `count` dabs of the stroke in flight. */
  draw(dabs: Float32Array, count: number): void
  /**
   * Ends the stroke. Kept, the surface holds the mark and the region it
   * reached is returned, or null when it drew nothing; cancelled, the
   * surface holds what it did before the stroke and null is returned.
   */
  end(keep: boolean): PixelRect | null
}
