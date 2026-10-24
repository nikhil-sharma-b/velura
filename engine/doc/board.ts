/**
 * The board a document's paper lies on (fluid brushes 38): tilted, wet paint
 * runs downhill on it. Chosen per document and saved with it, beside its
 * paper. Down is on the paper, not the screen, so turning the view does not
 * change which way paint runs.
 */
export type Board = {
  /** How steep, from 0, flat, to 1, the steepest. Flat, nothing runs. */
  steepness: number
  /**
   * Which way is down, in degrees clockwise from the paper's bottom edge:
   * 0 is toward the bottom, 90 toward the left, in [0, 360).
   */
  direction: number
}

/** The board every document lay on before it could tilt one: flat. */
export const FLAT_BOARD: Board = Object.freeze({ steepness: 0, direction: 0 })

/** Whether paint on this board stays where the brush put it. */
export const isFlat = (board: Board) => board.steepness <= 0

/**
 * A board as it may be stored, from whatever arrived: a save from an older
 * client, which wrote none, or one with a steepness or direction that is not
 * a number. Either opens flat. A steepness past either end is held to it,
 * and a direction is turned into [0, 360).
 */
export function normaliseBoard(raw: unknown): Board {
  if (typeof raw !== "object" || raw === null) return FLAT_BOARD
  const { steepness, direction } = raw as Partial<Board>
  if (typeof steepness !== "number" || !Number.isFinite(steepness))
    return FLAT_BOARD
  if (typeof direction !== "number" || !Number.isFinite(direction))
    return FLAT_BOARD
  const steep = Math.min(1, Math.max(0, steepness))
  if (steep === 0) return FLAT_BOARD
  return { steepness: steep, direction: ((direction % 360) + 360) % 360 }
}

/** Whether two boards tilt the same way by the same amount. */
export const sameBoard = (a: Board, b: Board) =>
  isFlat(a) && isFlat(b)
    ? true
    : a.steepness === b.steepness && a.direction === b.direction

/**
 * Down on the paper as a unit vector in document space, x to the right and
 * y down the page: the bottom edge is (0, 1), the left (−1, 0).
 */
export function boardDown(board: Board): { x: number; y: number } {
  const turn = (board.direction * Math.PI) / 180
  return { x: -Math.sin(turn), y: Math.cos(turn) }
}
