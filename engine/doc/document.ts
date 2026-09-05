import type { BlendMode } from "../shaders/blend-modes"
export type { BlendMode } from "../shaders/blend-modes"

import { seedScene } from "./scene"
import {
  cloneTiledLayer,
  createTiledLayer,
  type TiledLayer,
} from "./tiled-layer"

/**
 * The document: an ordered stack of layers over a fixed pixel canvas (§4.1).
 *
 * Pure data and pure operations. Nothing here knows about a GPU — what the
 * compositor needs is `planComposite`, which is a description of an order and
 * some numbers, and deliberately not a description of any pixels. That split
 * is what makes the cached compositor (D19) possible at all: a plan that
 * cannot mention pixels cannot be invalidated by painting.
 *
 * Groups, masks and the rest of the tree arrive with ticket 11. Blend modes
 * are carried through the plan and composition key, so changing them rebuilds
 * the affected caches without touching this seam.
 */

export type Layer = {
  readonly id: string
  /** Vector layers are a later renderer over the same slot (D1). */
  readonly kind: "raster"
  name: string
  /** In [0, 1], applied to the whole layer at composite time. */
  opacity: number
  visible: boolean
  locked: boolean
  blend: BlendMode
  /** Clips to the layer beneath it (ticket 11). */
  clip: boolean
  /** The layer's own pixels: sparse, tiled, linear-light (D3). */
  surface: TiledLayer
}

export type PaintDocument = {
  width: number
  height: number
  /** Bottom to top: the order the compositor draws in. */
  layers: Layer[]
  activeLayerId: string
}

/** What one layer contributes to a composite: no pixels, only how they land. */
export type CompositeItem = {
  id: string
  opacity: number
  blend: BlendMode
  clip: boolean
}

/**
 * The frame, as the compositor sees it. Below is flattened once; above may
 * also be flattened when every mode is Normal. Backdrop-dependent upper
 * layers must instead be applied to the live active layer in order (D19).
 */
export type CompositePlan = {
  below: CompositeItem[]
  /** Null only for a document with no layers, which cannot be constructed. */
  active: CompositeItem | null
  above: CompositeItem[]
}

let nextId = 0

function createLayer(
  width: number,
  height: number,
  name: string,
  id = `layer-${++nextId}`
): Layer {
  return {
    id,
    kind: "raster",
    name,
    opacity: 1,
    visible: true,
    locked: false,
    blend: "normal",
    clip: false,
    surface: createTiledLayer({ width, height }),
  }
}

export function createDocument(size: {
  width: number
  height: number
}): PaintDocument {
  const layer = createLayer(size.width, size.height, "Layer 1")
  seedScene(layer.surface)
  return {
    width: size.width,
    height: size.height,
    layers: [layer],
    activeLayerId: layer.id,
  }
}

/** Throws rather than returning null: every caller here has an id from us. */
function indexOf(doc: PaintDocument, id: string): number {
  const index = doc.layers.findIndex((layer) => layer.id === id)
  if (index < 0) throw new Error(`No layer ${id} is in this document.`)
  return index
}

export function findLayer(doc: PaintDocument, id: string): Layer {
  return doc.layers[indexOf(doc, id)]
}

export function activeLayer(doc: PaintDocument): Layer {
  return findLayer(doc, doc.activeLayerId)
}

/**
 * Adds an empty layer directly above the active one and selects it, which is
 * where a painter expects the next mark to go. Returns the new layer's id.
 */
export function addLayer(doc: PaintDocument): string {
  const layer = createLayer(
    doc.width,
    doc.height,
    `Layer ${doc.layers.length + 1}`
  )
  doc.layers.splice(indexOf(doc, doc.activeLayerId) + 1, 0, layer)
  doc.activeLayerId = layer.id
  return layer.id
}

/** Places an independent pixel copy directly above its source and selects it. */
export function duplicateLayer(doc: PaintDocument, id: string): string {
  const sourceIndex = indexOf(doc, id)
  const source = doc.layers[sourceIndex]
  const copy = {
    ...source,
    id: `layer-${++nextId}`,
    name: `${source.name} copy`,
    surface: cloneTiledLayer(source.surface),
  }
  doc.layers.splice(sourceIndex + 1, 0, copy)
  doc.activeLayerId = copy.id
  return copy.id
}

