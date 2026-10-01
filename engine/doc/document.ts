import type { BlendMode } from "../shaders/blend-modes"
export type { BlendMode } from "../shaders/blend-modes"

import type { Guide } from "./guides"
import type { ImagePlacement } from "./image-placement"
import type { PlacedImage } from "./image-source"
export type { PlacedImage } from "./image-source"
import { seedScene } from "./scene"
import { EMPTY_SCENE, type VectorScene } from "./vector-scene"
import { cloneTiledMask, createTiledMask, type TiledMask } from "./tiled-mask"
import {
  cloneTiledLayer,
  createTiledLayer,
  type TiledLayer,
} from "./tiled-layer"

export type LayerMask = {
  readonly id: string
  enabled: boolean
  /** Sparse hidden coverage: absent pixels reveal the layer. */
  surface: TiledMask
}

type NodeSettings = {
  readonly id: string
  name: string
  opacity: number
  visible: boolean
  blend: BlendMode
  clip: boolean
  mask?: LayerMask
}

export type Layer = NodeSettings & {
  readonly kind: "raster"
  locked: boolean
  /**
   * Holds a placed image. Its pixels are the picture, so the pen is refused
   * here as it is on a locked layer; a mask still takes paint.
   */
  image: boolean
  /**
   * The picture this layer was made from, and where it sits (06). Kept so a
   * move, a scale or a turn re-renders from the original rather than from the
   * last render of it, which is what stops a photograph softening as it is
   * adjusted. Gone the moment the layer is handed to the pen: from then on
   * the pixels are the artist's and there is no original to go back to.
   */
  placed?: PlacedImage
  surface: TiledLayer
}

/**
 * Holds a scene of shapes rather than paint (19). Its pixels are drawn from
 * the scene by the renderer whenever the scene changes, so they are a cache
 * of it: undo records the scene's edits, a save writes the scene, and the
 * pen is refused here as it is on an image layer — a mask still takes paint.
 */
export type VectorLayer = NodeSettings & {
  readonly kind: "vector"
  locked: boolean
  scene: VectorScene
}

/** A node with pixels of its own for the compositor: anything but a group. */
export type LeafLayer = Layer | VectorLayer

export type LayerGroup = NodeSettings & {
  readonly kind: "group"
  children: LayerNode[]
}

export type LayerNode = Layer | VectorLayer | LayerGroup

export type PaintDocument = {
  width: number
  height: number
  /** Bottom to top at every level. */
  layers: LayerNode[]
  /** Always a leaf: groups organise paint targets but are not one. */
  activeLayerId: string
  paintingMask: boolean
  /** Lines laid over the canvas from the rulers (16), in document pixels. */
  guides: Guide[]
}

export type CompositeItem = {
  id: string
  /**
   * Omitted by older direct renderer probes, and for every leaf: a vector
   * layer's pixels composite exactly as a raster layer's do.
   */
  kind?: "raster" | "group"
  opacity: number
  blend: BlendMode
  clip: boolean
  maskId?: string
  children?: CompositeItem[]
}

/** One level around the active leaf, from its parent out to the document. */
export type CompositeStage = {
  below: CompositeItem[]
  above: CompositeItem[]
  /** The group that owns this level; null is the document root. */
  container: CompositeItem | null
}

export type CompositePlan = {
  /** Root-level aliases retained for simple stacks and renderer probes. */
  below: CompositeItem[]
  active: CompositeItem | null
  above: CompositeItem[]
  stages?: CompositeStage[]
  paintTargetId?: string
}

let nextId = 0

/**
 * Keeps generated ids clear of ones already in use. A reopened document brings
 * its own `layer-7` with it, and the counter behind new layers starts at zero
 * in a fresh tab: without this the next layer added would collide with a
 * restored one and two surfaces would share a texture.
 */
export function reserveIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const sequence = /-(\d+)$/.exec(id)
    if (sequence) nextId = Math.max(nextId, Number(sequence[1]))
  }
}

function base(name: string, id: string): NodeSettings {
  return { id, name, opacity: 1, visible: true, blend: "normal", clip: false }
}

