import { expect, test } from "bun:test"
import {
  allNodes,
  boxNodes,
  dragNode,
  editNode,
  handlesShown,
  nodeCommand,
  pressNode,
  pruneNodes,
  dragNodes,
  lockAxis,
  moveNodes,
  stepNode,
  type VectorNode,
} from "../../engine/doc/node-tool"
import type { PathNode } from "../../engine/doc/vector-path"
import type {
  SceneCommand,
  VectorObject,
  VectorScene,
} from "../../engine/doc/vector-scene"

const triangle = (id: string, dx = 0): VectorObject => ({
  id,
  transform: [1, 0, 0, 1, dx, 0],
  style: {
    fill: "#000000",
    stroke: null,
    strokeWidth: 1,
  } as unknown as VectorObject["style"],
  geometry: {
    kind: "path",
    closed: true,
    nodes: [
      { x: 0, y: 0, in: null, out: null, type: "cusp" as const },
      { x: 100, y: 0, in: null, out: null, type: "cusp" as const },
      { x: 50, y: 100, in: null, out: null, type: "cusp" as const },
    ],
  },
})

const scene = (...objects: VectorObject[]): VectorScene => ({ objects })
const node = (objectId: string, index: number): VectorNode => ({
  objectId,
  index,
})
const press = (
  s: VectorScene,
  point: { x: number; y: number },
  {
    selection = [],
    nodes = [],
    shift = false,
    time = 0,
    lastClick,
  }: {
    selection?: string[]
    nodes?: VectorNode[]
    shift?: boolean
    time?: number
    lastClick?: { point: { x: number; y: number }; time: number }
  } = {}
) =>
  pressNode({
    scene: s,
    selection,
    nodes,
    shift,
    point,
    reach: 6,
    time,
    lastClick,
  })

test("pressing an anchor grabs it, selects its path, and only that node", () => {
  const result = press(
    scene(triangle("a")),
    { x: 101, y: 1 },
    {
      nodes: [node("a", 0)],
      selection: ["a"],
    }
  )
  expect(result.kind).toBe("grab")
  if (result.kind !== "grab") return
  expect(result.selection).toEqual(["a"])
  expect(result.nodes).toEqual([node("a", 1)])
  expect(result.grab).toMatchObject({ index: 1, part: "anchor" })
  expect(result.at).toEqual({ x: 100, y: 0 })
})

test("pressing an already selected anchor keeps the whole node selection", () => {
  const nodes = [node("a", 0), node("a", 1)]
  const result = press(
    scene(triangle("a")),
    { x: 100, y: 0 },
    {
      nodes,
      selection: ["a"],
    }
  )
  expect(result.kind === "grab" && result.nodes).toEqual(nodes)
})

test("Shift+click toggles a node in and out of the selection", () => {
  const s = scene(triangle("a"))
  const added = press(
    s,
    { x: 100, y: 0 },
    {
      nodes: [node("a", 0)],
      selection: ["a"],
      shift: true,
    }
  )
  // A corner with no handles is grabbed, in case Shift drags one out.
  expect(added).toMatchObject({
    kind: "grab",
    selection: ["a"],
    nodes: [node("a", 0), node("a", 1)],
  })
  const removed = press(
    s,
    { x: 100, y: 0 },
    {
      nodes: added.nodes,
      selection: ["a"],
      shift: true,
    }
  )
  expect(removed.nodes).toEqual([node("a", 0)])
})

test("Shift+click on another path's node adds that path to the edit", () => {
  const s = scene(triangle("a"), triangle("b", 300))
  const result = press(
    s,
    { x: 300, y: 0 },
    {
      nodes: [node("a", 0)],
      selection: ["a"],
      shift: true,
    }
  )
  expect(result.selection).toEqual(["a", "b"])
  expect(result.nodes).toEqual([node("a", 0), node("b", 0)])
})

test("a node of the selected path wins over one of a path above it", () => {
  const s = scene(triangle("below"), triangle("above"))
  const result = press(s, { x: 0, y: 0 }, { selection: ["below"] })
  expect(result.kind === "grab" && result.nodes[0].objectId).toBe("below")
})

test("dragging a grabbed anchor moves it in the object's own coordinates", () => {
  const result = press(scene(triangle("a", 10)), { x: 110, y: 0 })
  if (result.kind !== "grab") throw new Error("expected a grab")
  const moved = dragNode(result.grab, { x: 130, y: 20 })
  expect(
    moved.geometry.kind === "path" && moved.geometry.nodes[1]
  ).toMatchObject({ x: 120, y: 20 })
})

