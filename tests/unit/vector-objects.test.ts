import { describe, expect, test } from "bun:test"
import {
  selectionStyle,
  selectObjects,
  transformObjects,
} from "../../engine/doc/vector-objects"
import { applySceneEdit, type VectorScene } from "../../engine/doc/vector-scene"

const scene: VectorScene = {
  objects: [
    {
      id: "ellipse",
      geometry: { kind: "ellipse", cx: 20, cy: 20, rx: 10, ry: 10 },
      transform: [1, 0, 0, 1, 0, 0],
      style: {
        fill: { color: "#ff0000", opacity: 1, rule: "nonzero" },
        stroke: null,
      },
    },
  ],
}

test("click selects painted geometry, not the empty corner of its box", () => {
  expect(selectObjects(scene, { x: 20, y: 20 })).toEqual(["ellipse"])
  expect(selectObjects(scene, { x: 10, y: 10 })).toEqual([])
  expect(selectObjects(scene, { x: 0, y: 0, width: 40, height: 40 })).toEqual([
    "ellipse",
  ])
})

test("document transforms compose with the existing object matrix and undo exactly", () => {
  const placed: VectorScene = {
    objects: [{ ...scene.objects[0], transform: [2, 0, 0, 2, 5, 7] }],
  }
  const edit = applySceneEdit(
    placed,
    transformObjects(placed, ["ellipse"], [0, 1, -1, 0, 100, 0])
  )
  expect(edit.scene.objects[0].transform).toEqual([0, 2, -2, 0, 93, 5])
  expect(applySceneEdit(edit.scene, edit.inverse).scene).toEqual(placed)
})

describe("selectionStyle", () => {
  const fallback = {
    fill: true,
    stroke: false,
    strokeWidth: 4,
    strokeCap: "butt" as const,
    strokeJoin: "miter" as const,
    fillColor: null,
    strokeColor: null,
  }
  const outlined: VectorScene = {
    objects: [
      scene.objects[0],
      {
        id: "outlined",
        geometry: { kind: "rect", x: 0, y: 0, width: 10, height: 10 },
        transform: [1, 0, 0, 1, 0, 0],
        style: {
          fill: null,
          stroke: {
            color: "#00ff00",
            opacity: 1,
            width: 9,
            cap: "round",
            join: "bevel",
          },
        },
      },
    ],
  }

  test("is null with nothing selected", () => {
    expect(selectionStyle(outlined, [], fallback)).toBeNull()
    expect(selectionStyle(outlined, ["gone"], fallback)).toBeNull()
  })

  test("is the selected object's own fill and outline", () => {
    expect(selectionStyle(outlined, ["ellipse"], fallback)).toEqual({
      ...fallback,
      fill: true,
      stroke: false,
      fillColor: "#ff0000",
    })
    expect(selectionStyle(outlined, ["outlined"], fallback)).toEqual({
      fill: false,
      stroke: true,
      strokeWidth: 9,
      strokeCap: "round",
      strokeJoin: "bevel",
      fillColor: null,
      strokeColor: "#00ff00",
    })
  })

  test("of several, is the lowest selected object's", () => {
    expect(
      selectionStyle(outlined, ["outlined", "ellipse"], fallback)?.fillColor
    ).toBe("#ff0000")
  })
})
