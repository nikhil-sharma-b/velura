import { validateTexture } from "../../engine/brush/texture"
import { validateTipSelection } from "../../engine/brush/tip-sets"
import { validateBrushColor } from "../../engine/brush/brush"
/**
 * What a stored brush is, in the shape of `convex/lib/palette.ts`: rules that
 * hold with or without a database, so the library panel and the mutation it
 * calls cannot disagree about what may be saved.
 *
 * A brush is serialisable JSON with no code in it (D23), which is exactly why
 * it needs normalising on the way in rather than trusting: a definition
 * arrives from another machine, a `.velura` file, or a client several versions
 * old, and the engine's per-dab path is written on the assumption that it was
 * checked once at the boundary. `normaliseBrushDefinition` is that boundary —
 * it rebuilds the brush field by field, so anything the model has no place for
 * is dropped rather than stored and handed back to a future reader.
 */

import type {
  Brush,
  BrushGrain,
  BrushRendering,
  BrushShape,
} from "../../engine/brush/brush"
import { type Modulator, validateDynamics } from "../../engine/brush/dynamics"
import { type BrushScatter, validateScatter } from "../../engine/brush/scatter"

export const MAX_BRUSH_NAME_LENGTH = 120
export const MAX_SET_NAME_LENGTH = 60
export const DEFAULT_BRUSH_NAME = "Untitled brush"
/** Where a brush saved without a set of its own goes. */
export const DEFAULT_BRUSH_SET = "My brushes"
/** A library, not an archive: enough for a career's worth of variants. */
export const MAX_BRUSHES = 500
/**
 * Textures are stored as bytes on a row, so their size is the row's size, and
 * a Convex document is capped around a mebibyte. A square at this bound is a
 * quarter of that, which leaves the ceiling well clear of the limit and keeps
 * a library's worth of assets a quick read on a slow connection — while still
 * being finer than the built-in paper, which is 256 square.
 */
export const MAX_TEXTURE_DIMENSION = 512
export const MAX_TEXTURE_NAME_LENGTH = 120

function collapse(name: string, limit: number, fallback: string): string {
  const collapsed = String(name ?? "")
    .trim()
    .replace(/\s+/g, " ")
  return (collapsed || fallback).slice(0, limit)
}

export function normaliseBrushName(name: string): string {
  return collapse(name, MAX_BRUSH_NAME_LENGTH, DEFAULT_BRUSH_NAME)
}

export function normaliseSetName(name: string): string {
  return collapse(name, MAX_SET_NAME_LENGTH, DEFAULT_BRUSH_SET)
}

export function normaliseTextureName(name: string): string {
  return collapse(name, MAX_TEXTURE_NAME_LENGTH, "Texture")
}

function positive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error(`Brush ${field} must be a positive number.`)
  return value
}

function inRange(
  value: unknown,
  field: string,
  low: number,
  high: number
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < low ||
    value > high
  )
    throw new Error(`Brush ${field} must be between ${low} and ${high}.`)
  return value
}

function finite(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new Error(`Brush ${field} must be a number.`)
  return value
}

function textureId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 200)
    throw new Error(`Brush ${field} must name a texture.`)
  return value
}

function normaliseShape(value: unknown): BrushShape {
  const shape = (value ?? {}) as Record<string, unknown>
  const next: BrushShape = {
    radius: positive(shape.radius, "radius"),
    // Zero feather is a hard edge, which is a brush an artist may well want.
    feather: inRange(shape.feather, "feather", 0, 512),
    roundness: inRange(shape.roundness, "roundness", 0.01, 1),
    angle: finite(shape.angle, "angle"),
    spacing: positive(shape.spacing, "spacing"),
  }
  // Absent rather than present-and-undefined: a brush has to stay exactly the
  // JSON it round-trips as, and `{ tipTextureId: undefined }` does not.
  if (shape.tipTextureId !== undefined && shape.tipTextureId !== null)
    next.tipTextureId = textureId(shape.tipTextureId, "tip texture")
  if (shape.tipSelection !== undefined) {
    validateTipSelection(shape.tipSelection)
    next.tipSelection = shape.tipSelection
  }
  return next
}

function normaliseGrain(value: unknown): BrushGrain {
  const grain = value as Record<string, unknown>
  return {
    textureId: textureId(grain.textureId, "grain texture"),
    scale: positive(grain.scale, "grain scale"),
    depth: inRange(grain.depth, "grain depth", 0, 1),
    movement: inRange(grain.movement, "grain movement", 0, 1),
  }
}

function normaliseScatter(value: unknown): BrushScatter {
  const scatter = value as Record<string, unknown>
  const next = {
    amount: scatter.amount,
    count: scatter.count,
    axes: scatter.axes,
  } as BrushScatter
  // The engine's own rule, as for dynamics below.
  validateScatter(next)
  return next
}

function normaliseRendering(value: unknown): BrushRendering {
  const rendering = (value ?? {}) as Record<string, unknown>
  if (
    rendering.accumulation !== "coverage" &&
    rendering.accumulation !== "buildup"
  )
    throw new Error("Brush accumulation must be coverage or buildup.")
  return {
    accumulation: rendering.accumulation,
    opacity: inRange(rendering.opacity, "opacity", 0, 1),
    flow: inRange(rendering.flow, "flow", 0, 1),
  }
}

