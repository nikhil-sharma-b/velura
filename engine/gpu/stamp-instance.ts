/**
 * The layout of one dab instance, shared because five places have to agree on
 * it: the vertex attributes, the engine that fills the array, the log that
 * replays it, the shader's locations, and the tests. Pressure-driven size and
 * opacity will move exactly these slots.
 */
export const STAMP = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  OPACITY: 3,
} as const

/** Floats per dab instance. */
export const STAMP_STRIDE = 4
