import { invertMatrix } from "../view/view-transform"
import { applyAffine } from "./transform-session"
import { selectObjects } from "./vector-objects"
import {
  breakPath,
  cutPathSegments,
  joinPathEnds,
  type JoinMode,
  type PathEnd,
  deletePathNodes,
  editPathNode,
  handleOf,
  nearestPathSegment,
  pickPathNode,
  replacePathNodes,
  segmentPoint,
  type BezierPath,
  type NodeEdit,
  type NodePart,
  type NodeType,
  type SegmentShape,
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

/**
 * A node part taken hold of, with the path as it was when the press began;
 * or segment `index`, held at `t` along it, to bend.
 */
export type NodeGrab =
  | { object: VectorObject; index: number; part: NodePart }
  | { object: VectorObject; index: number; part: "segment"; t: number }

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

/** Whether a grabbed part is one of a node's handles. */
export const isHandle = (part: NodeGrab["part"]): part is "in" | "out" =>
  part === "in" || part === "out"

const same = (a: VectorNode, b: VectorNode) =>
  a.objectId === b.objectId && a.index === b.index

type PathObject = VectorObject & { geometry: BezierPath }

const isPath = (o: VectorObject): o is PathObject => o.geometry.kind === "path"

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
    // Shift+drag on an anchor with no handle pulls one out of it; an open
    // path's last node can only have the one coming in. A click without a
    // drag still toggles it, as the press already has.
    if (shift && part === "anchor") {
      const node = object.geometry.nodes[index]
      const onlyIn =
        !object.geometry.closed && index === object.geometry.nodes.length - 1
      const toggled = {
        selection: paths,
        nodes: held ? nodes.filter((n) => !same(n, picks)) : [...nodes, picks],
        lastClick: { point, time },
      }
      return handleOf(node, node.in) || handleOf(node, node.out)
        ? { kind: "select", ...toggled }
        : {
            kind: "grab",
            grab: { object, index, part: onlyIn ? "in" : "out" },
            at,
            ...toggled,
          }
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
    // A press on a segment takes hold of it to bend, and selects its two
    // end nodes, as a click without a drag leaves them.
    const { index, t } = hit.hit
    const count = hit.object.geometry.nodes.length
    const ends = [index, (index + 1) % count].map((i) => ({
      objectId: hit.object.id,
      index: i,
    }))
    return {
      kind: "grab",
      grab: { object: hit.object, index, part: "segment", t },
      at: placed(hit.object, segmentPoint(hit.object.geometry, index, t)),
      selection: shift
        ? [...new Set([...selection, hit.object.id])]
        : [hit.object.id],
      nodes: shift
        ? [...nodes, ...ends.filter((e) => !nodes.some((n) => same(n, e)))]
        : ends,
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
export function dragNode(
  grab: NodeGrab,
  point: Point,
  modifiers: HandleModifiers = {}
): VectorObject {
  const { object, index, part } = grab
  if (!isPath(object)) return object
  if (isHandle(part)) {
    const n = object.geometry.nodes[index]
    point = constrainHandle(
      placed(object, n),
      n[part] && placed(object, n[part]),
      point,
      modifiers
    )
  }
  const local = applyAffine(invertMatrix(object.transform), point)
  if (part === "segment") {
    const was = segmentPoint(object.geometry, index, grab.t)
    if (was.x === local.x && was.y === local.y) return object
    return {
      ...object,
      geometry: editPathNode(object.geometry, {
        type: "bend",
        index,
        t: grab.t,
        point: local,
      }),
    }
  }
  const original = object.geometry.nodes[index]
  const at = part === "anchor" ? original : original[part]
  if (at && at.x === local.x && at.y === local.y) return object
  const geometry = editPathNode(object.geometry, {
    type: "move",
    index,
    part,
    point: local,
  })
  if (!modifiers.shift || part === "anchor" || original.type !== "cusp")
    return { ...object, geometry }
  // Shift mirrors a cusp's other handle for this drag, if it has one.
  const opposite = part === "in" ? "out" : "in"
  if (!handleOf(original, original[opposite])) return { ...object, geometry }
  const nodes = [...geometry.nodes]
  nodes[index] = {
    ...nodes[index],
    [opposite]: { x: 2 * original.x - local.x, y: 2 * original.y - local.y },
  }
  return { ...object, geometry: { ...geometry, nodes } }
}

/** The modifiers held through a handle drag. */
export type HandleModifiers = { ctrl?: boolean; alt?: boolean; shift?: boolean }

/** Ctrl's angle steps, as Inkscape's default rotation snap. */
const ANGLE_STEP = Math.PI / 12

/**
 * Where a handle of the anchor at `anchor`, once at `was`, goes when put at
 * `point`: Ctrl turns it to the nearest 15° step, Alt keeps the length it
 * had and only turns it. All in document coordinates.
 */
export function constrainHandle(
  anchor: Point,
  was: Point | null,
  point: Point,
  { ctrl = false, alt = false }: HandleModifiers
): Point {
  const dx = point.x - anchor.x,
    dy = point.y - anchor.y
  const before = was ? Math.hypot(was.x - anchor.x, was.y - anchor.y) : 0
  const reach = alt && before > 0 ? before : Math.hypot(dx, dy)
  if (!reach || (!ctrl && !(alt && before > 0))) return point
  let angle = Math.atan2(dy, dx)
  if (ctrl) angle = Math.round(angle / ANGLE_STEP) * ANGLE_STEP
  return {
    x: anchor.x + reach * Math.cos(angle),
    y: anchor.y + reach * Math.sin(angle),
  }
}

/**
 * The scene edit of laying a grabbed handle back on its anchor (Ctrl+click);
 * none for an anchor or a handle already there. An auto node becomes a
 * cusp, as it would only pull the handle out again.
 */
export function retractHandle(grab: NodeGrab): SceneCommand[] {
  const { object, index, part } = grab
  if (!isPath(object) || !isHandle(part)) return []
  const n = object.geometry.nodes[index]
  if (!n[part]) return []
  const nodes = [...object.geometry.nodes]
  nodes[index] = {
    ...n,
    [part]: null,
    type: n.type === "auto" ? "cusp" : n.type,
  }
  return [
    {
      type: "update",
      id: object.id,
      patch: { geometry: { ...object.geometry, nodes } },
    },
  ]
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
 * A step of Inkscape's node transforms: a scale growing the selection's
 * bounds by `by` document px each side, a turn by `angle` radians
 * (clockwise on an unflipped view) or by an `arc` of document px at the selection's
 * radius, or a flip across its centre.
 */
export type NodeTransform =
  | { kind: "scale"; by: number }
  | { kind: "rotate"; angle: number }
  | { kind: "rotate"; arc: number }
  | { kind: "flip"; axis: "horizontal" | "vertical" }

/**
 * The scene edits of transforming the selected nodes on the canvas about
 * the centre of their bounds, handles going with their anchors. One node
 * alone stays put: its handles scale, turn or flip about it instead. None
 * when there is nothing to transform.
 */
export function transformNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  transform: NodeTransform
): SceneCommand[] {
  const held = scene.objects
    .filter(isPath)
    .flatMap((object) =>
      [
        ...new Set(
          nodes.filter((n) => n.objectId === object.id).map((n) => n.index)
        ),
      ]
        .filter((index) => object.geometry.nodes[index])
        .map((index) => ({ object, index }))
    )
  if (!held.length) return []
  const onCanvas = held.map(({ object, index }) =>
    applyAffine(object.transform, object.geometry.nodes[index])
  )
  const xs = onCanvas.map((p) => p.x),
    ys = onCanvas.map((p) => p.y)
  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
  const lone = held.length === 1
  // How far the selection reaches from its centre: the bounds' half size
  // for a scale, its farthest node for an arc. One node reaches as far as
  // its longest handle.
  const handleReach = () => {
    const { object, index } = held[0]
    const n = object.geometry.nodes[index]
    return Math.max(
      0,
      ...[n.in, n.out].map((h) => {
        const p = h && handleOf(n, h) && applyAffine(object.transform, h)
        return p ? Math.hypot(p.x - centre.x, p.y - centre.y) : 0
      })
    )
  }
  let map: (p: Point) => Point
  if (transform.kind === "flip") {
    const h = transform.axis === "horizontal"
    map = (p) => ({
      x: h ? 2 * centre.x - p.x : p.x,
      y: h ? p.y : 2 * centre.y - p.y,
    })
  } else if (transform.kind === "rotate") {
    const reach = lone
      ? handleReach()
      : Math.max(
          ...onCanvas.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))
        )
    const angle = "angle" in transform ? transform.angle : transform.arc / reach
    if (!Number.isFinite(angle) || angle === 0) return []
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    map = (p) => {
      const dx = p.x - centre.x,
        dy = p.y - centre.y
      return {
        x: centre.x + dx * cos - dy * sin,
        y: centre.y + dx * sin + dy * cos,
      }
    }
  } else if (lone) {
    // Each handle grows by the step, a shrink stopping at its anchor.
    map = (p) => {
      const dx = p.x - centre.x,
        dy = p.y - centre.y,
        length = Math.hypot(dx, dy)
      if (!length) return p
      const k = Math.max(0, length + transform.by) / length
      return { x: centre.x + dx * k, y: centre.y + dy * k }
    }
  } else {
    const half =
      Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys)
      ) / 2
    const k = (half + transform.by) / half
    if (!(half > 0 && k > 0)) return []
    map = (p) => ({
      x: centre.x + (p.x - centre.x) * k,
      y: centre.y + (p.y - centre.y) * k,
    })
  }
  return scene.objects.filter(isPath).flatMap((object): SceneCommand[] => {
    const indices = held.filter((h) => h.object === object).map((h) => h.index)
    if (!indices.length) return []
    const back = invertMatrix(object.transform)
    const moved = (p: Point) =>
      applyAffine(back, map(applyAffine(object.transform, p)))
    const changes = new Map(
      indices.map((index) => {
        const n = object.geometry.nodes[index]
        const anchor = lone ? { x: n.x, y: n.y } : moved(n)
        return [
          index,
          {
            ...n,
            ...anchor,
            // One node's handles turned by hand are taken from the solver.
            ...(lone && n.type === "auto" ? { type: "smooth" as const } : {}),
            in: n.in && (handleOf(n, n.in) ? moved(n.in) : anchor),
            out: n.out && (handleOf(n, n.out) ? moved(n.out) : anchor),
          },
        ] as const
      })
    )
    const geometry = replacePathNodes(object.geometry, changes)
    return JSON.stringify(geometry) === JSON.stringify(object.geometry)
      ? []
      : [{ type: "update", id: object.id, patch: { geometry } }]
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
  modifiers,
}: {
  scene: VectorScene
  grab: NodeGrab
  nodes: readonly VectorNode[]
  /** Where the grabbed part is now, in document coordinates. */
  point: Point
  /** Held while a handle is dragged: see `constrainHandle`, and Shift mirrors. */
  modifiers?: HandleModifiers
}): SceneCommand[] {
  const { object, index, part } = grab
  if (!isPath(object)) return []
  if (part !== "anchor") {
    const moved = dragNode(grab, point, modifiers)
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
 * The scene edits of giving every selected node a type; null when there is
 * nothing to do.
 */
export function nodeCommand(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  type: NodeType
): { edits: SceneCommand[]; nodes: VectorNode[] } | null {
  const edits = scene.objects
    .filter(isPath)
    .flatMap((object): SceneCommand[] => {
      const indices = nodes
        .filter(
          (n) => n.objectId === object.id && object.geometry.nodes[n.index]
        )
        .map((n) => n.index)
      if (!indices.length) return []
      const geometry = indices.reduce(
        (path, index) =>
          editPathNode(path, { type: "retype", index, nodeType: type }),
        object.geometry
      )
      return [{ type: "update", id: object.id, patch: { geometry } }]
    })
  return edits.length ? { edits, nodes: [...nodes] } : null
}

/**
 * The scene edits of deleting every selected node, refitting the curve
 * around each run of them to keep its shape or not, with the nodes to keep
 * selected after; null when none is selected. A path left with fewer than
 * two nodes goes as an object.
 */
export function deleteNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  { refit }: { refit: boolean }
): { edits: SceneCommand[]; nodes: VectorNode[] } | null {
  const edits = scene.objects
    .filter(isPath)
    .flatMap((object): SceneCommand[] => {
      const indices = nodes
        .filter((n) => n.objectId === object.id)
        .map((n) => n.index)
        .filter((i) => object.geometry.nodes[i])
      if (!indices.length) return []
      const geometry = deletePathNodes(object.geometry, indices, { refit })
      return [
        geometry
          ? { type: "update", id: object.id, patch: { geometry } }
          : { type: "remove", id: object.id },
      ]
    })
  // Every selected node is gone, its path's indices with it.
  return edits.length ? { edits, nodes: [] } : null
}

/**
 * The selected segments of the edited `paths`, each named by its first node:
 * those both of whose ends are selected, a closed path's last-to-first
 * among them.
 */
export function selectedSegments(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[]
): VectorNode[] {
  return paths.filter(isPath).flatMap((object) => {
    const { closed, nodes: all } = object.geometry
    const held = new Set(
      nodes.filter((n) => n.objectId === object.id).map((n) => n.index)
    )
    return all.flatMap((_, index) =>
      (closed || index < all.length - 1) &&
      held.has(index) &&
      held.has((index + 1) % all.length)
        ? [{ objectId: object.id, index }]
        : []
    )
  })
}

/**
 * The scene edits of making every selected segment a line or a curve;
 * null when no segment is selected or every one is that shape already.
 */
export function segmentCommand(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  shape: SegmentShape
): SceneCommand[] | null {
  const segments = selectedSegments(scene.objects, nodes)
  const edits = scene.objects
    .filter(isPath)
    .flatMap((object): SceneCommand[] => {
      const geometry = segments
        .filter((s) => s.objectId === object.id)
        .reduce(
          (path, { index }) =>
            editPathNode(path, { type: "segment", index, shape }),
          object.geometry
        )
      return JSON.stringify(geometry) === JSON.stringify(object.geometry)
        ? []
        : [{ type: "update", id: object.id, patch: { geometry } }]
    })
  return edits.length ? edits : null
}

/**
 * The scene edits of adding a node at the middle of every selected segment,
 * keeping the curve as it was, with the selection grown by the new nodes;
 * null when no segment is selected.
 */
export function insertNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[]
): { edits: SceneCommand[]; nodes: VectorNode[] } | null {
  const segments = selectedSegments(scene.objects, nodes)
  if (!segments.length) return null
  const edits: SceneCommand[] = []
  const added: VectorNode[] = []
  const moved = nodes.map((n) => ({ ...n }))
  for (const object of scene.objects.filter(isPath)) {
    const splits = segments
      .filter((s) => s.objectId === object.id)
      .map((s) => s.index)
      .sort((a, b) => a - b)
    if (!splits.length) continue
    // From the last first, so each split leaves the earlier indices be.
    const geometry = splits.reduceRight(
      (path, index) => editPathNode(path, { type: "split", index }),
      object.geometry
    )
    edits.push({ type: "update", id: object.id, patch: { geometry } })
    // Every node after a split has moved up one for each split before it.
    const before = (index: number) => splits.filter((s) => s < index).length
    for (const n of moved)
      if (n.objectId === object.id) n.index += before(n.index)
    for (const index of splits)
      added.push({ objectId: object.id, index: index + 1 + before(index) })
  }
  return { edits, nodes: [...moved, ...added] }
}

