import type { Brush } from "./brush"

export type EraserKind = "solid" | "pressure"

/** Erasers own their tip and dynamics independently of the painting brush. */
export function eraserBrush(
  kind: EraserKind = "solid",
  radius = 12,
  opacity = 1
): Brush {
  if (kind !== "solid" && kind !== "pressure")
    throw new Error("Unknown eraser type.")
  if (!Number.isFinite(radius) || radius <= 0)
    throw new Error("Eraser size must be positive.")
  if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)
    throw new Error("Eraser opacity must be in [0, 1].")
  return {
    id: `eraser:${kind}`,
    name: kind === "solid" ? "Solid eraser" : "Pressure eraser",
    shape: { radius, feather: 0, spacing: 0.05, roundness: 1, angle: 0 },
    rendering: { accumulation: "coverage", opacity, flow: 1 },
    dynamics:
      kind === "solid"
        ? []
        : [
            {
              source: "pressure",
              target: "size",
              range: [0.1, 1],
              mix: "multiply",
            },
          ],
  }
}
