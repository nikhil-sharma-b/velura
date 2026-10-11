/**
 * The two rectangles the direct stroke keeps for each dab it draws: the one
 * the dab reads, which is its own and the pixels a travel behind it with a
 * texel's border, and the one it writes, which lies inside the first.
 */
export const DAB_RECT = {
  READ_LEFT: 0,
  READ_TOP: 1,
  READ_WIDTH: 2,
  READ_HEIGHT: 3,
  WRITE_LEFT: 4,
  WRITE_TOP: 5,
  /** Zero, with the height, for a dab that only loads the brush. */
  WRITE_WIDTH: 6,
  WRITE_HEIGHT: 7,
} as const

/** Integers per dab in the array of rectangles. */
export const DAB_RECT_STRIDE = 8

/**
 * Where a run of dabs that drag ends (live brushes 22): the dabs from `start`
 * on that can share one copy out of the surface and one back, because
 * everything they read fits a square `limit` pixels to a side. Answers the
 * dab after the run's last, and fills `region` with the left, top, width and
 * height of what the run reads; answers `start`, a run of none, when the dab
 * there is too large on its own.
 */
export function dabRunEnd(
  rects: Int32Array,
  start: number,
  count: number,
  limit: number,
  region: Int32Array
): number {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  let end = start
  for (; end < count; end++) {
    const rect = end * DAB_RECT_STRIDE
    const dabLeft = rects[rect + DAB_RECT.READ_LEFT]
    const dabTop = rects[rect + DAB_RECT.READ_TOP]
    const nextLeft = Math.min(left, dabLeft)
    const nextTop = Math.min(top, dabTop)
    const nextRight = Math.max(
      right,
      dabLeft + rects[rect + DAB_RECT.READ_WIDTH]
    )
    const nextBottom = Math.max(
      bottom,
      dabTop + rects[rect + DAB_RECT.READ_HEIGHT]
    )
    if (nextRight - nextLeft > limit || nextBottom - nextTop > limit) break
    left = nextLeft
    top = nextTop
    right = nextRight
    bottom = nextBottom
  }
  if (end > start) {
    region[0] = left
    region[1] = top
    region[2] = right - left
    region[3] = bottom - top
  }
  return end
}