export function removeLayer(doc: PaintDocument, id: string): void {
  const index = indexOf(doc, id)
  if (doc.layers.length === 1)
    throw new Error("A document must keep at least one layer.")
  doc.layers.splice(index, 1)
  // The layer under the hole, or the bottom of the stack when there was none.
  if (doc.activeLayerId === id)
    doc.activeLayerId = doc.layers[Math.max(0, index - 1)].id
}

export function selectLayer(doc: PaintDocument, id: string): void {
  doc.activeLayerId = findLayer(doc, id).id
}

/** `index` is the destination position in the stack, counted from the bottom. */
export function moveLayer(doc: PaintDocument, id: string, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= doc.layers.length)
    throw new Error("A layer cannot move outside the stack.")
  const [layer] = doc.layers.splice(indexOf(doc, id), 1)
  doc.layers.splice(index, 0, layer)
}

/** Everything about a layer except the pixels: what a panel shows and edits. */
export type LayerSettings = Omit<Layer, "id" | "kind" | "surface">

/** A change to some of them. Unnamed fields are left alone. */
export type LayerPatch = Partial<LayerSettings>

export function setLayer(
  doc: PaintDocument,
  id: string,
  patch: LayerPatch
): void {
  const layer = findLayer(doc, id)
  if (patch.opacity !== undefined) {
    if (
      !Number.isFinite(patch.opacity) ||
      patch.opacity < 0 ||
      patch.opacity > 1
    )
      throw new Error("Layer opacity must be a finite value in [0, 1].")
    layer.opacity = patch.opacity
  }
  if (patch.name !== undefined) {
    if (patch.name === "") throw new Error("A layer must have a name.")
    layer.name = patch.name
  }
  if (patch.visible !== undefined) layer.visible = patch.visible
  if (patch.locked !== undefined) layer.locked = patch.locked
  if (patch.blend !== undefined) layer.blend = patch.blend
  if (patch.clip !== undefined) layer.clip = patch.clip
}

/**
 * Re-tiles every layer at a new canvas size, keeping the stack, its settings
 * and the selection. Painted pixels do not survive: the document is authored
 * in canvas pixels until the view matrix lands (ticket 13), so a resize is a
 * different document at the same structure.
 */
export function resizeDocument(
  doc: PaintDocument,
  width: number,
  height: number
): void {
  doc.width = width
  doc.height = height
  doc.layers = doc.layers.map((layer) => ({
    ...layer,
    surface: createTiledLayer({ width, height }),
  }))
  seedScene(doc.layers[0].surface)
}

const item = (layer: Layer): CompositeItem => ({
  id: layer.id,
  // Hidden and fully transparent composite identically, and saying so here
  // means the compositor never needs to know about visibility at all.
  opacity: layer.visible ? layer.opacity : 0,
  blend: layer.blend,
  clip: layer.clip,
})

export function planComposite(doc: PaintDocument): CompositePlan {
  const split = indexOf(doc, doc.activeLayerId)
  const contributes = (layer: Layer) => layer.visible && layer.opacity > 0
  return {
    below: doc.layers.slice(0, split).filter(contributes).map(item),
    // The active layer stays in the plan even when it is hidden: it is where
    // the pen is painting, and the caches are built around it either way.
    active: item(doc.layers[split]),
    above: doc.layers
      .slice(split + 1)
      .filter(contributes)
      .map(item),
  }
}

/**
 * A plan's identity: what the compositor has been told, all of it. A plan that
 * hashes the same asks for nothing to be done. Pixels are absent from it by
 * construction, which is the rule in §6.3 — structure, not paint — and so is a
 * layer's name, which is not structure the compositor can see.
 */
export function compositionKey(plan: CompositePlan): string {
  return JSON.stringify(plan)
}

/**
 * The part of a plan the two caches are built from. Narrower than the plan on
 * purpose: the active layer is in neither cache, so fading it is a uniform to
 * rewrite rather than two caches to flatten again. Only its identity matters
 * here, because that is what decides where the stack is cut.
 */
export function cacheKey(plan: CompositePlan): string {
  return JSON.stringify([plan.below, plan.active?.id, plan.above])
}
