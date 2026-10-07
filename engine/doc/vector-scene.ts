/**
 * A vector layer's scene graph (19): an ordered list of objects, bottom to
 * top, each a geometry placed by a transform and drawn in a style.
 *
 * Scenes are immutable values. An edit makes a new scene that shares every
 * object it did not touch, which is what makes "has this layer changed since
 * it was last drawn" an identity check, and what lets an undo step hold a
 * diff — the commands that put the scene back — instead of a copy of it.
 */

import { parseVectorBrush, type VectorBrush } from "../brush/vector-brush"
import { NODE_TYPES, type BezierPath, type PathNode } from "./vector-path"
import { parseHex } from "../color/hex"
import type { Affine } from "./transform-session"

/** How overlapping parts of a filled outline decide what is inside. */
export type FillRule = "nonzero" | "evenodd"

/** Colours are authored sRGB hex, the notation the artist can also type. */
export type VectorFill = Readonly<{
  color: string
  /** In [0, 1]. */
  opacity: number
  rule: FillRule
}>

export type LineCap = "butt" | "round" | "square"
export type LineJoin = "miter" | "round" | "bevel"

export type VectorStroke = Readonly<{
  color: string
  opacity: number
  /** In document pixels, before the object's transform scales it. */
  width: number
  cap: LineCap
  join: LineJoin
}>

export type VectorStyle = Readonly<{
  fill: VectorFill | null
  stroke: VectorStroke | null
}>

export type Point = Readonly<{ x: number; y: number }>

/** The shape, in the object's own coordinates; the transform places it. */
export type VectorGeometry =
  | BezierPath
  | Readonly<{
      kind: "rect"
      x: number
      y: number
      width: number
      height: number
    }>
  | Readonly<{
      kind: "ellipse"
      cx: number
      cy: number
      rx: number
      ry: number
    }>
  /** A run of straight segments, closed back to its start or left open. */
  | Readonly<{ kind: "polygon"; points: readonly Point[]; closed: boolean }>

export type VectorObject = Readonly<{
  id: string
  geometry: VectorGeometry
  transform: Affine
  style: VectorStyle
  /** The recipe used for this stroke, independent of the library entry. */
  brush?: Readonly<{ definition: VectorBrush; seed: number }>
  /**
   * An eraser's mark rather than a shape: its paint takes coverage away from
   * the objects under it in the stack, and those above are untouched. Its
   * colour is never seen; its opacity is how much it takes.
   */
  erase?: true
}>

export type VectorScene = Readonly<{ objects: readonly VectorObject[] }>

export const EMPTY_SCENE: VectorScene = Object.freeze({
  objects: Object.freeze([]),
})

export type SceneCommand =
  /** Puts an object in the stack at `index`, on top when absent. */
  | Readonly<{ type: "add"; object: VectorObject; index?: number }>
  | Readonly<{ type: "remove"; id: string }>
  /** Replaces the fields named; the id never changes. */
  | Readonly<{ type: "update"; id: string; patch: ObjectPatch }>
  /** Moves an object to `index` in the stack, counted from the bottom. */
  | Readonly<{ type: "reorder"; id: string; index: number }>

export type ObjectPatch = Partial<Omit<VectorObject, "id">>

/**
 * One layer's part of an undo step: the commands that made the change, and
 * the ones that take it back. A step keeps these instead of the scene before
 * and after, so an edit to one object of thousands costs one object.
 */
export type SceneChange = Readonly<{
  layerId: string
  forward: readonly SceneCommand[]
  inverse: readonly SceneCommand[]
}>

/** More than any drawing needs; a polygon past this is input gone wrong. */
export const MAX_POLYGON_POINTS = 100_000

const finite = (...values: unknown[]) =>
  values.every((value) => typeof value === "number" && Number.isFinite(value))

const unit = (value: unknown) =>
  finite(value) && (value as number) >= 0 && (value as number) <= 1

