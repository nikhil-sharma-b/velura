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
  type NodeType,
} from "./vector-path"
import type {
  Point,
  SceneCommand,
  VectorObject,
  VectorScene,
} from "./vector-scene"

/** Two presses this close in time and place are a double-click. */
export const DOUBLE_CLICK_MS = 400

/** A node of a path, by the path's id and the node's place along it. */
export type VectorNode = { objectId: string; index: number }

/** A node part taken hold of, with the path as it was when the press began. */
export type NodeGrab = { object: VectorObject; index: number; part: NodePart }

/** A press that may turn out to be the first of a double-click; `time` is
 * the pointer event's timestamp in milliseconds. */
export type NodeClick = { point: Point; time: number }

/** A rubber band, in document coordinates. */
export type NodeBox = { x: number; y: number; width: number; height: number }

/**
 * What a node-tool press does. A grab starts a drag; a split has added a
 * node to a path; a select only changes which paths are edited and which of
 * their nodes are selected; a box starts a rubber band on empty canvas.
 * `lastClick` is handed back on the next press to spot a double-click; a
 * grab keeps the one it was given, so grabbing a node between two clicks
 * never makes them a double-click it was not.
 */
export type NodePress = {
  selection: string[]
  nodes: VectorNode[]
} & (
  | {
      kind: "grab"
      grab: NodeGrab
      /** Where the grabbed part sits, in document coordinates. */
      at: Point
      lastClick: NodeClick | undefined
    }
  | {
      kind: "split"
      objectId: string
      geometry: BezierPath
      lastClick: NodeClick
    }
  | { kind: "select" | "box"; lastClick: NodeClick }
)

const same = (a: VectorNode, b: VectorNode) =>
  a.objectId === b.objectId && a.index === b.index

const isPath = (
  o: VectorObject
): o is VectorObject & { geometry: BezierPath } => o.geometry.kind === "path"

/** Works out what a press of the node tool at `point` on `scene` does. */
export function pressNode({
  scene,
  selection,
  nodes,
  shift,
  point,
  reach,
  time,
  lastClick,
}: {
  scene: VectorScene
  /** The ids of the paths being edited. */
  selection: readonly string[]
  /** The nodes selected on them. */
  nodes: readonly VectorNode[]
  /** Shift adds to, or takes from, the selection rather than replacing it. */
  shift: boolean
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
      {
        handles: selected(object) && ((i) => handlesShown(object, i, nodes)),
      }
    )
    if (!picked) continue
    const { index, part, at } = picked
    const picks = { objectId: object.id, index }
    const held = nodes.some((n) => same(n, picks))
    // Taking hold of a node of another path makes that path the one being
    // edited, in the same press; with Shift, one more being edited.
    const paths = selected(object)
      ? [...selection]
      : shift
        ? [...selection, object.id]
        : [object.id]
    if (shift && part === "anchor")
      return {
        kind: "select",
        selection: paths,
        nodes: held ? nodes.filter((n) => !same(n, picks)) : [...nodes, picks],
        lastClick: { point, time },
      }
    return {
      kind: "grab",
      grab: { object, index, part },
      at,
      selection: paths,
      // A handle belongs to a node already selected or beside one; taking
      // it leaves the selection be. An anchor not yet selected is the
      // selection from now on, so a drag moves only what it was pressed on.
      nodes: part !== "anchor" || held ? [...nodes] : [picks],
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
        nodes: [{ objectId: hit.object.id, index: hit.hit.index + 1 }],
        lastClick: click,
      }
    return shift
      ? {
          kind: "select",
          selection: [...new Set([...selection, hit.object.id])],
          nodes: [...nodes],
          lastClick: click,
        }
      : {
          kind: "select",
          selection: [hit.object.id],
          nodes: [],
          lastClick: click,
        }
  }
  // Inside a filled path is on it too, as with the object tool.
  const [inside] = selectObjects(scene, point).filter((id) =>
    paths.some((o) => o.id === id)
  )
  if (inside)
    return shift
      ? {
          kind: "select",
          selection: [...new Set([...selection, inside])],
          nodes: [...nodes],
          lastClick: click,
        }
      : { kind: "select", selection: [inside], nodes: [], lastClick: click }
  return {
    kind: "box",
    selection: [...selection],
    nodes: [...nodes],
    lastClick: click,
  }
}