function createLayer(
  width: number,
  height: number,
  name: string,
  id = `layer-${++nextId}`
): Layer {
  return {
    ...base(name, id),
    kind: "raster",
    locked: false,
    image: false,
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
    ...size,
    layers: [layer],
    activeLayerId: layer.id,
    paintingMask: false,
    guides: [],
  }
}

/** A fresh artwork surface, with one editable layer and no starter marks. */
export function createBlankDocument(size: {
  width: number
  height: number
}): PaintDocument {
  const layer = createLayer(size.width, size.height, "Layer 1")
  return {
    ...size,
    layers: [layer],
    activeLayerId: layer.id,
    paintingMask: false,
    guides: [],
  }
}

type Located = { node: LayerNode; siblings: LayerNode[]; index: number }

function locate(nodes: LayerNode[], id: string): Located | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.id === id) return { node, siblings: nodes, index }
    if (node.kind === "group") {
      const nested = locate(node.children, id)
      if (nested) return nested
    }
  }
}

function requireNode(doc: PaintDocument, id: string): Located {
  const found = locate(doc.layers, id)
  if (!found) throw new Error(`No layer ${id} is in this document.`)
  return found
}

export function findNode(doc: PaintDocument, id: string): LayerNode {
  return requireNode(doc, id).node
}

export function findLayer(doc: PaintDocument, id: string): LeafLayer {
  const node = findNode(doc, id)
  if (node.kind === "group") throw new Error(`${id} is a group, not a layer.`)
  return node
}

/** The layer as a raster one, or the failure of asking a vector layer for paint. */
export function findRasterLayer(doc: PaintDocument, id: string): Layer {
  const layer = findLayer(doc, id)
  if (layer.kind !== "raster")
    throw new Error(`${layer.name} holds shapes, not paint.`)
  return layer
}

export function activeLayer(doc: PaintDocument): LeafLayer {
  return findLayer(doc, doc.activeLayerId)
}

/** Every layer with pixels of its own, raster and vector, bottom to top. */
export function leafLayers(nodes: readonly LayerNode[]): LeafLayer[] {
  return nodes.flatMap((node) =>
    node.kind === "group" ? leafLayers(node.children) : [node]
  )
}

export function rasterLayers(nodes: readonly LayerNode[]): Layer[] {
  return leafLayers(nodes).filter((node) => node.kind === "raster")
}

function insertAboveActive(doc: PaintDocument, layer: LeafLayer): string {
  const active = requireNode(doc, doc.activeLayerId)
  active.siblings.splice(active.index + 1, 0, layer)
  doc.activeLayerId = layer.id
  doc.paintingMask = false
  return layer.id
}

export function addLayer(doc: PaintDocument): string {
  return insertAboveActive(
    doc,
    createLayer(
      doc.width,
      doc.height,
      `Layer ${leafLayers(doc.layers).length + 1}`
    )
  )
}

/** Adds an empty vector layer above the active one and selects it (19). */
export function addVectorLayer(doc: PaintDocument): string {
  const sequence = ++nextId
  return insertAboveActive(doc, {
    ...base(
      `Vector ${leafLayers(doc.layers).length + 1}`,
      `vector-${sequence}`
    ),
    kind: "vector",
    locked: false,
    scene: EMPTY_SCENE,
  })
}

function cloneLayer(node: LeafLayer): LeafLayer {
  const mask = node.mask
    ? {
        ...node.mask,
        id: `mask-${++nextId}`,
        surface: cloneTiledMask(node.mask.surface),
      }
    : undefined
  const name = `${node.name} copy`
  // A scene is an immutable value, so the copy shares it until either edits.
  if (node.kind === "vector")
    return { ...node, id: `vector-${++nextId}`, name, mask }
  return {
    ...node,
    id: `layer-${++nextId}`,
    name,
    mask,
    surface: cloneTiledLayer(node.surface),
  }
}

export function duplicateLayer(doc: PaintDocument, id: string): string {
  const source = requireNode(doc, id)
  if (source.node.kind === "group")
    throw new Error("Groups cannot be duplicated as layers.")
  const copy = cloneLayer(source.node)
  source.siblings.splice(source.index + 1, 0, copy)
  doc.activeLayerId = copy.id
  doc.paintingMask = false
  return copy.id
}

