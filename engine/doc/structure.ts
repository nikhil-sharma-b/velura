import {
  findLayer,
  type LayerGroup,
  type LayerNode,
  type PaintDocument,
} from "./document"
import { normaliseGuides, type Guide } from "./guides"
import type { BlendMode } from "../shaders/blend-modes"
import type { ImageAssetRef, PlacedImage } from "./image-source"
import { createTiledMask } from "./tiled-mask"
import { createTiledLayer } from "./tiled-layer"
import { EMPTY_SCENE, parseScene, type VectorScene } from "./vector-scene"

/**
 * The layer tree without its pixels: what an undo entry needs to put the
 * document back the way it was. Pixels travel separately, as tile hashes, so
 * a structure snapshot of a fifty-layer document is a few kilobytes of plain
 * data whatever those layers hold.
 */
export type NodeStructure = {
  id: string
  kind: "raster" | "vector" | "group"
  name: string
  opacity: number
  visible: boolean
  blend: BlendMode
  clip: boolean
  locked?: boolean
  image?: boolean
  /**
   * The original a placed image was made from and where it sits (06). Part of
   * the tree rather than of the pixels, which is what makes a transform one
   * undo step that puts the previous *placement* back rather than the
   * previous pixels, and what carries the picture through a save.
   */
  placed?: PlacedImage
  mask?: { id: string; enabled: boolean }
  children?: NodeStructure[]
  /**
   * A vector layer's objects (19), in a save only. Undo carries a scene's
   * edits rather than copies of it, so the tree an undo step compares and
   * keeps leaves the scene out; a save has to write it, because it is the
   * whole of what the layer holds.
   */
  scene?: VectorScene
}

export type DocumentStructure = {
  layers: NodeStructure[]
  activeLayerId: string
  paintingMask: boolean
  /**
   * The guides (16). Only written when there are some, so a tree saved before
   * guides existed and one with none compare the same.
   */
  guides?: Guide[]
  /**
   * Which selection (07) the step left, by the key the engine holds its mask
   * under; null for none. Only a selection step names one — absent, undoing
   * the step leaves the selection as it is. Never saved: a selection is part
   * of the session, not of the artwork.
   */
  selection?: string | null
}

function captureNode(node: LayerNode, scenes: boolean): NodeStructure {
  return {
    id: node.id,
    kind: node.kind,
    name: node.name,
    opacity: node.opacity,
    visible: node.visible,
    blend: node.blend,
    clip: node.clip,
    ...(node.kind !== "group" ? { locked: node.locked } : {}),
    // Only written when set, so structures saved before image layers existed
    // read back unchanged.
    ...(node.kind === "raster" && node.image ? { image: true } : {}),
    ...(node.kind === "raster" && node.placed ? { placed: node.placed } : {}),
    ...(node.mask
      ? { mask: { id: node.mask.id, enabled: node.mask.enabled } }
      : {}),
    ...(node.kind === "vector" && scenes ? { scene: node.scene } : {}),
    ...(node.kind === "group"
      ? { children: node.children.map((child) => captureNode(child, scenes)) }
      : {}),
  }
}

/**
 * The tree as it stands. `scenes` writes vector layers' objects into it, for
 * a save; undo leaves them out (see `NodeStructure.scene`).
 */
export function captureStructure(
  doc: PaintDocument,
  options: { scenes?: boolean } = {}
): DocumentStructure {
  return {
    layers: doc.layers.map((node) => captureNode(node, !!options.scenes)),
    activeLayerId: doc.activeLayerId,
    paintingMask: doc.paintingMask,
    ...(doc.guides.length ? { guides: [...doc.guides] } : {}),
  }
}

/**
 * A saved tree with every vector layer's scene checked and copied clean.
 * Throws on one that cannot be read: a document whose shapes did not come
 * back must not be opened as if it had none, and then saved over.
 */
export function parseSavedScenes(
  structure: DocumentStructure
): DocumentStructure {
  const parse = (nodes: readonly NodeStructure[]): NodeStructure[] =>
    nodes.map((node) => {
      if (node.children) return { ...node, children: parse(node.children) }
      if (node.kind !== "vector") return node
      try {
        return { ...node, scene: parseScene(node.scene ?? EMPTY_SCENE) }
      } catch (error) {
        throw new Error(
          `Vector layer ${node.id} is unreadable: ${(error as Error).message}`
        )
      }
    })
  return { ...structure, layers: parse(structure.layers) }
}

/** Every surface id a structure mentions: layers first, then their masks. */
export function structureSurfaceIds(structure: DocumentStructure): Set<string> {
  const ids = new Set<string>()
  const walk = (nodes: readonly NodeStructure[]) => {
    for (const node of nodes) {
      if (node.kind !== "group") ids.add(node.id)
      if (node.mask) ids.add(node.mask.id)
      if (node.children) walk(node.children)
    }
  }
  walk(structure.layers)
  return ids
}

/**
 * Every original the tree names, once each (06). A manifest is written from
 * this, so a document carries exactly the pictures its layers can still be
 * re-rendered from — a layer converted to paint has let go of its original,
 * and the blob stops being written with the next save.
 */
export function structureAssets(structure: DocumentStructure): ImageAssetRef[] {
  const found = new Map<string, ImageAssetRef>()
  const walk = (nodes: readonly NodeStructure[]) => {
    for (const node of nodes) {
      if (node.placed) found.set(node.placed.asset.id, node.placed.asset)
      if (node.children) walk(node.children)
    }
  }
  walk(structure.layers)
  return [...found.values()]
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
    if (snapshot.kind === "vector") {
      // A saved tree carries the scene; an undo step's does not, and the
      // scene's own edits are put back after it (see `NodeStructure.scene`).
      const layer: LayerNode = {
        ...settings,
        kind: "vector",
        locked: snapshot.locked ?? false,
        scene:
          snapshot.scene ??
          (found?.kind === "vector" ? found.scene : EMPTY_SCENE),
      }
      if (mask) layer.mask = mask
      return layer
    }
    const layer: LayerNode = {
      ...settings,
      kind: "raster",
      locked: snapshot.locked ?? false,
      image: snapshot.image ?? false,
      ...(snapshot.placed ? { placed: snapshot.placed } : {}),
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
  // A saved tree came from outside, so its guides are checked on the way in.
  doc.guides = normaliseGuides(structure.guides)
}
