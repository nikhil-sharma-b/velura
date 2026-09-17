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
  image?: boolean
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
    // Only written when set, so structures saved before image layers existed
    // read back unchanged.
    ...(node.kind === "raster" && node.image ? { image: true } : {}),
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

/** A surface as a save names it: enough to tell whether it holds anything. */
type NamedSurface = { surfaceId: string; tiles: readonly unknown[] }

/** Surfaces with pixels that no node in `structure` refers to. */
function strandedSurfaceIds(
  structure: DocumentStructure,
  surfaces: readonly NamedSurface[]
): string[] {
  const named = structureSurfaceIds(structure)
  return surfaces
    .filter((surface) => surface.tiles.length > 0)
    .filter((surface) => !named.has(surface.surfaceId))
    .map((surface) => surface.surfaceId)
}

/**
 * Gives pixels a layer when the tree they were saved with has none for them.
 * Restoring builds surfaces from the tree, so tiles under an id it does not
 * name would load into nothing: the work is on disk and the canvas is blank.
 * Each stranded surface comes back as a plain layer on top, under its own id,
 * where the artist can see it and decide what it was.
 */
export function adoptStrandedSurfaces(
  structure: DocumentStructure,
  surfaces: readonly NamedSurface[]
): DocumentStructure {
  const stranded = strandedSurfaceIds(structure, surfaces)
  if (stranded.length === 0) return structure
  return {
    ...structure,
    layers: [
      ...structure.layers,
      ...stranded.map((id): NodeStructure => ({
        id,
        kind: "raster",
        name: "Recovered layer",
        opacity: 1,
        visible: true,
        blend: "normal",
        clip: false,
        locked: false,
      })),
    ],
  }
}

function isDevelopment(): boolean {
  // Next inlines this literal into its bundles. A page with no `process` at
  // all is the test harness, which is development.
  try {
    return process.env.NODE_ENV !== "production"
  } catch {
    return true
  }
}

/**
 * The tree a save may write alongside `surfaces`. Pixels the tree does not
 * name mean history and the document disagree, which is a bug to hear about
 * while developing rather than on an artist's next open; in production the
 * save goes ahead with those pixels given a layer, so they are never lost.
 */
export function savedStructure(
  structure: DocumentStructure,
  surfaces: readonly NamedSurface[]
): DocumentStructure {
  const stranded = strandedSurfaceIds(structure, surfaces)
  if (stranded.length > 0 && isDevelopment())
    throw new Error(
      `Saving pixels for ${stranded.join(", ")}, which no layer in the saved structure refers to.`
    )
  return adoptStrandedSurfaces(structure, surfaces)
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
      image: snapshot.image ?? false,
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