export function addGroup(
  doc: PaintDocument,
  ids: readonly string[] = [doc.activeLayerId]
): string {
  if (ids.length === 0) throw new Error("A group needs at least one layer.")
  const locations = ids.map((id) => requireNode(doc, id))
  const siblings = locations[0].siblings
  if (locations.some((item) => item.siblings !== siblings))
    throw new Error("Only sibling layers can be grouped together.")
  const sorted = [...locations].sort((a, b) => a.index - b.index)
  if (sorted.some((item, index) => item.index !== sorted[0].index + index))
    throw new Error("Grouped layers must be adjacent.")
  const children = sorted.map((item) => item.node)
  siblings.splice(sorted[0].index, children.length)
  const sequence = ++nextId
  const group: LayerGroup = {
    ...base(`Group ${sequence}`, `group-${sequence}`),
    kind: "group",
    children,
  }
  siblings.splice(sorted[0].index, 0, group)
  return group.id
}

function nearestLeaf(
  nodes: readonly LayerNode[],
  before: number
): LeafLayer | undefined {
  for (let index = Math.min(before, nodes.length - 1); index >= 0; index--) {
    const node = nodes[index]
    if (node.kind !== "group") return node
    const child = leafLayers(node.children).at(-1)
    if (child) return child
  }
}

export function removeLayer(doc: PaintDocument, id: string): LayerNode {
  const found = requireNode(doc, id)
  if (leafLayers(doc.layers).length - leafLayers([found.node]).length < 1)
    throw new Error("A document must keep at least one layer.")
  found.siblings.splice(found.index, 1)
  if (
    leafLayers([found.node]).some((layer) => layer.id === doc.activeLayerId)
  ) {
    const replacement =
      nearestLeaf(found.siblings, found.index - 1) ??
      nearestLeaf(found.siblings, found.index) ??
      leafLayers(doc.layers)[0]
    doc.activeLayerId = replacement.id
    doc.paintingMask = false
  }
  return found.node
}

export function selectLayer(doc: PaintDocument, id: string): void {
  doc.activeLayerId = findLayer(doc, id).id
  doc.paintingMask = false
}

export function moveLayer(
  doc: PaintDocument,
  id: string,
  index: number,
  parentId?: string | null
): void {
  const source = requireNode(doc, id)
  const destination = parentId
    ? (() => {
        const parent = findNode(doc, parentId)
        if (parent.kind !== "group")
          throw new Error(`${parentId} is not a group.`)
        return parent.children
      })()
    : parentId === null
      ? doc.layers
      : source.siblings
  if (!Number.isInteger(index) || index < 0 || index > destination.length)
    throw new Error("A layer cannot move outside the stack.")
  if (
    source.node.kind === "group" &&
    (parentId === source.node.id ||
      locate(source.node.children, parentId ?? ""))
  )
    throw new Error("A group cannot be moved inside itself.")
  source.siblings.splice(source.index, 1)
  destination.splice(index, 0, source.node)
}

export type LayerSettings = Pick<
  LayerNode,
  "name" | "opacity" | "visible" | "blend" | "clip"
> & { locked?: boolean }
export type LayerPatch = Partial<LayerSettings>

export function setLayer(
  doc: PaintDocument,
  id: string,
  patch: LayerPatch
): void {
  const node = findNode(doc, id)
  if (patch.opacity !== undefined) {
    if (
      !Number.isFinite(patch.opacity) ||
      patch.opacity < 0 ||
      patch.opacity > 1
    )
      throw new Error("Layer opacity must be a finite value in [0, 1].")
    node.opacity = patch.opacity
  }
  if (patch.name !== undefined) {
    if (patch.name === "") throw new Error("A layer must have a name.")
    node.name = patch.name
  }
  if (patch.visible !== undefined) node.visible = patch.visible
  if (patch.blend !== undefined) node.blend = patch.blend
  if (patch.clip !== undefined) node.clip = patch.clip
  if (patch.locked !== undefined) {
    if (node.kind === "group") throw new Error("Groups cannot be locked.")
    node.locked = patch.locked
  }
}

