/**
 * The layout of one dab of the direct stroke (smudge 01, D41), shared by the
 * engine that fills the array, the renderer that draws it and the shader's
 * locations: a smudge dab, or a wet brush's, which is a smudge dab that also
 * lays colour. The engine writes the first nine floats; the renderer adds
 * the last four, which only it can know: how far the tip came since the dab
 * before, and where the pixels it reads were copied from.
 */
export const SMUDGE = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  /**
   * How much of the pixel behind replaces the one under the tip, in [0, 1]:
   * smudge's strength, a wet brush's pickup.
   */
  STRENGTH: 3,
  /** Rotation of the tip, as a turn clockwise. */
  ANGLE: 4,
  /** Width of the tip against its length, in (0, 1]. */
  ROUNDNESS: 5,
  TIP_FRAME: 6,
  /** How much of the stroke's colour the dab lays, in [0, 1]. Smudge's is 0. */
  FLOW: 7,
  /**
   * How strongly the canvas grain bites the colour the dab lays, in [0, 1],
   * as a scale on the brush's own depth. Nothing dragged is bitten.
   */
  GRAIN_DEPTH: 8,
  TRAVEL_X: 9,
  TRAVEL_Y: 10,
  ORIGIN_X: 11,
  ORIGIN_Y: 12,
} as const

/** Floats per dab as the engine hands them over. */
export const SMUDGE_STRIDE = 9

/** Floats per dab as the renderer draws them. */
export const SMUDGE_INSTANCE_STRIDE = 13

/** The most dabs one `drawDirect` call may carry. */
export const MAX_SMUDGE_DABS_PER_DRAW = 512