/** Whether any selected node is one a break can part a path at. */
export function canBreak(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[]
): boolean {
  return paths.filter(isPath).some((object) => {
    const indices = nodes
      .filter((n) => n.objectId === object.id)
      .map((n) => n.index)
    return breakPath(object.geometry, indices)[0] !== object.geometry
  })
}

/**
 * The scene edits of breaking every path at its selected nodes. A closed
 * path opens; each further piece becomes a path of its own, in the same
 * style, directly above the one it came from and in order along it, named
 * by `nextId`. Null when no selected node can be broken.
 */
export function breakNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  nextId: () => string
): PiecesCommand | null {
  return piecesCommand(scene, nodes, breakPath, nextId)
}

/**
 * The scene edits of deleting every selected segment: a closed path opens
 * there; an open one parts, each further piece a path of its own above it,
 * as a break leaves them; a path with nothing left goes. Null when no
 * segment is selected.
 */
export function deleteSegments(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  nextId: () => string
): PiecesCommand | null {
  return piecesCommand(
    scene,
    selectedSegments(scene.objects, nodes),
    cutPathSegments,
    nextId
  )
}

/** Scene edits that cut paths up, with the paths they added and removed. */
export type PiecesCommand = {
  edits: SceneCommand[]
  added: string[]
  removed: string[]
}