test("dragging back to where it started returns the same object", () => {
  const result = press(scene(triangle("a")), { x: 100, y: 0 })
  if (result.kind !== "grab") throw new Error("expected a grab")
  expect(dragNode(result.grab, { x: 100, y: 0 })).toBe(result.grab.object)
})

test("a press on a segment grabs it and selects its path and end nodes", () => {
  expect(press(scene(triangle("a")), { x: 50, y: 1 })).toMatchObject({
    kind: "grab",
    grab: { part: "segment", index: 0 },
    selection: ["a"],
    nodes: [node("a", 0), node("a", 1)],
    lastClick: { point: { x: 50, y: 1 }, time: 0 },
  })
})

test("a double-click on a segment adds a node there", () => {
  const s = scene(triangle("a"))
  const first = press(s, { x: 50, y: 0 })
  const second = press(
    s,
    { x: 50, y: 0 },
    {
      selection: ["a"],
      time: 100,
      lastClick: first.lastClick,
    }
  )
  expect(second.kind).toBe("split")
  if (second.kind !== "split") return
  expect(second.nodes).toEqual([node("a", 1)])
  expect(second.geometry.nodes).toHaveLength(4)
  expect(second.geometry.nodes[1]).toMatchObject({ x: 50, y: 0 })
})

test("a slow second click on a segment does not add a node", () => {
  const s = scene(triangle("a"))
  const first = press(s, { x: 50, y: 0 })
  expect(
    press(
      s,
      { x: 50, y: 0 },
      {
        selection: ["a"],
        time: 1000,
        lastClick: first.lastClick,
      }
    ).kind
  ).toBe("grab")
})

test("a click inside a filled path selects it; empty canvas starts a box", () => {
  const s = scene(triangle("a"))
  expect(press(s, { x: 50, y: 40 })).toMatchObject({
    kind: "select",
    selection: ["a"],
    nodes: [],
  })
  const nodes = [node("a", 0)]
  expect(
    press(s, { x: 500, y: 500 }, { selection: ["a"], nodes })
  ).toMatchObject({ kind: "box", selection: ["a"], nodes })
})

test("a box selects the edited paths' nodes inside it; Shift adds", () => {
  const paths = [triangle("a"), triangle("b", 300)]
  const box = { x: -10, y: -10, width: 120, height: 20 }
  expect(boxNodes(paths, [], box, false)).toEqual([node("a", 0), node("a", 1)])
  expect(boxNodes(paths, [node("b", 2)], box, true)).toEqual([
    node("b", 2),
    node("a", 0),
    node("a", 1),
  ])
  expect(boxNodes(paths, [node("b", 2)], box, false)).toEqual([
    node("a", 0),
    node("a", 1),
  ])
})

test("select all takes every node of every edited path", () => {
  expect(allNodes([triangle("a"), triangle("b")])).toHaveLength(6)
})

test("Tab steps to the next node, round all the paths; Shift+Tab back", () => {
  const paths = [triangle("a"), triangle("b")]
  expect(stepNode(paths, [], 1)).toEqual([node("a", 0)])
  expect(stepNode(paths, [], -1)).toEqual([node("b", 2)])
  expect(stepNode(paths, [node("a", 1)], 1)).toEqual([node("a", 2)])
  expect(stepNode(paths, [node("a", 0)], -1)).toEqual([node("b", 2)])
  expect(stepNode([], [], 1)).toEqual([])
})

test("handles show for selected nodes and their neighbours only", () => {
  const square: VectorObject = {
    ...triangle("a"),
    geometry: {
      kind: "path",
      closed: false,
      nodes: [0, 1, 2, 3, 4].map((x) => ({
        x: x * 10,
        y: 0,
        in: null,
        out: null,
        type: "cusp" as const,
      })),
    },
  }
  const shown = [0, 1, 2, 3, 4].map((i) =>
    handlesShown(square, i, [node("a", 2)])
  )
  expect(shown).toEqual([false, true, true, true, false])
  // A closed path's first and last are neighbours.
  expect(handlesShown(triangle("a"), 2, [node("a", 0)])).toBe(true)
})

