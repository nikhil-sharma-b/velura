import { expect, test } from "bun:test"
import {
  dragNode,
  nodeCommand,
  pressNode,
  pruneVectorNode,
} from "../../engine/doc/node-tool"
import type { VectorObject, VectorScene } from "../../engine/doc/vector-scene"

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
      { x: 0, y: 0, in: null, out: null, smooth: false },
      { x: 100, y: 0, in: null, out: null, smooth: false },
      { x: 50, y: 100, in: null, out: null, smooth: false },
    ],
  },
})

const scene = (...objects: VectorObject[]): VectorScene => ({ objects })
const press = (
  s: VectorScene,
  point: { x: number; y: number },
  selection: string[] = [],
  time = 0,
  lastClick?: { point: { x: number; y: number }; time: number }
) => pressNode({ scene: s, selection, point, reach: 6, time, lastClick })

test("pressing an anchor grabs it and selects its path", () => {
  const press1 = press(scene(triangle("a")), { x: 101, y: 1 })
  expect(press1.kind).toBe("grab")
  if (press1.kind !== "grab") return
  expect(press1.selection).toEqual(["a"])
  expect(press1.vectorNode).toEqual({ objectId: "a", index: 1 })
  expect(press1.grab).toMatchObject({ index: 1, part: "anchor" })
  expect(press1.at).toEqual({ x: 100, y: 0 })
})

test("a node of the selected path wins over one of a path above it", () => {
  const s = scene(triangle("below"), triangle("above"))
  const result = press(s, { x: 0, y: 0 }, ["below"])
  expect(result.kind === "grab" && result.vectorNode?.objectId).toBe("below")
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

test("a click on a segment selects its path without a node", () => {
  expect(press(scene(triangle("a")), { x: 50, y: 1 })).toEqual({
    kind: "select",
    selection: ["a"],
    vectorNode: null,
    lastClick: { point: { x: 50, y: 1 }, time: 0 },
  })
})

test("a double-click on a segment adds a node there", () => {
  const s = scene(triangle("a"))
  const first = press(s, { x: 50, y: 0 })
  const second = press(s, { x: 50, y: 0 }, ["a"], 100, first.lastClick)
  expect(second.kind).toBe("split")
  if (second.kind !== "split") return
  expect(second.vectorNode).toEqual({ objectId: "a", index: 1 })
  expect(second.geometry.nodes).toHaveLength(4)
  expect(second.geometry.nodes[1]).toMatchObject({ x: 50, y: 0 })
})

test("a slow second click on a segment does not add a node", () => {
  const s = scene(triangle("a"))
  const first = press(s, { x: 50, y: 0 })
  expect(press(s, { x: 50, y: 0 }, ["a"], 1000, first.lastClick).kind).toBe(
    "select"
  )
})

test("a click inside a filled path selects it; on empty canvas clears", () => {
  const s = scene(triangle("a"))
  expect(press(s, { x: 50, y: 40 }, [])).toMatchObject({
    kind: "select",
    selection: ["a"],
  })
  expect(press(s, { x: 500, y: 500 }, ["a"])).toMatchObject({
    kind: "select",
    selection: [],
  })
})

test("toggle and delete act on the selected node", () => {
  const s = scene(triangle("a"))
  const toggled = nodeCommand(s, { objectId: "a", index: 0 }, "toggle")
  expect(toggled?.geometry.nodes[0].smooth).toBe(true)
  expect(toggled?.vectorNode).toEqual({ objectId: "a", index: 0 })
  const deleted = nodeCommand(s, { objectId: "a", index: 0 }, "delete")
  expect(deleted?.geometry.nodes).toHaveLength(2)
  expect(deleted?.vectorNode).toBeNull()
})

test("commands do nothing without a node, or when a path would fall below two", () => {
  const s = scene(triangle("a"))
  expect(nodeCommand(s, null, "toggle")).toBeNull()
  const two = nodeCommand(s, { objectId: "a", index: 0 }, "delete")!
  const shorter = scene({ ...triangle("a"), geometry: two.geometry })
  expect(nodeCommand(shorter, { objectId: "a", index: 0 }, "delete")).toBeNull()
})

test("a node is forgotten once its path or index is gone", () => {
  const paths = [triangle("a")]
  const kept = { objectId: "a", index: 2 }
  expect(pruneVectorNode(paths, kept)).toBe(kept)
  expect(pruneVectorNode(paths, { objectId: "a", index: 3 })).toBeNull()
  expect(pruneVectorNode([], kept)).toBeNull()
  expect(pruneVectorNode(paths, null)).toBeNull()
})

test("releasing a moved node is one update to its path; unmoved is none", async () => {
  const { releaseNode } = await import("../../engine/doc/node-tool")
  const result = press(scene(triangle("a")), { x: 100, y: 0 })
  if (result.kind !== "grab") throw new Error("expected a grab")
  expect(releaseNode(result.grab, { x: 100, y: 0 })).toEqual([])
  const [command] = releaseNode(result.grab, { x: 90, y: 10 })
  expect(command).toMatchObject({ type: "update", id: "a" })
  expect(
    command.type === "update" &&
      command.patch.geometry?.kind === "path" &&
      command.patch.geometry.nodes[1]
  ).toMatchObject({ x: 90, y: 10 })
})

test("an edit by command keeps the node it lands on in hand", async () => {
  const { editNode } = await import("../../engine/doc/node-tool")
  const s = scene(triangle("a"))
  expect(editNode(s, "a", { type: "split", index: 0 }).vectorNode).toEqual({
    objectId: "a",
    index: 1,
  })
  expect(editNode(s, "a", { type: "delete", index: 2 }).vectorNode).toEqual({
    objectId: "a",
    index: 1,
  })
  expect(() => editNode(s, "missing", { type: "toggle", index: 0 })).toThrow(
    "Select an editable path."
  )
})