/**
 * Hands a placed image over to the pen. The pixels, the name, the mask and the
 * layer's place in the tree are the artist's picture, and this is the moment
 * they said it is theirs to mark. Destructive from here on — erasing takes the
 * photograph's own pixels away — which is why it is asked for rather than
 * assumed, and why the original is let go of with it: a layer that can be
 * painted on cannot also be re-rendered from a file.
 */
export function makeLayerPaintable(doc: PaintDocument, id: string): void {
  const node = findNode(doc, id)
  if (node.kind !== "raster" || !node.image)
    throw new Error(`${node.name} is not a placed image.`)
  node.image = false
  // The original goes with the flag. There is nothing left to re-render from
  // — the pixels below the artist's first mark would no longer be the photo —
  // and keeping the file would be keeping weight in the document that nothing
  // can ever use again.
  delete node.placed
}

/**
 * Turns a vector layer into a paint layer in the same place, under the same
 * id and settings (20). The new surface starts empty: the layer's pixels are
 * already on the GPU, drawn from its scene, and the caller records them from
 * there — which is what makes the conversion one undo step with its pixels.
 */
export function rasteriseLayer(doc: PaintDocument, id: string): Layer {
  const found = requireNode(doc, id)
  const node = found.node
  if (node.kind !== "vector")
    throw new Error(`${node.name} is not a vector layer.`)
  const { scene: _scene, kind: _kind, ...settings } = node
  const layer: Layer = {
    ...settings,
    kind: "raster",
    image: false,
    surface: createTiledLayer({ width: doc.width, height: doc.height }),
  }
  found.siblings[found.index] = layer
  return layer
}

/**
 * Moves a placed image to a placement (06). The original and everything else
 * about the layer are untouched: a transform says where the picture sits, and
 * the pixels are made from that wherever they are made.
 */
export function setPlacement(
  doc: PaintDocument,
  id: string,
  placement: ImagePlacement
): void {
  const node = findNode(doc, id)
  if (node.kind !== "raster" || !node.placed)
    throw new Error(`${node.name} is not a placed image.`)
  node.placed = { ...node.placed, placement }
}

export function addMask(doc: PaintDocument, id: string): string {
  const node = findNode(doc, id)
  if (node.mask) throw new Error(`${node.name} already has a mask.`)
  node.mask = {
    id: `mask-${++nextId}`,
    enabled: true,
    surface: createTiledMask({ width: doc.width, height: doc.height }),
  }
  return node.mask.id
}

export function setMaskEnabled(
  doc: PaintDocument,
  id: string,
  enabled: boolean
): void {
  const node = findNode(doc, id)
  if (!node.mask) throw new Error(`${node.name} has no mask.`)
  node.mask.enabled = enabled
  if (!enabled && id === doc.activeLayerId) doc.paintingMask = false
}

export function removeMask(doc: PaintDocument, id: string): LayerMask {
  const node = findNode(doc, id)
  if (!node.mask) throw new Error(`${node.name} has no mask.`)
  const mask = node.mask
  delete node.mask
  if (id === doc.activeLayerId) doc.paintingMask = false
  return mask
}

export function selectMask(doc: PaintDocument, id: string): void {
  const layer = findLayer(doc, id)
  if (!layer.mask) throw new Error(`${layer.name} has no mask.`)
  doc.activeLayerId = id
  doc.paintingMask = true
}

export function resizeDocument(
  doc: PaintDocument,
  width: number,
  height: number
): void {
  doc.width = width
  doc.height = height
  const resize = (node: LayerNode): LayerNode => {
    const mask = node.mask
      ? { ...node.mask, surface: createTiledMask({ width, height }) }
      : undefined
    if (node.kind === "group")
      return { ...node, mask, children: node.children.map(resize) }
    // A scene is in document pixels, and keeps them across a new size.
    if (node.kind === "vector") return { ...node, mask }
    return { ...node, mask, surface: createTiledLayer({ width, height }) }
  }
  doc.layers = doc.layers.map(resize)
  const first = rasterLayers(doc.layers)[0]
  if (first) seedScene(first.surface)
}