test("a type goes to every selected node, delete removes them all", () => {
  const s = scene(triangle("a"), triangle("b", 300))
  const toggled = nodeCommand(s, [node("a", 0), node("b", 1)], "symmetric")
  expect(toggled?.edits).toHaveLength(2)
  expect(toggled?.nodes).toEqual([node("a", 0), node("b", 1)])
  const square = scene({
    ...triangle("a"),
    geometry: {
      kind: "path",
      closed: true,
      nodes: [0, 1, 2, 3].map((i) => ({
        x: i,
        y: 0,
        in: null,
        out: null,
        type: "cusp" as const,
      })),
    },
  })
  const deleted = nodeCommand(square, [node("a", 0), node("a", 2)], "delete")
  expect(deleted?.nodes).toEqual([])
  const [edit] = deleted!.edits
  expect(
    edit.type === "update" &&
      edit.patch.geometry?.kind === "path" &&
      edit.patch.geometry.nodes.map((n) => n.x)
  ).toEqual([1, 3])
})

test("commands do nothing without nodes; a path never drops below two", () => {
  const s = scene(triangle("a"))
  expect(nodeCommand(s, [], "smooth")).toBeNull()
  expect(nodeCommand(s, [node("a", 0), node("a", 1)], "delete")).toBeNull()
})

test("selected nodes are forgotten once their path or index is gone", () => {
  const paths = [triangle("a")]
  const kept = [node("a", 2)]
  expect(pruneNodes(paths, kept)).toBe(kept)
  expect(pruneNodes(paths, [node("a", 2), node("a", 3)])).toEqual(kept)
  expect(pruneNodes([], kept)).toEqual([])
})

test("releasing a moved node is one update to its path; unmoved is none", () => {
  const s = scene(triangle("a"))
  const result = press(s, { x: 100, y: 0 })
  if (result.kind !== "grab") throw new Error("expected a grab")
  const drag = (point: { x: number; y: number }) =>
    dragNodes({ scene: s, grab: result.grab, nodes: result.nodes, point })
  expect(drag({ x: 100, y: 0 })).toEqual([])
  const [command] = drag({ x: 90, y: 10 })
  expect(command).toMatchObject({ type: "update", id: "a" })
  expect(
    command.type === "update" &&
      command.patch.geometry?.kind === "path" &&
      command.patch.geometry.nodes[1]
  ).toMatchObject({ x: 90, y: 10 })
})

const withNode = (
  object: VectorObject,
  index: number,
  replacement: PathNode
): VectorObject => {
  if (object.geometry.kind !== "path") throw new Error("expected a path")
  const nodes = [...object.geometry.nodes]
  nodes[index] = replacement
  return { ...object, geometry: { ...object.geometry, nodes } }
}

const nodesOf = (command: SceneCommand) =>
  command.type === "update" && command.patch.geometry?.kind === "path"
    ? command.patch.geometry.nodes
    : []

test("moving nodes moves every one, across paths, handles along", () => {
  const curved = withNode(triangle("b", 200), 0, {
    x: 0,
    y: 0,
    in: { x: -10, y: 0 },
    out: { x: 10, y: 0 },
    type: "smooth" as const,
  })
  const s = scene(triangle("a"), curved)
  const edits = moveNodes(s, [node("a", 1), node("b", 0)], { x: 5, y: -3 })
  expect(edits.map((e) => e.type === "update" && e.id)).toEqual(["a", "b"])
  const [a, b] = edits.map(nodesOf)
  expect(a[0]).toMatchObject({ x: 0, y: 0 })
  expect(a[1]).toMatchObject({ x: 105, y: -3 })
  expect(b[0]).toEqual({
    x: 5,
    y: -3,
    in: { x: -5, y: -3 },
    out: { x: 15, y: -3 },
    type: "smooth" as const,
  })
  expect(moveNodes(s, [node("a", 1)], { x: 0, y: 0 })).toEqual([])
  expect(moveNodes(s, [], { x: 1, y: 1 })).toEqual([])
})

test("moving nodes reads the offset in document space on a scaled path", () => {
  const big = { ...triangle("a"), transform: [2, 0, 0, 2, 0, 0] as const }
  const [edit] = moveNodes(scene(big as VectorObject), [node("a", 1)], {
    x: 10,
    y: 4,
  })
  expect(nodesOf(edit)[1]).toMatchObject({ x: 105, y: 2 })
})

test("dragging a selected anchor moves the rest by the grabbed one's offset", () => {
  const s = scene(triangle("a"), triangle("b", 200))
  const nodes = [node("a", 1), node("b", 2)]
  const result = press(s, { x: 100, y: 0 }, { selection: ["a", "b"], nodes })
  if (result.kind !== "grab") throw new Error("expected a grab")
  expect(result.nodes).toEqual(nodes)
  const edits = dragNodes({
    scene: s,
    grab: result.grab,
    nodes: result.nodes,
    point: { x: 110, y: 20 },
  })
  expect(nodesOf(edits[0])[1]).toMatchObject({ x: 110, y: 20 })
  expect(nodesOf(edits[1])[2]).toMatchObject({ x: 60, y: 120 })
})

