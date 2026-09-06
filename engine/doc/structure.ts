import {
  findLayer,
  type LayerGroup,
  type LayerNode,
  type PaintDocument,
} from "./document"
import type { BlendMode } from "../shaders/blend-modes"
import { createTiledMask } from "./tiled-mask"
import { createTiledLayer } from "./tiled-layer"

/**
 * The layer tree without its pixels: what an undo entry needs to put the
 * document back the way it was. Pixels travel separately, as tile hashes, so
 * a structure snapshot of a fifty-layer document is a few kilobytes of plain
 * data whatever those layers hold.
 */
export type NodeStructure = {
  id: string
  kind: "raster" | "group"
  name: string
  opacity: number
  visible: boolean
  blend: BlendMode
  clip: boolean
  locked?: boolean
  mask?: { id: string; enabled: boolean }
  children?: NodeStructure[]
}

export type DocumentStructure = {
  layers: NodeStructure[]
  activeLayerId: string
  paintingMask: boolean
}

function captureNode(node: LayerNode): NodeStructure {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    opacity: node.opacity,
    visible: node.visible,
    blend: node.blend,
    clip: node.clip,
    ...(node.kind === "raster" ? { locked: node.locked } : {}),
    ...(node.mask
      ? { mask: { id: node.mask.id, enabled: node.mask.enabled } }
      : {}),
    ...(node.kind === "group"
      ? { children: node.children.map(captureNode) }
      : {}),
  }
}

export function captureStructure(doc: PaintDocument): DocumentStructure {
  return {
    layers: doc.layers.map(captureNode),
    activeLayerId: doc.activeLayerId,
    paintingMask: doc.paintingMask,
  }
}

/** Every surface id a structure mentions: layers first, then their masks. */
export function structureSurfaceIds(structure: DocumentStructure): Set<string> {
  const ids = new Set<string>()
  const walk = (nodes: readonly NodeStructure[]) => {
    for (const node of nodes) {
      if (node.kind === "raster") ids.add(node.id)
      if (node.mask) ids.add(node.mask.id)
      if (node.children) walk(node.children)
    }
  }
  walk(structure.layers)
  return ids
}

function index(nodes: readonly LayerNode[], into: Map<string, LayerNode>) {
  for (const node of nodes) {
    into.set(node.id, node)
    if (node.kind === "group") index(node.children, into)
  }
  return into
}

export function sameStructure(
  a: DocumentStructure,
  b: DocumentStructure
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Puts the tree back. Nodes that still exist are reused rather than rebuilt,
 * so a layer that was only renamed keeps the surface its pixels were uploaded
 * from; a node that was removed comes back empty and has its tiles written
 * back into it by the pixel half of the same undo entry.
 */
export function restoreStructure(
  doc: PaintDocument,
  structure: DocumentStructure
): void {
  const existing = index(doc.layers, new Map())
  const rebuild = (snapshot: NodeStructure): LayerNode => {
    const found = existing.get(snapshot.id)
    const settings = {
      id: snapshot.id,
      name: snapshot.name,
      opacity: snapshot.opacity,
      visible: snapshot.visible,
      blend: snapshot.blend,
      clip: snapshot.clip,
    }
    const mask = snapshot.mask
      ? {
          id: snapshot.mask.id,
          enabled: snapshot.mask.enabled,
          surface:
            found?.mask?.id === snapshot.mask.id
              ? found.mask.surface
              : createTiledMask({ width: doc.width, height: doc.height }),
        }
      : undefined
    if (snapshot.kind === "group") {
      const group: LayerGroup = {
        ...settings,
        kind: "group",
        children: (snapshot.children ?? []).map(rebuild),
      }
      if (mask) group.mask = mask
      return group
    }
    const layer: LayerNode = {
      ...settings,
      kind: "raster",
      locked: snapshot.locked ?? false,
      surface:
        found?.kind === "raster"
          ? found.surface
          : createTiledLayer({ width: doc.width, height: doc.height }),
    }
    if (mask) layer.mask = mask
    return layer
  }
  doc.layers = structure.layers.map(rebuild)
  // Selection is part of what an operation changed, so it is part of what
  // undoing it puts back — but never onto a layer the tree no longer holds.
  doc.activeLayerId = findLayer(doc, structure.activeLayerId).id
  doc.paintingMask =
    structure.paintingMask && !!findLayer(doc, doc.activeLayerId).mask
}