const contributes = (node: LayerNode) => node.visible && node.opacity > 0

/**
 * How far every other layer fades while the artist points at one in the list.
 * Enough to push the rest back without losing where the picked layer sits.
 */
export const HIGHLIGHT_DIM = 0.15

/**
 * `lit`, when given, is the leaf layers picked out; every other leaf is
 * dimmed. Groups keep their own opacity, so nothing is dimmed twice.
 */
function item(node: LayerNode, lit?: ReadonlySet<string>): CompositeItem {
  const dim = node.kind !== "group" && lit && !lit.has(node.id)
  return {
    id: node.id,
    ...(node.kind === "group" ? { kind: "group" as const } : {}),
    opacity: (node.visible ? node.opacity : 0) * (dim ? HIGHLIGHT_DIM : 1),
    blend: node.blend,
    clip: node.clip,
    ...(node.mask?.enabled ? { maskId: node.mask.id } : {}),
    ...(node.kind === "group"
      ? {
          children: node.children
            .filter(contributes)
            .map((child) => item(child, lit)),
        }
      : {}),
  }
}

/**
 * A group as its thumbnail flattens it: its visible children in their own
 * settings, whether or not the group itself is showing. Its own opacity,
 * blend and mask are how it meets what is under it, which a thumbnail of it
 * alone has nothing to say about.
 */
export function groupContents(group: LayerGroup): CompositeItem {
  return item({ ...group, visible: true })
}

export function findNodeIn(
  nodes: readonly LayerNode[],
  id: string
): LayerNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.kind === "group") {
      const found = findNodeIn(node.children, id)
      if (found) return found
    }
  }
}

function pathTo(
  nodes: LayerNode[],
  id: string
): { siblings: LayerNode[]; index: number; groups: LayerGroup[] } | undefined {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]
    if (node.id === id) return { siblings: nodes, index, groups: [] }
    if (node.kind === "group") {
      const nested = pathTo(node.children, id)
      if (nested) return { ...nested, groups: [node, ...nested.groups] }
    }
  }
}

export function planComposite(
  doc: PaintDocument,
  options: { highlight?: string } = {}
): CompositePlan {
  const picked = options.highlight
    ? findNodeIn(doc.layers, options.highlight)
    : undefined
  const lit = picked
    ? new Set(
        (picked.kind === "group" ? leafLayers(picked.children) : [picked]).map(
          (layer) => layer.id
        )
      )
    : undefined
  const itemOf = (node: LayerNode) => item(node, lit)
  const path = pathTo(doc.layers, doc.activeLayerId)
  if (!path)
    throw new Error(`No layer ${doc.activeLayerId} is in this document.`)
  const stages: CompositeStage[] = []
  let siblings = path.siblings
  let index = path.index
  const innerToOuter = [...path.groups].reverse()
  for (const container of innerToOuter) {
    stages.push({
      below: siblings.slice(0, index).filter(contributes).map(itemOf),
      above: siblings
        .slice(index + 1)
        .filter(contributes)
        .map(itemOf),
      container: item({ ...container, children: [] }, lit),
    })
    const parent = requireNode(doc, container.id)
    siblings = parent.siblings
    index = parent.index
  }
  stages.push({
    below: siblings.slice(0, index).filter(contributes).map(itemOf),
    above: siblings
      .slice(index + 1)
      .filter(contributes)
      .map(itemOf),
    container: null,
  })
  const active = findLayer(doc, doc.activeLayerId)
  return {
    below: stages.at(-1)!.below,
    active: item(active, lit),
    above: stages.at(-1)!.above,
    stages,
    paintTargetId: doc.paintingMask ? active.mask!.id : active.id,
  }
}

export function compositionKey(plan: CompositePlan): string {
  return JSON.stringify(plan)
}

export function cacheKey(plan: CompositePlan): string {
  return JSON.stringify(plan.stages ?? [plan.below, plan.above])
}