test("dragging a handle bends only its own node", () => {
  const curved = withNode(triangle("a"), 1, {
    x: 100,
    y: 0,
    in: { x: 90, y: 0 },
    out: null,
    type: "cusp" as const,
  })
  const s = scene(curved)
  const edits = dragNodes({
    scene: s,
    grab: { object: curved, index: 1, part: "in" },
    nodes: [node("a", 0), node("a", 1)],
    point: { x: 90, y: 10 },
  })
  expect(nodesOf(edits[0])[0]).toMatchObject({ x: 0, y: 0 })
  expect(nodesOf(edits[0])[1]).toMatchObject({ x: 100, in: { x: 90, y: 10 } })
})

test("an axis lock keeps the direction moved furthest along", () => {
  const from = { x: 10, y: 10 }
  expect(lockAxis(from, { x: 30, y: 15 })).toEqual({ x: 30, y: 10 })
  expect(lockAxis(from, { x: 5, y: -20 })).toEqual({ x: 10, y: -20 })
})

test("an edit by command keeps the node it lands on in hand", () => {
  const s = scene(triangle("a"))
  expect(editNode(s, "a", { type: "split", index: 0 }).node).toEqual(
    node("a", 1)
  )
  expect(editNode(s, "a", { type: "delete", index: 2 }).node).toEqual(
    node("a", 1)
  )
  expect(() => editNode(s, "missing", { type: "delete", index: 0 })).toThrow(
    "Select an editable path."
  )
})

test("only a handle that is shown can be taken hold of", () => {
  const curved: VectorObject = {
    ...triangle("a"),
    geometry: {
      kind: "path",
      closed: false,
      nodes: [0, 1, 2, 3].map((i) => ({
        x: i * 100,
        y: 0,
        in: null,
        out: { x: i * 100 + 20, y: 40 },
        type: "cusp" as const,
      })),
    },
  }
  const s = scene(curved)
  // Node 3's handle is beside node 2, so shown with 2 selected, not with 0.
  const at = { x: 320, y: 40 }
  expect(
    press(s, at, { selection: ["a"], nodes: [node("a", 2)] })
  ).toMatchObject({ kind: "grab", grab: { index: 3, part: "out" } })
  expect(
    press(s, at, { selection: ["a"], nodes: [node("a", 0)] }).kind
  ).not.toBe("grab")
})

test("a delete keeps the selected nodes of a path it had to leave alone", () => {
  const s = scene(triangle("a"), {
    ...triangle("b"),
    geometry: {
      kind: "path",
      closed: false,
      nodes: [0, 1].map((x) => ({
        x,
        y: 0,
        in: null,
        out: null,
        type: "cusp" as const,
      })),
    },
  })
  const result = nodeCommand(s, [node("a", 0), node("b", 0)], "delete")
  expect(result?.edits).toHaveLength(1)
  expect(result?.nodes).toEqual([node("b", 0)])
})

test("Tab goes on to the next path at a path's end", () => {
  const paths = [triangle("a"), triangle("b")]
  expect(stepNode(paths, [node("a", 2)], 1)).toEqual([node("b", 0)])
  expect(stepNode(paths, [node("b", 0)], -1)).toEqual([node("a", 2)])
  expect(stepNode(paths, [node("b", 2)], 1)).toEqual([node("a", 0)])
})

test("a path that gained or lost nodes lets go of its selected nodes", () => {
  const before = [triangle("a"), triangle("b")]
  const grown = editNode({ objects: before }, "a", { type: "split", index: 0 })
  const after = [{ ...before[0], geometry: grown.geometry }, before[1]]
  expect(pruneNodes(after, [node("a", 1), node("b", 1)], before)).toEqual([
    node("b", 1),
  ])
})

test("Shift+click on a segment or fill adds its path and keeps the nodes", () => {
  const s = scene(triangle("a"), triangle("b", 300))
  const nodes = [node("a", 0)]
  expect(
    press(s, { x: 350, y: 0 }, { selection: ["a"], nodes, shift: true })
  ).toMatchObject({
    kind: "grab",
    selection: ["a", "b"],
    nodes: [...nodes, node("b", 0), node("b", 1)],
  })
  expect(
    press(s, { x: 350, y: 40 }, { selection: ["a"], nodes, shift: true })
  ).toMatchObject({ kind: "select", selection: ["a", "b"], nodes })
})
