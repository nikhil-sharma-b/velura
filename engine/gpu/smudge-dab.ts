/**
 * The layout of one dab of the direct stroke (smudge 01, D41), shared by the
 * engine that fills the array, the renderer that draws it and the shader's
 * locations: a smudge dab, or a wet brush's reservoir exchange. The engine writes the first eight floats; the renderer adds
 * the last four, which only it can know: how far the tip came since the dab
 * before, and where the pixels it reads were copied from.
 */
export const SMUDGE = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  /**
   * Smudge's pixel-behind mix, or how much ground paint a wet brush picks
   * into its reservoir, in [0, 1].
   */
  STRENGTH: 3,
  /** Rotation of the tip, as a turn clockwise. */
  ANGLE: 4,
  /** Width of the tip against its length, in (0, 1]. */
  ROUNDNESS: 5,
  TIP_FRAME: 6,
  /** How much reservoir paint the dab lays, in [0, 1]. Smudge's is 0. */
  FLOW: 7,
  TRAVEL_X: 8,
  TRAVEL_Y: 9,
  ORIGIN_X: 10,
  ORIGIN_Y: 11,
} as const

/** Floats per dab as the engine hands them over. */
export const SMUDGE_STRIDE = 8

/** Floats per dab as the renderer draws them. */
export const SMUDGE_INSTANCE_STRIDE = 12

/** The most dabs one `drawDirect` call may carry. */
export const MAX_SMUDGE_DABS_PER_DRAW = 512