/**
 * The scene edits of cutting each path at its `at` indices into `cut`'s
 * pieces: the first stays the path, each further one a path of its own in
 * the same style, directly above it and in order along it, named by
 * `nextId`; no pieces at all removes it. Null when nothing was cut.
 */
function piecesCommand(
  scene: VectorScene,
  cuts: readonly VectorNode[],
  cut: (path: BezierPath, indices: readonly number[]) => BezierPath[],
  nextId: () => string
): PiecesCommand | null {
  const result: PiecesCommand = { edits: [], added: [], removed: [] }
  // From the top down, so each add leaves the places below it be.
  for (let place = scene.objects.length - 1; place >= 0; place--) {
    const object = scene.objects[place]
    if (!isPath(object)) continue
    const indices = cuts
      .filter((n) => n.objectId === object.id)
      .map((n) => n.index)
    if (!indices.length) continue
    const [first, ...rest] = cut(object.geometry, indices)
    if (first === object.geometry) continue
    if (!first) {
      result.edits.push({ type: "remove", id: object.id })
      result.removed.push(object.id)
      continue
    }
    result.edits.push({
      type: "update",
      id: object.id,
      patch: { geometry: first },
    })
    rest.forEach((geometry, k) => {
      const id = nextId()
      result.added.push(id)
      result.edits.push({
        type: "add",
        index: place + 1 + k,
        object: { ...object, id, geometry },
      })
    })
  }
  return result.edits.length ? result : null
}

