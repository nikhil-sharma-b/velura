import type { PixelRect, TileCoord } from "../doc/tile-grid"

/**
 * What a kept stroke left: the box round the whole mark, and the tiles its
 * dabs drew into, along the rows. A scattering stroke's box is mostly tiles
 * no dab reached, so history is given the tiles (live brushes 30).
 */
export type StrokeMark = { region: PixelRect; tiles: TileCoord[] }

/**
 * One way of turning a stroke's dabs into pixels (§6.2). A stroke begins,
 * takes dabs a frame's worth at a time, and ends kept or cancelled.
 *
 * There are three. The buffered stroke (D27) draws every brush's dabs into
 * the stroke buffer and lands them on the layer once, at the stroke's
 * opacity. The direct stroke (D29) reads and writes the surface itself as it
 * goes, which is what smudge and wet brushes (D41) need: a buffer of new
 * paint holds nothing to drag. The fluid stroke (D42) lays water and pigment
 * into the layer's wet surface, and the layer's own pixels change only when
 * that settles.
 *
 * `Opening` is what a stroke has to be told as it begins, and `dabs` are in
 * the layout its implementation names; they differ, so the engine fills the
 * array each one takes.
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
   * Ends the stroke. Kept, the surface holds the mark and what it reached
   * is returned, or null when it drew nothing; cancelled, the surface holds
   * what it did before the stroke and null is returned.
   */
  end(keep: boolean): StrokeMark | null
}
