import type { BlendMode } from "../shaders/blend-modes"
export type { BlendMode } from "../shaders/blend-modes"

import { seedScene } from "./scene"
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
  surface: TiledLayer
}

export type LayerGroup = NodeSettings & {
  readonly kind: "group"
  children: LayerNode[]
}

export type LayerNode = Layer | LayerGroup

export type PaintDocument = {
  width: number
  height: number
  /** Bottom to top at every level. */
  layers: LayerNode[]
  /** Always a raster layer: groups organise paint targets but are not one. */
  activeLayerId: string
  paintingMask: boolean
}

export type CompositeItem = {
  id: string
  /** Omitted by older direct renderer probes, where raster is the default. */
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

export function findLayer(doc: PaintDocument, id: string): Layer {
  const node = findNode(doc, id)
  if (node.kind !== "raster") throw new Error(`${id} is a group, not a layer.`)
  return node
}

export function activeLayer(doc: PaintDocument): Layer {
  return findLayer(doc, doc.activeLayerId)
}

export function rasterLayers(nodes: readonly LayerNode[]): Layer[] {
  return nodes.flatMap((node) =>
    node.kind === "raster" ? [node] : rasterLayers(node.children)
  )
}

export function addLayer(doc: PaintDocument): string {
  const active = requireNode(doc, doc.activeLayerId)
  const layer = createLayer(
    doc.width,
    doc.height,
    `Layer ${rasterLayers(doc.layers).length + 1}`
  )
  active.siblings.splice(active.index + 1, 0, layer)
  doc.activeLayerId = layer.id
  doc.paintingMask = false
  return layer.id
}

function cloneLayer(node: Layer): Layer {
  const id = `layer-${++nextId}`
  const mask = node.mask
    ? {
        ...node.mask,
        id: `mask-${++nextId}`,
        surface: cloneTiledMask(node.mask.surface),
      }
    : undefined
  return {
    ...node,
    id,
    name: `${node.name} copy`,
    mask,
    surface: cloneTiledLayer(node.surface),
  }
}

export function duplicateLayer(doc: PaintDocument, id: string): string {
  const source = requireNode(doc, id)
  if (source.node.kind !== "raster")
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

function nearestRaster(
  nodes: readonly LayerNode[],
  before: number
): Layer | undefined {
  for (let index = Math.min(before, nodes.length - 1); index >= 0; index--) {
    const node = nodes[index]
    if (node.kind === "raster") return node
    const child = rasterLayers(node.children).at(-1)
    if (child) return child
  }
}

export function removeLayer(doc: PaintDocument, id: string): LayerNode {
  const found = requireNode(doc, id)
  if (rasterLayers(doc.layers).length - rasterLayers([found.node]).length < 1)
    throw new Error("A document must keep at least one layer.")
  found.siblings.splice(found.index, 1)
  if (
    rasterLayers([found.node]).some((layer) => layer.id === doc.activeLayerId)
  ) {
    const replacement =
      nearestRaster(found.siblings, found.index - 1) ??
      nearestRaster(found.siblings, found.index) ??
      rasterLayers(doc.layers)[0]
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
  parentId?: string
): void {
  const source = requireNode(doc, id)
  const destination = parentId
    ? (() => {
        const parent = findNode(doc, parentId)
        if (parent.kind !== "group")
          throw new Error(`${parentId} is not a group.`)
        return parent.children
      })()
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
    if (node.kind !== "raster") throw new Error("Groups cannot be locked.")
    node.locked = patch.locked
  }
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
    return node.kind === "raster"
      ? { ...node, mask, surface: createTiledLayer({ width, height }) }
      : { ...node, mask, children: node.children.map(resize) }
  }
  doc.layers = doc.layers.map(resize)
  seedScene(rasterLayers(doc.layers)[0].surface)
}

const contributes = (node: LayerNode) => node.visible && node.opacity > 0

function item(node: LayerNode): CompositeItem {
  return {
    id: node.id,
    ...(node.kind === "group" ? { kind: "group" as const } : {}),
    opacity: node.visible ? node.opacity : 0,
    blend: node.blend,
    clip: node.clip,
    ...(node.mask?.enabled ? { maskId: node.mask.id } : {}),
    ...(node.kind === "group"
      ? { children: node.children.filter(contributes).map(item) }
      : {}),
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

export function planComposite(doc: PaintDocument): CompositePlan {
  const path = pathTo(doc.layers, doc.activeLayerId)
  if (!path)
    throw new Error(`No layer ${doc.activeLayerId} is in this document.`)
  const stages: CompositeStage[] = []
  let siblings = path.siblings
  let index = path.index
  const innerToOuter = [...path.groups].reverse()
  for (const container of innerToOuter) {
    stages.push({
      below: siblings.slice(0, index).filter(contributes).map(item),
      above: siblings
        .slice(index + 1)
        .filter(contributes)
        .map(item),
      container: item({ ...container, children: [] }),
    })
    const parent = requireNode(doc, container.id)
    siblings = parent.siblings
    index = parent.index
  }
  stages.push({
    below: siblings.slice(0, index).filter(contributes).map(item),
    above: siblings
      .slice(index + 1)
      .filter(contributes)
      .map(item),
    container: null,
  })
  const active = findLayer(doc, doc.activeLayerId)
  return {
    below: stages.at(-1)!.below,
    active: item(active),
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