/**
 * The two selected nodes as ends of open paths, the first selected first;
 * null unless exactly two are selected and each is such an end, and,
 * merging a path's own ends, unless enough nodes would be left to close.
 */
function joinEnds(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[],
  mode: JoinMode
): [JoinEnd, JoinEnd] | null {
  if (nodes.length !== 2) return null
  const ends = nodes.map((n): JoinEnd | null => {
    const object = paths.find((o) => o.id === n.objectId)
    if (!object || !isPath(object) || object.geometry.closed) return null
    const last = object.geometry.nodes.length - 1
    return n.index === 0 || n.index === last
      ? { object, end: n.index === 0 ? "start" : "end" }
      : null
  })
  const [a, b] = ends
  if (!a || !b) return null
  if (a.object === b.object) {
    if (a.end === b.end) return null
    if (mode === "merge" && a.object.geometry.nodes.length < 3) return null
  }
  return [a, b]
}

type JoinEnd = { object: PathObject; end: PathEnd }

/** Whether the selection is two ends of open paths a join can join. */
export function canJoin(
  paths: readonly VectorObject[],
  nodes: readonly VectorNode[],
  mode: JoinMode = "merge"
): boolean {
  return joinEnds(paths, nodes, mode) !== null
}

/**
 * The scene edits of joining the two selected ends, merged or by a segment
 * (`mode`). A path's own ends close it; two paths become the first
 * selected's object, in its style, the second's nodes carried into its
 * coordinates. The joined node or nodes stay selected. Null when the
 * selection is not two ends to join.
 */
