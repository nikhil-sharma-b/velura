import type {
  Brush,
  BrushGrain,
  BrushRendering,
  BrushShape,
} from "@/engine/brush/brush"
import {
  type DynamicsTarget,
  isOffsetTarget,
  type Modulator,
} from "@/engine/brush/dynamics"
import type { EngineCommand } from "@/engine"

/**
 * The working brush of the editor (D32): the brush in the hand, held apart
 * from the brush that was saved.
 *
 * An editor that wrote straight through to the library would make every drag
 * of a slider a permanent change to the artist's brush; one that only wrote on
 * save could not show the edit on the canvas. So there are two brushes, and
 * this module owns the difference between them: `editBrush` produces the next
 * working brush, `brushCommand` is how it reaches the engine, and
 * `isBrushEdited` is what the Save and Revert buttons are lit by.
 *
 * Everything here is a pure function of plain data. A brush is data (D23), so
 * a draft is too, and the editor's state is one `Brush` and nothing else.
 */

/** A `setBrush`, narrowed out of the command union the engine accepts. */
export type SetBrushCommand = Extract<EngineCommand, { type: "setBrush" }>

/**
 * What one control changes. Sections are patched rather than replaced, so a
 * slider that owns the radius need not know the rest of the shape — which is
 * the same bargain `setBrush` itself makes with its callers.
 */
export type BrushEdit = {
  shape?: Partial<Omit<BrushShape, "tipTextureId">> & {
    /** Null restores the procedural disc, as `setBrush` reads it. */
    tipTextureId?: string | null
  }
  /** Null takes the grain away: the brush draws on a smooth surface again. */
  grain?: BrushGrain | null
  rendering?: Partial<BrushRendering>
  dynamics?: Modulator[]
}

/**
 * A section with the patch's named fields over it.
 *
 * A key explicitly set to `undefined` is skipped rather than spread, because a
 * patch says what changed: `{ radius: undefined }` from a control that had
 * nothing to report must leave the radius alone, not erase it.
 */
function patch<T extends object>(section: T, changes: Partial<T> = {}): T {
  const next = { ...section }
  for (const [key, value] of Object.entries(changes))
    if (value !== undefined) next[key as keyof T] = value as T[keyof T]
  return next
}

export function editBrush(brush: Brush, edit: BrushEdit): Brush {
  const next: Brush = {
    ...brush,
    shape: patch(brush.shape, edit.shape as Partial<BrushShape>),
    rendering: patch(brush.rendering, edit.rendering),
    dynamics: structuredClone(edit.dynamics ?? brush.dynamics),
  }
  // Absent rather than present-and-null, on both the tip and the grain: a
  // brush has to stay exactly the JSON it round-trips as (D23), and neither
  // `null` nor `undefined` is a value that model has.
  if (edit.shape && "tipTextureId" in edit.shape && !edit.shape.tipTextureId)
    delete next.shape.tipTextureId
  const grain = edit.grain === undefined ? brush.grain : edit.grain
  if (grain) next.grain = { ...grain }
  else delete next.grain
  return next
}

/**
 * Whether the working brush still says what the saved one says.
 *
 * Structurally, and deliberately not by serialising both: editing a brush
 * removes and re-adds optional fields, so two brushes holding identical values
 * can serialise with their keys in a different order. Comparing the text would
 * call that an edit, and the artist would be offered the chance to keep a
 * change they had already undone.
 */
export function isBrushEdited(saved: Brush, working: Brush): boolean {
  return !equalValues(saved, working)
}

function equalValues(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => equalValues(value, b[index]))
    )
  // A key holding nothing is the same as no key at all: a brush that has been
  // through a copy elsewhere may carry `tipTextureId: undefined` where another
  // simply omits it, and those are the same brush.
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const key of keys) if (!equalValues(left[key], right[key])) return false
  return true
}

/**
 * The whole brush as one command.
 *
 * Every field is named, including the ones that are absent: `setBrush` leaves
 * unnamed fields alone, so a partial command could never take a tip or a grain
 * back off the engine's brush. Sending the lot is what makes the engine's
 * brush a copy of this one rather than a merge of every edit ever made.
 */
export function brushCommand(brush: Brush): SetBrushCommand {
  return {
    type: "setBrush",
    // Identity travels with it, so putting a brush from the library in the
    // hand really is that brush: what the editor titles and what the library
    // shows as selected both read the engine's brush, not a parallel note of
    // which one was clicked.
    id: brush.id,
    name: brush.name,
    radius: brush.shape.radius,
    feather: brush.shape.feather,
    roundness: brush.shape.roundness,
    angle: brush.shape.angle,
    spacing: brush.shape.spacing,
    opacity: brush.rendering.opacity,
    flow: brush.rendering.flow,
    accumulation: brush.rendering.accumulation,
    tipTextureId: brush.shape.tipTextureId ?? null,
    tipSelection: brush.shape.tipSelection ?? null,
    grain: brush.grain ? { ...brush.grain } : null,
    color: brush.color ? { ...brush.color } : null,
    dynamics: structuredClone(brush.dynamics),
  }
}

/**
 * A mapping the artist has just added, in a state the engine accepts.
 *
 * An offset target — one whose neutral value is zero — refuses a multiply,
 * since a scale of zero is zero however hard the pen is pressed. Choosing the
 * mix from the target here means a new mapping is never born invalid, rather
 * than being rejected the moment it is added.
 */
export function newModulator(target: DynamicsTarget): Modulator {
  return {
    source: "pressure",
    target,
    range: [0, 1],
    mix: isOffsetTarget(target) ? "add" : "multiply",
  }
}

/**
 * Hardness is what an artist adjusts; feather, in pixels of falloff inside the
 * rim, is what the shader takes. Full hardness is a hard edge and none is
 * `MAX_FEATHER` — wide enough to read as an airbrush at a usable size, narrow
 * enough that a small dab is not all rim.
 */
export const MAX_FEATHER = 8

export function hardnessOf(feather: number): number {
  return 1 - Math.min(1, Math.max(0, feather / MAX_FEATHER))
}

export function featherOf(hardness: number): number {
  return (1 - Math.min(1, Math.max(0, hardness))) * MAX_FEATHER
}
