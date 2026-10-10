/**
 * The layout of one smudge dab (smudge 01), shared by the engine that fills
 * the array, the renderer that draws it and the shader's locations. The
 * engine writes the first seven floats; the renderer adds the last four,
 * which only it can know: how far the tip came since the dab before, and
 * where the pixels it reads were copied from.
 */
export const SMUDGE = {
  CENTER_X: 0,
  CENTER_Y: 1,
  RADIUS: 2,
  /** How much of the pixel behind replaces the one under the tip, in [0, 1]. */
  STRENGTH: 3,
  /** Rotation of the tip, as a turn clockwise. */
  ANGLE: 4,
  /** Width of the tip against its length, in (0, 1]. */
  ROUNDNESS: 5,
  TIP_FRAME: 6,
  TRAVEL_X: 7,
  TRAVEL_Y: 8,
  ORIGIN_X: 9,
  ORIGIN_Y: 10,
} as const

/** Floats per dab as the engine hands them over. */
export const SMUDGE_STRIDE = 7

/** Floats per dab as the renderer draws them. */
export const SMUDGE_INSTANCE_STRIDE = 11

/** The most dabs one `smudge` call may carry. */
export const MAX_SMUDGE_DABS_PER_DRAW = 512