export function joinNodes(
  scene: VectorScene,
  nodes: readonly VectorNode[],
  mode: JoinMode
): {
  edits: SceneCommand[]
  nodes: VectorNode[]
  removed: string[]
} | null {
  const ends = joinEnds(scene.objects, nodes, mode)
  if (!ends) return null
  const [a, b] = ends
  const samePath = a.object === b.object
  // The second path in the first's space: out to the scene, back into it.
  const into = invertMatrix(a.object.transform)
  const carry = (p: Point | null) =>
    p && applyAffine(into, applyAffine(b.object.transform, p))
  const other = samePath
    ? null
    : {
        ...b.object.geometry,
        nodes: b.object.geometry.nodes.map((n) => ({
          ...n,
          ...carry({ x: n.x, y: n.y }),
          in: carry(n.in),
          out: carry(n.out),
        })),
      }
  const geometry = joinPathEnds(a.object.geometry, a.end, other, b.end, mode)
  const id = a.object.id
  // `a` runs on into the join, so it is where `a`'s nodes end.
  const joint = samePath ? 0 : a.object.geometry.nodes.length - 1
  const held =
    mode === "merge"
      ? [joint]
      : samePath
        ? [0, geometry.nodes.length - 1]
        : [joint, joint + 1]
  return {
    edits: [
      { type: "update", id, patch: { geometry } },
      ...(samePath ? [] : [{ type: "remove" as const, id: b.object.id }]),
    ],
    nodes: held.map((index) => ({ objectId: id, index })),
    removed: samePath ? [] : [b.object.id],
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
