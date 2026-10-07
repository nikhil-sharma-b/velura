import type { Brush } from "./brush"
import data from "./krita-presets.json"

/**
 * The brushes ported from Krita's default bundle (brush library 05), in the
 * sets Krita's own tags put them in.
 *
 * Data, not code: `tooling/krita-presets.ts` writes the JSON by running the
 * curated `.kpp` files through the same translator the import uses, then the
 * hand tuning in `tooling/krita-presets/curation.ts`. What each one lost in
 * translation is in `tooling/krita-presets/REPORT.md`. Their tips and papers
 * are `krita:*` textures, resolved lazily, so shipping them costs startup
 * nothing until one is picked up.
 */

export type BuiltinBrushSet = Readonly<{
  name: string
  brushes: readonly Brush[]
}>

function freeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const KRITA_BRUSH_SETS: readonly BuiltinBrushSet[] = freeze(
  // JSON widens literals; every brush is checked against the stored-brush
  // rules in `tests/unit/krita-presets.test.ts`.
  data.sets as unknown as BuiltinBrushSet[]
)

export const KRITA_BRUSHES: readonly Brush[] = Object.freeze(
  KRITA_BRUSH_SETS.flatMap((set) => set.brushes)
)
