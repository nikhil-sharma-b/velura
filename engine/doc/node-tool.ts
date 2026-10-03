import { invertMatrix } from "../view/view-transform"
import { applyAffine } from "./transform-session"
import { selectObjects } from "./vector-objects"
import {
  editPathNode,
  nearestPathSegment,
  pickPathNode,
  type BezierPath,
  type NodeEdit,
  type NodePart,
} from "./vector-path"
import type {
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

/** Two presses this close in time and place are a double-click. */
export const DOUBLE_CLICK_MS = 400

/** The node the node tool has in hand, by its path and position on it. */
export type VectorNode = { objectId: string; index: number }

/** A node part taken hold of, with the path as it was when the press began. */
export type NodeGrab = { object: VectorObject; index: number; part: NodePart }

/** A press that may turn out to be the first of a double-click; `time` is
 * the pointer event's timestamp in milliseconds. */
export type NodeClick = { point: Point; time: number }

/**
 * What a node-tool press does. A grab starts a drag; a split has added a
 * node to a path; a select only changes which path, if any, is edited.
 * `lastClick` is handed back on the next press to spot a double-click; a
 * grab keeps the one it was given, so grabbing a node between two clicks
 * never makes them a double-click it was not.
 */
export type NodePress =
  | {
      kind: "grab"
      grab: NodeGrab
      /** Where the grabbed part sits, in document coordinates. */
      at: Point
      selection: string[]
      vectorNode: VectorNode
      lastClick: NodeClick | undefined
    }
  | {
      kind: "split"
      objectId: string
      geometry: BezierPath
      selection: string[]
      vectorNode: VectorNode
      lastClick: NodeClick
    }
  | {
      kind: "select"
      selection: string[]
      vectorNode: null
      lastClick: NodeClick
    }

const isPath = (
  o: VectorObject
): o is VectorObject & { geometry: BezierPath } => o.geometry.kind === "path"

/** Works out what a press of the node tool at `point` on `scene` does. */
export function pressNode({
  scene,
  selection,
  point,
  reach,
  time,
  lastClick,
}: {
  scene: VectorScene
  /** The ids of the paths being edited. */
  selection: readonly string[]
  /** Document coordinates. */
  point: Point
  /** How near, in document units, a press must be to take hold. */
  reach: number
  time: number
  lastClick?: NodeClick
}): NodePress {
  const paths = scene.objects.filter(isPath)
  // Selected paths first, top down, then the rest: a node of what is
  // being edited wins over one beneath it. Only a selected path shows its
  // handles, so only a selected path's handles can be taken hold of.
  const selected = (o: VectorObject) => selection.includes(o.id)
  const order = [
    ...paths.filter(selected).reverse(),
    ...paths.filter((o) => !selected(o)).reverse(),
  ]
  for (const object of order) {
    const picked = pickPathNode(
      object.geometry,
      point,
      object.transform,
      reach,
      { handles: selected(object) }
    )
    if (!picked) continue
    const { index, part, at } = picked
    // Taking hold of a node of another path makes that path the one being
    // edited, in the same press.
    return {
      kind: "grab",
      grab: { object, index, part },
      at,
      selection: selected(object) ? [...selection] : [object.id],
      vectorNode: { objectId: object.id, index },
      lastClick,
    }
  }
  const click = { point, time }
  const hit = [...paths]
    .reverse()
    .map((object) => ({
      object,
      hit: nearestPathSegment(object.geometry, point, object.transform),
    }))
    .find((entry) => entry.hit && entry.hit.distance <= reach)
  if (hit?.hit) {
    const doubleClick =
      lastClick &&
      time - lastClick.time < DOUBLE_CLICK_MS &&
      Math.hypot(point.x - lastClick.point.x, point.y - lastClick.point.y) <=
        reach
    if (doubleClick)
      return {
        kind: "split",
        objectId: hit.object.id,
        geometry: editPathNode(hit.object.geometry, {
          type: "split",
          index: hit.hit.index,
          t: hit.hit.t,
        }),
        selection: [hit.object.id],
        vectorNode: { objectId: hit.object.id, index: hit.hit.index + 1 },
        lastClick: click,
      }
    return {
      kind: "select",
      selection: [hit.object.id],
      vectorNode: null,
      lastClick: click,
    }
  }
  // Inside a filled path is on it too, as with the object tool.
  const [inside] = selectObjects(scene, point).filter((id) =>
    paths.some((o) => o.id === id)
  )
  return {
    kind: "select",
    selection: inside ? [inside] : [],
    vectorNode: null,
    lastClick: click,
  }
}

/**
 * The grabbed path with its part moved to `point`, in document coordinates;
 * the very object grabbed when the part is still where it was.
 */
export function dragNode(grab: NodeGrab, point: Point): VectorObject {
  const { object, index, part } = grab
  if (!isPath(object)) return object
  const local = applyAffine(invertMatrix(object.transform), point)
  const original = object.geometry.nodes[index]
  const at = part === "anchor" ? original : original[part]
  if (at && at.x === local.x && at.y === local.y) return object
  return {
    ...object,
    geometry: editPathNode(object.geometry, {
      type: "move",
      index,
      part,
      point: local,
    }),
  }
}

/** The scene edit a drag ends in: none when the node never moved. */
export function releaseNode(grab: NodeGrab, point: Point): SceneCommand[] {
  const moved = dragNode(grab, point)
  return moved === grab.object
    ? []
    : [{ type: "update", id: moved.id, patch: { geometry: moved.geometry } }]
}

/**
 * A path's geometry after `edit`, with the node to keep in hand: the one
 * a split added, or the one now at the edited index.
 */
export function editNode(
  scene: VectorScene,
  objectId: string,
  edit: NodeEdit
): { geometry: BezierPath; vectorNode: VectorNode } {
  const object = scene.objects.find((o) => o.id === objectId)
  if (!object || !isPath(object)) throw new Error("Select an editable path.")
  const geometry = editPathNode(object.geometry, edit)
  return {
    geometry,
    vectorNode: {
      objectId,
      index: Math.min(
        edit.type === "split" ? edit.index + 1 : edit.index,
        geometry.nodes.length - 1
      ),
    },
  }
}

/**
 * The path geometry after toggling or deleting the node in hand, with the
 * node to keep in hand after; null when there is nothing to do, as when a
 * delete would leave fewer than two anchors.
 */
export function nodeCommand(
  scene: VectorScene,
  node: VectorNode | null,
  type: "toggle" | "delete"
): {
  objectId: string
  geometry: BezierPath
  vectorNode: VectorNode | null
} | null {
  if (!node) return null
  const object = scene.objects.find((o) => o.id === node.objectId)
  if (!object || !isPath(object)) return null
  if (type === "delete" && object.geometry.nodes.length <= 2) return null
  return {
    objectId: object.id,
    geometry: editPathNode(object.geometry, { type, index: node.index }),
    vectorNode: type === "delete" ? null : node,
  }
}

/** The node in hand, or null once its path or index is no longer there. */
export function pruneVectorNode(
  paths: readonly VectorObject[],
  node: VectorNode | null
): VectorNode | null {
  if (!node) return null
  return paths.some(
    (o) => o.id === node.objectId && isPath(o) && o.geometry.nodes[node.index]
  )
    ? node
    : null
}
