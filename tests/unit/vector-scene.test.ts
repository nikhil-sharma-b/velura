import { describe, expect, test } from "bun:test"

import {
  applySceneEdit,
  EMPTY_SCENE,
  parseScene,
  type VectorObject,
} from "../../engine/doc/vector-scene"

const red = { color: "#ff0000", opacity: 1, rule: "nonzero" } as const

function rect(id: string, x = 0): VectorObject {
  return {
    id,
    geometry: { kind: "rect", x, y: 0, width: 10, height: 10 },
    transform: [1, 0, 0, 1, 0, 0],
    style: { fill: red, stroke: null },
  }
}

const ids = (scene: { objects: readonly VectorObject[] }) =>
  scene.objects.map((object) => object.id)

describe("scene commands and the diffs that undo them", () => {
  test("adding an object puts it on top; its inverse takes it away", () => {
    const { scene, inverse } = applySceneEdit(EMPTY_SCENE, [
      { type: "add", object: rect("a") },
    ])
    expect(ids(scene)).toEqual(["a"])
    expect(applySceneEdit(scene, inverse).scene).toEqual(EMPTY_SCENE)
  })

  const three = applySceneEdit(EMPTY_SCENE, [
    { type: "add", object: rect("a") },
    { type: "add", object: rect("b") },
    { type: "add", object: rect("c") },
  ]).scene

  test("removing an object from the middle; undoing puts it back there", () => {
    const { scene, inverse } = applySceneEdit(three, [
      { type: "remove", id: "b" },
    ])
    expect(ids(scene)).toEqual(["a", "c"])
    expect(applySceneEdit(scene, inverse).scene).toEqual(three)
  })

  test("updating an object changes only the fields named; undo restores them", () => {
    const moved: VectorObject["transform"] = [1, 0, 0, 1, 5, 7]
    const { scene, inverse } = applySceneEdit(three, [
      { type: "update", id: "b", patch: { transform: moved } },
    ])
    expect(scene.objects[1]).toEqual({ ...rect("b"), transform: moved })
    expect(scene.objects[0]).toBe(three.objects[0])
    expect(applySceneEdit(scene, inverse).scene).toEqual(three)
  })

  test("reordering moves an object to an index; undo moves it back", () => {
    const { scene, inverse } = applySceneEdit(three, [
      { type: "reorder", id: "a", index: 2 },
    ])
    expect(ids(scene)).toEqual(["b", "c", "a"])
    expect(applySceneEdit(scene, inverse).scene).toEqual(three)
  })

  test("a run of commands undoes as a whole, last first", () => {
    const { scene, inverse } = applySceneEdit(three, [
      { type: "add", object: rect("d"), index: 0 },
      { type: "reorder", id: "d", index: 3 },
      {
        type: "update",
        id: "d",
        patch: { style: { fill: null, stroke: null } },
      },
      { type: "remove", id: "a" },
    ])
    expect(ids(scene)).toEqual(["b", "c", "d"])
    expect(applySceneEdit(scene, inverse).scene).toEqual(three)
  })

  test("commands naming objects that are not there are refused", () => {
    expect(() => applySceneEdit(three, [{ type: "remove", id: "z" }])).toThrow()
    expect(() =>
      applySceneEdit(three, [{ type: "add", object: rect("a") }])
    ).toThrow()
    expect(() =>
      applySceneEdit(three, [{ type: "reorder", id: "a", index: 3 }])
    ).toThrow()
  })

  test("a refused run leaves the scene it was given untouched", () => {
    const before = three.objects
    expect(() =>
      applySceneEdit(three, [
        { type: "remove", id: "a" },
        { type: "remove", id: "a" },
      ])
    ).toThrow()
    expect(three.objects).toBe(before)
    expect(ids(three)).toEqual(["a", "b", "c"])
  })
})

describe("objects from outside", () => {
  const bad: [string, VectorObject][] = [
    [
      "non-finite geometry",
      {
        ...rect("x"),
        geometry: { kind: "rect", x: NaN, y: 0, width: 1, height: 1 },
      },
    ],
    [
      "negative size",
      {
        ...rect("x"),
        geometry: { kind: "rect", x: 0, y: 0, width: -1, height: 1 },
      },
    ],
    [
      "a transform that flattens",
      { ...rect("x"), transform: [1, 0, 2, 0, 0, 0] },
    ],
    [
      "a colour that is not one",
      { ...rect("x"), style: { fill: { ...red, color: "red" }, stroke: null } },
    ],
    [
      "opacity past one",
      { ...rect("x"), style: { fill: { ...red, opacity: 2 }, stroke: null } },
    ],
    [
      "a stroke with no width",
      {
        ...rect("x"),
        style: {
          fill: null,
          stroke: {
            color: "#000000",
            opacity: 1,
            width: 0,
            cap: "butt",
            join: "miter",
          },
        },
      },
    ],
    [
      "a polygon of one point",
      {
        ...rect("x"),
        geometry: { kind: "polygon", points: [{ x: 0, y: 0 }], closed: true },
      },
    ],
  ]
  for (const [name, object] of bad)
    test(`refuses ${name}`, () => {
      expect(() =>
        applySceneEdit(EMPTY_SCENE, [{ type: "add", object }])
      ).toThrow()
      const placed = applySceneEdit(EMPTY_SCENE, [
        { type: "add", object: rect("x") },
      ]).scene
      expect(() =>
        applySceneEdit(placed, [{ type: "update", id: "x", patch: object }])
      ).toThrow()
    })

  test("a saved scene is checked whole, and a sound one comes back as it was", () => {
    const scene = { objects: [rect("a"), rect("b", 20)] }
    expect(parseScene(JSON.parse(JSON.stringify(scene)))).toEqual(scene)
    expect(() => parseScene({ objects: [rect("a"), rect("a")] })).toThrow()
    expect(() => parseScene({ objects: "nope" })).toThrow()
    expect(() =>
      parseScene({ objects: [{ ...rect("a"), geometry: { kind: "blob" } }] })
    ).toThrow()
  })
})
