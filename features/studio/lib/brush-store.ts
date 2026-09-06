import type { Brush } from "@/engine/brush/brush"
import type { GrayscaleTexture } from "@/engine/brush/texture"

/**
 * Where brushes live, as a seam rather than a decision — the shape
 * `features/color/lib/palette-store.ts` has, for the same reason (25).
 *
 * The studio has two hosts: the cloud one mounts inside a Convex provider and
 * keeps brushes on the account, so they follow the artist to another machine;
 * the anonymous one at `/` mounts outside it and has only this browser. The
 * library panel is written once against this, and neither host's storage
 * leaks into it.
 *
 * Built-in brushes are *not* in here. They ship in the binary
 * (`engine/brush/presets.ts`), which is precisely what makes them
 * indestructible: there is no row to delete. A store holds only what the
 * artist made.
 */

export type StoredBrush = Readonly<{
  id: string
  name: string
  /** The set it is shelved in. Sets are names, not rows: an empty one is gone. */
  set: string
  /** Position within its set, counted from the top. */
  order: number
  brush: Brush
}>

/**
 * A texture the artist brought, kept beside the brushes that name it — because
 * a brush is a recipe and travels as one (24): a definition that arrived on a
 * new machine without its paper would resolve to nothing and draw untextured.
 */
export type StoredTexture = Readonly<{
  id: string
  name: string
  texture: GrayscaleTexture
}>

/** What was in the hand when a document was last closed. */
export type LastUsedBrush = Readonly<{
  brushId: string
  /** Kept apart from the brush: size is adjusted constantly and never saved. */
  radius: number
}>

export type BrushLibraryState = Readonly<{
  brushes: readonly StoredBrush[]
  textures: readonly StoredTexture[]
  /** Null when this document has never been painted in on this account. */
  lastUsed: LastUsedBrush | null
  /** False while the first read is outstanding, so the panel can wait. */
  loaded: boolean
}>

export type BrushStore = Readonly<{
  /** A React hook: called once, unconditionally, at the top of the panel. */
  useBrushLibrary(documentId?: string): BrushLibraryState
  /** Resolves with the new brush's id, so the caller can select it. */
  save(name: string, set: string, brush: Brush): Promise<string>
  /** Replaces a saved brush's definition, leaving its name and place alone. */
  update(id: string, brush: Brush): Promise<unknown>
  rename(id: string, name: string): Promise<unknown>
  remove(id: string): Promise<unknown>
  /** Shelves a brush in a set, at a position counted from the top. */
  move(id: string, set: string, index: number): Promise<unknown>
  saveTexture(name: string, texture: GrayscaleTexture): Promise<string>
  /** Remembers the brush and size a document was left with. */
  recordLastUsed(
    documentId: string,
    brushId: string,
    radius: number
  ): Promise<unknown>
}>
