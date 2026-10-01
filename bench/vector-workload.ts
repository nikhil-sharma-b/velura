/**
 * The vector workload (19): one layer holding many paths, for measuring what
 * it costs to draw a scene back into its pixels.
 *
 * A vector layer is redrawn wherever its scene changes, so the cost that
 * matters is a redraw's: of the whole layer, when an edit spans it, and of
 * the small region one object's edit touches. The scene is seeded like the
 * painting workload, so a run on one machine can be compared with the next.
 */

import type { VectorObject, VectorStroke } from "../engine"
import { createRandom } from "./workload"

export type VectorWorkloadOptions = {
  width: number
  height: number
  /** How many paths lie over the backdrop. */
  paths: number
  seed: number
}

/** The scene measured against, at sizes that keep a run under a minute. */
export const VECTOR_WORKLOAD: VectorWorkloadOptions = Object.freeze({
  width: 4096,
  height: 4096,
  paths: 2000,
  seed: 1,
})

const PALETTE = ["#d0402a", "#2a6ad0", "#3aa84a", "#e0b030", "#1b1b1b"]

/**
 * A canvas-wide backdrop at the bottom — editing it redraws the whole layer
 * — and over it `paths` closed and open polygons: irregular stars that
 * cross themselves, filled, outlined or both, with every join and cap.
 */
export function createVectorWorkload(options: VectorWorkloadOptions): {
  objects: VectorObject[]
} {
  const random = createRandom(options.seed)
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)]
  const objects: VectorObject[] = [
    {
      id: "backdrop",
      geometry: {
        kind: "rect",
        x: 0,
        y: 0,
        width: options.width,
        height: options.height,
      },
      transform: [1, 0, 0, 1, 0, 0],
      style: {
        fill: { color: "#f4efe6", opacity: 1, rule: "nonzero" },
        stroke: null,
      },
    },
  ]
  for (let i = 0; i < options.paths; i++) {
    const cx = random() * options.width
    const cy = random() * options.height
    const radius = 10 + random() * 90
    const count = 5 + Math.floor(random() * 10)
    // Every other vertex jumps across the middle, so outlines cross.
    const points = Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 4 + random() * 0.3
      const reach = radius * (0.4 + random() * 0.6)
      return {
        x: cx + reach * Math.cos(angle),
        y: cy + reach * Math.sin(angle),
      }
    })
    const which = i % 3
    const stroke: VectorStroke = {
      color: pick(PALETTE),
      opacity: 1,
      width: 1 + random() * 8,
      cap: pick(["butt", "round", "square"] as const),
      join: pick(["miter", "round", "bevel"] as const),
    }
    const closed = which !== 1
    objects.push({
      id: `path-${i}`,
      geometry: { kind: "polygon", points, closed },
      transform: [1, 0, 0, 1, 0, 0],
      style: {
        fill: closed
          ? {
              color: pick(PALETTE),
              opacity: 0.5 + random() * 0.5,
              rule: random() < 0.5 ? "nonzero" : "evenodd",
            }
          : null,
        stroke: which === 0 ? null : stroke,
      },
    })
  }
  return { objects }
}