function normaliseModulators(value: unknown): Modulator[] {
  if (!Array.isArray(value)) throw new Error("Brush dynamics must be a list.")
  const modulators = value.map((entry) => {
    const modulator = (entry ?? {}) as Modulator
    const next: Modulator = {
      source: modulator.source,
      target: modulator.target,
      range: [Number(modulator.range?.[0]), Number(modulator.range?.[1])],
      mix: modulator.mix,
    }
    if (modulator.curve !== undefined)
      next.curve = modulator.curve.map((point) => ({
        x: point?.x,
        y: point?.y,
      }))
    return next
  })
  // The engine's own rule, rather than a second copy of it here: a definition
  // this accepts is one `evaluateDynamics` can be handed unexamined.
  validateDynamics(modulators)
  return modulators
}

/**
 * A brush as it may be stored: every field rebuilt, nothing else carried.
 * `id` and `name` are the library row's business, so a definition holds
 * whatever it arrived with and the row is what names the brush.
 */
export function normaliseBrushDefinition(value: unknown): Brush {
  if (typeof value !== "object" || value === null)
    throw new Error("A brush must be an object.")
  const brush = value as Partial<Brush>
  const next: Brush = {
    id: typeof brush.id === "string" ? brush.id.slice(0, 200) : "brush",
    name: normaliseBrushName(brush.name ?? ""),
    shape: normaliseShape(brush.shape),
    rendering: normaliseRendering(brush.rendering),
    dynamics: normaliseModulators(brush.dynamics ?? []),
  }
  if (brush.grain !== undefined && brush.grain !== null)
    next.grain = normaliseGrain(brush.grain)
  if (brush.color !== undefined && brush.color !== null) {
    validateBrushColor(brush.color)
    next.color = {
      hue: brush.color.hue,
      saturation: brush.color.saturation,
      lightness: brush.color.lightness,
    }
  }
  // Absent on every brush saved before scatter existed, and absent is what
  // draws the way those brushes always drew.
  if (brush.scatter !== undefined && brush.scatter !== null)
    next.scatter = normaliseScatter(brush.scatter)
  return next
}

/**
 * The position a brush saved into a set takes: the end of it, which is where
 * the hand that saved it will look. Shared by both stores, so a brush saved
 * signed out lands where the same brush saved signed in would.
 */
export function nextOrderIn(
  placements: readonly { set: string; order: number }[],
  set: string
): number {
  return placements
    .filter((placement) => placement.set === set)
    .reduce((last, placement) => Math.max(last, placement.order + 1), 0)
}

/** Where one brush sits in the library: which set, and where within it. */
export type BrushPlacement = { id: string; set: string; order: number }

/**
 * The placements that change when a brush is dragged to a position.
 *
 * Positions are renumbered densely rather than wedged between neighbours with
 * a fractional key: a set is a shelf of a few dozen brushes, so rewriting the
 * ones that moved is a handful of patches and leaves the order readable in the
 * row rather than as an accumulating fraction. Only the sets involved are
 * touched, and a position past the end means "put it last" — which is what the
 * hand that overshot the drop was saying.
 */
export function reorderBrushes(
  placements: readonly BrushPlacement[],
  id: string,
  set: string,
  index: number
): BrushPlacement[] {
  const moving = placements.find((placement) => placement.id === id)
  if (!moving) return []
  const target = normaliseSetName(set)
  const inOrder = (name: string) =>
    placements
      .filter((placement) => placement.set === name && placement.id !== id)
      .sort((a, b) => a.order - b.order)

  const destination = inOrder(target)
  destination.splice(
    Math.min(destination.length, Math.max(0, Math.trunc(index))),
    0,
    { ...moving, set: target }
  )
  const renumbered = destination.map((placement, at) => ({
    id: placement.id,
    set: target,
    order: at,
  }))
  // The set it left closes the gap behind it, so an order is always the
  // position a reader would count.
  const source =
    moving.set === target
      ? []
      : inOrder(moving.set).map((placement, at) => ({
          id: placement.id,
          set: moving.set,
          order: at,
        }))
  return [...renumbered, ...source].filter((placement) => {
    const before = placements.find((existing) => existing.id === placement.id)
    return (
      before === undefined ||
      before.set !== placement.set ||
      before.order !== placement.order
    )
  })
}

/** A greyscale texture as it is stored: one byte per texel, top row first. */
export type StoredTextureData = {
  frameCount?: number
  width: number
  height: number
  data: Uint8Array
}

export function normaliseStoredTexture(value: unknown): StoredTextureData {
  const texture = (value ?? {}) as Partial<StoredTextureData>
  const { width, height } = texture
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) < 1 ||
    (height as number) < 1
  )
    throw new Error("A texture must have positive integer dimensions.")
  if (
    (width as number) > MAX_TEXTURE_DIMENSION ||
    (height as number) > MAX_TEXTURE_DIMENSION
  )
    throw new Error(
      `A texture may be at most ${MAX_TEXTURE_DIMENSION} pixels on a side.`
    )
  const data = texture.data
  if (!(data instanceof Uint8Array))
    throw new Error("A texture must be single-channel bytes.")
  const stored: StoredTextureData = {
    width: width as number,
    height: height as number,
    data,
  }
  if (texture.frameCount !== undefined) stored.frameCount = texture.frameCount
  validateTexture(stored)
  if (data.length > MAX_TEXTURE_DIMENSION * MAX_TEXTURE_DIMENSION)
    throw new Error(
      "A texture's frames may hold at most 262144 bytes in total."
    )
  return stored
}