/** Where a node sits in document coordinates. */
const placed = (object: VectorObject, p: Point): Point => {
  const [a, b, c, d, e, f] = object.transform
  return { x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f }
}

/**
 * The nodes of the edited `paths` inside `box`, after those already selected
 * when `add` (Shift) is held.
 */
export function boxNodes(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[],
  box: NodeBox,
  add: boolean
): VectorNode[] {
  const inside = paths.filter(isPath).flatMap((object) =>
    object.geometry.nodes.flatMap((n, index) => {
      const at = placed(object, n)
      return at.x >= box.x &&
        at.x <= box.x + box.width &&
        at.y >= box.y &&
        at.y <= box.y + box.height
        ? [{ objectId: object.id, index }]
        : []
    })
  )
  if (!add) return inside
  return [...nodes, ...inside.filter((n) => !nodes.some((m) => same(m, n)))]
}

/** Every node of every edited path. */
export function allNodes(paths: readonly VectorObject[]): VectorNode[] {
  return paths
    .filter(isPath)
    .flatMap((object) =>
      object.geometry.nodes.map((_, index) => ({ objectId: object.id, index }))
    )
}

/**
 * The one node after (`1`) or before (`-1`) the last selected, going on to
 * the next path at a path's end and round again; with none selected, the
 * first or last of them all.
 */
export function stepNode(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[],
  direction: 1 | -1
): VectorNode[] {
  const every = allNodes(paths)
  if (!every.length) return []
  const from = nodes.at(-1)
  const at = from ? every.findIndex((n) => same(n, from)) : -1
  if (at < 0) return [direction === 1 ? every[0] : every.at(-1)!]
  return [every[(at + direction + every.length) % every.length]]
}

/**
 * Whether node `index` of `object` shows its handles: Inkscape shows them
 * for selected nodes and their neighbours, as the ones about to be bent.
 */
export function handlesShown(
  object: VectorObject,
  index: number,
  nodes: readonly VectorNode[]
): boolean {
  if (!isPath(object)) return false
  const { closed, nodes: all } = object.geometry
  const count = all.length
  return nodes.some((n) => {
    if (n.objectId !== object.id) return false
    const apart = Math.abs(n.index - index)
    return apart <= 1 || (closed && apart === count - 1)
  })
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

/**
 * The scene edits of moving `nodes` by `offset`, in document coordinates,
 * each with its handles: one update per path they are on, none for no move.
 */
export function moveNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  offset: Point
): SceneCommand[] {
  if (offset.x === 0 && offset.y === 0) return []
  return scene.objects.filter(isPath).flatMap((object): SceneCommand[] => {
    const indices = nodes
      .filter((n) => n.objectId === object.id && object.geometry.nodes[n.index])
      .map((n) => n.index)
    if (!indices.length) return []
    // The offset as the path's own coordinates see it: its transform's
    // linear part undone, the translation having nothing to say about a move.
    const [a, b, c, d] = invertMatrix(object.transform)
    const dx = a * offset.x + c * offset.y,
      dy = b * offset.x + d * offset.y
    const geometry = [...new Set(indices)].reduce((path, index) => {
      const n = path.nodes[index]
      return editPathNode(path, {
        type: "move",
        index,
        part: "anchor",
        point: { x: n.x + dx, y: n.y + dy },
      })
    }, object.geometry)
    return [{ type: "update", id: object.id, patch: { geometry } }]
  })
}

