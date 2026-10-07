import type { StampContext } from "./dynamics"

export const TIP_SELECTION_MODES = [
  "random",
  "sequential",
  "direction",
  "pressure",
] as const
export type TipSelectionMode = (typeof TIP_SELECTION_MODES)[number]

export function validateTipSelection(
  value: unknown
): asserts value is TipSelectionMode {
  if (!TIP_SELECTION_MODES.some((mode) => mode === value))
    throw new Error(
      "Tip selection must be random, sequential, direction or pressure."
    )
}

/** Select a layer using the stroke's seeded context; sequential uses the dab ordinal. */
export function selectTipFrame(
  mode: TipSelectionMode,
  frames: number,
  context: StampContext,
  dab: number
): number {
  if (mode === "sequential") return dab % frames
  const value =
    mode === "direction"
      ? context.direction
      : mode === "pressure"
        ? context.pressure
        : context.random
  const normalized =
    mode === "direction"
      ? value - Math.floor(value)
      : Math.max(0, Math.min(1, value))
  return Math.min(frames - 1, Math.floor(normalized * frames))
}