function checkGeometry(geometry: VectorGeometry): void {
  switch (geometry?.kind) {
    case "rect":
      if (
        !finite(geometry.x, geometry.y, geometry.width, geometry.height) ||
        geometry.width < 0 ||
        geometry.height < 0
      )
        throw new Error("A rectangle needs a finite place and size.")
      return
    case "ellipse":
      if (
        !finite(geometry.cx, geometry.cy, geometry.rx, geometry.ry) ||
        geometry.rx < 0 ||
        geometry.ry < 0
      )
        throw new Error("An ellipse needs a finite centre and radii.")
      return
    case "path":
      if (
        !Array.isArray(geometry.nodes) ||
        geometry.nodes.length < 2 ||
        geometry.nodes.length > MAX_POLYGON_POINTS ||
        typeof geometry.closed !== "boolean" ||
        !geometry.nodes.every(
          (n) =>
            finite(n?.x, n?.y) &&
            NODE_TYPES.includes(n.type) &&
            [n.in, n.out].every((h) => h === null || (h && finite(h.x, h.y))) &&
            (n.width === undefined || (finite(n.width) && n.width >= 0))
        ) ||
        (geometry.nodes.some((n) => n.width !== undefined) &&
          !geometry.nodes.every((n) => n.width !== undefined))
      )
        throw new Error(
          "A path needs finite anchors, handles and consistent widths."
        )
      return
    case "polygon":
      if (
        !Array.isArray(geometry.points) ||
        geometry.points.length < 2 ||
        geometry.points.length > MAX_POLYGON_POINTS ||
        !geometry.points.every((point) => finite(point?.x, point?.y)) ||
        typeof geometry.closed !== "boolean"
      )
        throw new Error("A polygon needs at least two finite points.")
      return
    default:
      throw new Error("That is not a shape a vector layer can hold.")
  }
}

function checkColor(color: unknown, opacity: unknown) {
  if (typeof color !== "string" || !parseHex(color) || !unit(opacity))
    throw new Error("A colour must be hex, with an opacity in [0, 1].")
}

function checkStyle(style: VectorStyle): void {
  if (!style || typeof style !== "object")
    throw new Error("An object needs a style.")
  const { fill, stroke } = style
  if (fill) {
    checkColor(fill.color, fill.opacity)
    if (fill.rule !== "nonzero" && fill.rule !== "evenodd")
      throw new Error("A fill rule is nonzero or evenodd.")
  } else if (fill !== null) throw new Error("A fill is a paint or null.")
  if (stroke) {
    checkColor(stroke.color, stroke.opacity)
    if (!finite(stroke.width) || stroke.width <= 0)
      throw new Error("A stroke needs a positive width.")
    if (!["butt", "round", "square"].includes(stroke.cap))
      throw new Error("A line cap is butt, round or square.")
    if (!["miter", "round", "bevel"].includes(stroke.join))
      throw new Error("A line join is miter, round or bevel.")
  } else if (stroke !== null) throw new Error("A stroke is a paint or null.")
}

function checkTransform(transform: Affine): void {
  if (
    !Array.isArray(transform) ||
    transform.length !== 6 ||
    !finite(...transform)
  )
    throw new Error("A transform is six finite numbers.")
  const [a, b, c, d] = transform
  if (Math.abs(a * d - b * c) < 1e-9)
    throw new Error("A transform must not flatten its object.")
}

/** Throws unless `object` is one a scene can hold and draw. */
export function checkObject(object: VectorObject): void {
  if (!object || typeof object.id !== "string" || object.id === "")
    throw new Error("An object needs an id.")
  if (object.brush !== undefined) {
    parseVectorBrush(object.brush.definition)
    if (
      object.geometry.kind !== "path" ||
      !Number.isInteger(object.brush.seed) ||
      object.brush.seed < 0 ||
      object.brush.seed > 0xffffffff
    )
      throw new Error(
        "A vector brush stroke needs a path and an unsigned jitter seed."
      )
  }
  checkGeometry(object.geometry)
  checkTransform(object.transform)
  checkStyle(object.style)
  if (object.erase !== undefined && object.erase !== true)
    throw new Error("An eraser's mark is marked true or not at all.")
}

/**
 * An object as saved before nodes had types: a path node's `smooth` flag
 * read as a smooth node or a cusp, and not carried on.
 */