/**
 * The scene edits a node-tool drag to `point` makes of `scene` as it was
 * when the press began. A grabbed anchor carries every selected node by its
 * own offset; a grabbed handle bends only its node. None when nothing moved.
 */
export function dragNodes({
  scene,
  grab,
  nodes,
  point,
}: {
  scene: VectorScene
  grab: NodeGrab
  nodes: readonly VectorNode[]
  /** Where the grabbed part is now, in document coordinates. */
  point: Point
}): SceneCommand[] {
  const { object, index, part } = grab
  if (!isPath(object)) return []
  if (part !== "anchor") {
    const moved = dragNode(grab, point)
    return moved === object
      ? []
      : [{ type: "update", id: moved.id, patch: { geometry: moved.geometry } }]
  }
  const from = placed(object, object.geometry.nodes[index])
  const held = { objectId: object.id, index }
  return moveNodes(scene, nodes.some((n) => same(n, held)) ? nodes : [held], {
    x: point.x - from.x,
    y: point.y - from.y,
  })
}

/**
 * `to` held to the horizontal or the vertical through `from`, whichever it
 * has moved further along.
 */
export function lockAxis(from: Point, to: Point): Point {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y }
}

/**
 * A path's geometry after `edit`, with the node to keep in hand: the one
 * a split added, or the one now at the edited index.
 */
export function editNode(
  scene: VectorScene,
  objectId: string,
  edit: NodeEdit
): { geometry: BezierPath; node: VectorNode } {
  const object = scene.objects.find((o) => o.id === objectId)
  if (!object || !isPath(object)) throw new Error("Select an editable path.")
  const geometry = editPathNode(object.geometry, edit)
  return {
    geometry,
    node: {
      objectId,
      index: Math.min(
        edit.type === "split" ? edit.index + 1 : edit.index,
        geometry.nodes.length - 1
      ),
    },
  }
}

/**
 * The scene edits of giving every selected node a type, or deleting it, with the
 * nodes to keep selected after; null when there is nothing to do. A path a
 * delete would leave with fewer than two anchors is left as it is.
 */
export function nodeCommand(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  type: NodeType | "delete"
): { edits: SceneCommand[]; nodes: VectorNode[] } | null {
  const edits: SceneCommand[] = []
  const edited = new Set<string>()
  for (const object of scene.objects) {
    if (!isPath(object)) continue
    // Deleting from the end first keeps the earlier indices where they are.
    const indices = nodes
      .filter((n) => n.objectId === object.id && object.geometry.nodes[n.index])
      .map((n) => n.index)
      .sort((a, b) => b - a)
    if (!indices.length) continue
    if (type === "delete" && object.geometry.nodes.length - indices.length < 2)
      continue
    const geometry = indices.reduce(
      (path, index) =>
        editPathNode(
          path,
          type === "delete"
            ? { type, index }
            : { type: "retype", index, nodeType: type }
        ),
      object.geometry
    )
    edits.push({ type: "update", id: object.id, patch: { geometry } })
    edited.add(object.id)
  }
  if (!edits.length) return null
  // A deleted node is gone; one on a path the delete left alone stays.
  return {
    edits,
    nodes:
      type === "delete"
        ? nodes.filter((n) => !edited.has(n.objectId))
        : [...nodes],
  }
}

/**
 * The selected nodes whose path and index are still there. A path that
 * gained or lost nodes since `before` lets go of its nodes: an index would
 * now name a different node, and a selection must not slide onto it.
 */
export function pruneNodes(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[],
  before: readonly VectorObject[] = paths
): readonly VectorNode[] {
  const count = (o: VectorObject | undefined) =>
    o && isPath(o) ? o.geometry.nodes.length : -1
  const kept = nodes.filter((n) => {
    const now = paths.find((o) => o.id === n.objectId)
    const was = before.find((o) => o.id === n.objectId)
    return count(now) > n.index && (!was || count(was) === count(now))
  })
  return kept.length === nodes.length ? nodes : kept
}
