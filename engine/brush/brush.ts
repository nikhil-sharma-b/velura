import type { Modulator } from "./dynamics"
import {
  BRUSH_ACCUMULATION,
  BRUSH_FEATHER,
  BRUSH_FLOW,
  BRUSH_OPACITY,
  BRUSH_RADIUS,
  BRUSH_SPACING_RATIO,
  type Accumulation,
} from "./round-brush"

/**
 * A brush, as data (D23).
 *
 * There is no code and no shader here — only numbers, strings and lists — so a
 * brush can be stored, synced, versioned and shipped in a library (D25) and
 * authored in an editor (D32) without any of that being able to run anything.
 * Everything expressive about a brush lives in `dynamics`, which the graph
 * evaluates against each dab's context.
 *
 * Grain and tip textures (D24) are referenced by id, never embedded: the
 * texture is an asset, the brush is the recipe.
 *
 * The sections architecture 7.1 names but that nothing renders yet — scatter,
 * the blend mode, and grain movement, which belongs with the view matrix that
 * navigation brings (D28) — are deliberately absent rather than present and
 * ignored: they arrive with the renderers that read them (D20), and a field
 * no code consumes is a field nothing keeps honest. The dynamics graph
 * already carries their targets, so adding them is additive.
 */

export type BrushShape = {
  /** Dab radius in canvas pixels, before dynamics scale it. */
  radius: number
  /** Softness of the dab edge, in pixels of falloff inside the rim. */
  feather: number
  /** Width against length, in (0, 1]. One is a circle. */
  roundness: number
  /** Rotation of the tip, as a turn clockwise. */
  angle: number
  /** Stamp spacing as a fraction of the dab diameter. */
  spacing: number
  /** Grayscale tip texture, sampled in stamp space (D24). None is procedural. */
  tipTextureId?: string
}

/**
 * The paper the brush draws on (D24).
 *
 * Grain is sampled in canvas space, so it belongs to the surface rather than
 * to the dab: the same pixel is bitten the same way however the brush passed
 * over it. `scale` stretches the texture across the canvas and `depth` says
 * how much of the mark the paper is allowed to take away, which is what the
 * dynamics graph's `grainDepth` target scales per dab.
 */
export type BrushGrain = {
  /** Greyscale grain texture, sampled in canvas space (D24). */
  textureId: string
  /** Size of one tile of the texture, as a multiple of its own pixels. */
  scale: number
  /** How strongly the paper bites, in [0, 1]. Zero is a smooth surface. */
  depth: number
  /**
   * How much the paper travels with the brush, in [0, 1] (§7.1). Zero is
   * paper: the grain is fixed in canvas space, so the same pixel is bitten
   * the same way however the brush passed over it. One rolls the texture
   * along with the dab, as a crayon carries its own tooth. Between them the
   * grain drifts, which is what dry media that shed do.
   */
  movement: number
}

export type BrushRendering = {
  /** Whether dabs within a stroke take the maximum or accumulate (D27). */
  accumulation: Accumulation
  /** Opacity of the whole stroke, applied once at composite. */
  opacity: number
  /** Opacity of a single dab. */
  flow: number
}

export type Brush = {
  /** Stable across edits, so a stroke can name the brush that drew it. */
  id: string
  name: string
  shape: BrushShape
  /** Absent means the brush lays ink on a perfectly smooth surface. */
  grain?: BrushGrain
  rendering: BrushRendering
  /** Applied in order; see `evaluateDynamics`. */
  dynamics: Modulator[]
}

/** The round brush of ticket 04, restated as data and with no dynamics yet. */
export const DEFAULT_BRUSH: Brush = {
  id: "round",
  name: "Round",
  shape: {
    radius: BRUSH_RADIUS,
    feather: BRUSH_FEATHER,
    roundness: 1,
    angle: 0,
    spacing: BRUSH_SPACING_RATIO,
  },
  rendering: {
    accumulation: BRUSH_ACCUMULATION,
    opacity: BRUSH_OPACITY,
    flow: BRUSH_FLOW,
  },
  dynamics: [],
}

/** Distance between dabs in canvas pixels, for a brush at rest. */
export function brushSpacing(brush: Brush): number {
  return Math.max(0.05, brush.shape.radius * 2 * brush.shape.spacing)
}

/** A brush is plain data, so a copy is a deep clone and nothing else. */
export function cloneBrush(brush: Brush): Brush {
  return structuredClone(brush)
}
