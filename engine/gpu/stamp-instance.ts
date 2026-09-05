/**
 * The layout of one dab instance, shared because five places have to agree on
 * it: the vertex attributes, the engine that fills the array, the log that
 * replays it, the shader's locations, and the tests. The dynamics graph (D23)
 * shapes every field but the centre, which the resampled path decides: size
 * and flow reach `RADIUS` and `OPACITY`, and the tip's orientation and the
 * paper's bite reach the three that follow (D24).
 */
export const STAMP = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  OPACITY: 3,
  /** Rotation of the tip, as a turn clockwise. */
  ANGLE: 4,
  /** Width of the tip against its length, in (0, 1]. */
  ROUNDNESS: 5,
  /** How strongly the canvas grain bites this dab, in [0, 1]. */
  GRAIN_DEPTH: 6,
} as const

/** Floats per dab instance. */
export const STAMP_STRIDE = 7