function migrateObject(raw: VectorObject): VectorObject {
  const geometry = raw?.geometry
  if (geometry?.kind !== "path" || !Array.isArray(geometry.nodes)) return raw
  const nodes = geometry.nodes.map((node) => {
    // Saved data, not yet checked: the flag may be there with or without a
    // type, and is dropped either way.
    const { smooth, ...rest } = node as PathNode & { smooth?: unknown }
    return rest.type === undefined && typeof smooth === "boolean"
      ? { ...rest, type: smooth ? ("smooth" as const) : ("cusp" as const) }
      : rest
  })
  return { ...raw, geometry: { ...geometry, nodes } }
}

/**
 * A scene read back from a save or a file: checked whole, and copied down to
 * the fields a scene has, so nothing else it carried comes in with it.
 */
export function parseScene(value: unknown): VectorScene {
  const objects = (value as { objects?: unknown })?.objects
  if (!Array.isArray(objects)) throw new Error("A scene is a list of objects.")
  const seen = new Set<string>()
  return {
    objects: objects.map((raw: VectorObject) => {
      const object = migrateObject(raw)
      checkObject(object)
      if (seen.has(object.id))
        throw new Error(`The object ${object.id} appears twice.`)
      seen.add(object.id)
      const { id, geometry, transform, style, erase, brush } = object
      const metadata = brush
        ? {
            brush: {
              definition: parseVectorBrush(brush.definition),
              seed: brush.seed,
            },
          }
        : {}
      return erase
        ? { id, geometry, transform, style, erase, ...metadata }
        : { id, geometry, transform, style, ...metadata }
    }),
  }
}

function indexOf(scene: VectorScene, id: string): number {
  const index = scene.objects.findIndex((object) => object.id === id)
  if (index < 0) throw new Error(`No object ${id} is in this scene.`)
  return index
}

function apply(
  scene: VectorScene,
  command: SceneCommand
): { scene: VectorScene; inverse: SceneCommand } {
  const objects = [...scene.objects]
  switch (command.type) {
    case "add": {
      checkObject(command.object)
      if (objects.some((object) => object.id === command.object.id))
        throw new Error(`An object ${command.object.id} is already here.`)
      const index = command.index ?? objects.length
      if (!Number.isInteger(index) || index < 0 || index > objects.length)
        throw new Error("An object cannot be put outside the stack.")
      objects.splice(index, 0, command.object)
      return {
        scene: { objects },
        inverse: { type: "remove", id: command.object.id },
      }
    }
    case "remove": {
      const index = indexOf(scene, command.id)
      const [object] = objects.splice(index, 1)
      return { scene: { objects }, inverse: { type: "add", object, index } }
    }
    case "update": {
      const index = indexOf(scene, command.id)
      const previous = objects[index]
      const patch: ObjectPatch = {
        ...("brush" in command.patch ? { brush: command.patch.brush } : {}),
        ...(command.patch.geometry ? { geometry: command.patch.geometry } : {}),
        ...(command.patch.transform
          ? { transform: command.patch.transform }
          : {}),
        ...(command.patch.style ? { style: command.patch.style } : {}),
      }
      const undo: ObjectPatch = Object.fromEntries(
        Object.keys(patch).map((key) => [
          key,
          previous[key as keyof ObjectPatch],
        ])
      )
      objects[index] = { ...previous, ...patch }
      checkObject(objects[index])
      return {
        scene: { objects },
        inverse: { type: "update", id: command.id, patch: undo },
      }
    }
    case "reorder": {
      const from = indexOf(scene, command.id)
      if (
        !Number.isInteger(command.index) ||
        command.index < 0 ||
        command.index >= objects.length
      )
        throw new Error("An object cannot move outside the stack.")
      const [object] = objects.splice(from, 1)
      objects.splice(command.index, 0, object)
      return {
        scene: { objects },
        inverse: { type: "reorder", id: command.id, index: from },
      }
    }
  }
}

/**
 * Applies commands in order. The inverse is the commands that put the scene
 * back, already in the order to apply them: it is what an undo step keeps.
 */
export function applySceneEdit(
  scene: VectorScene,
  commands: readonly SceneCommand[]
): { scene: VectorScene; inverse: SceneCommand[] } {
  let current = scene
  const inverse: SceneCommand[] = []
  for (const command of commands) {
    const step = apply(current, command)
    current = step.scene
    inverse.unshift(step.inverse)
  }
  return { scene: current, inverse }
}
