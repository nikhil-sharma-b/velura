import { describe, expect, test } from "bun:test"

import { normaliseBrushDefinition } from "@/convex/lib/brush"
import { parseKritaPreset } from "@/engine/brush/krita-preset"
import { validateTexture } from "@/engine/brush/texture"
import {
  kritaEmbeddedPattern,
  kritaTipFile,
  readGimpTip,
  tipBrush,
  tipSet,
} from "@/engine/brush/tip-import"

const text = (value: string) => new TextEncoder().encode(value)

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

function words(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4)
  const view = new DataView(out.buffer)
  values.forEach((value, i) => view.setUint32(i * 4, value))
  return out
}

function gbr(name: string, width: number, height: number, fill: number) {
  const label = concat(text(name), new Uint8Array([0]))
  return concat(
    words(28 + label.length, 2, width, height, 1),
    text("GIMP"),
    words(40),
    label,
    new Uint8Array(width * height).fill(fill)
  )
}

function gih(cells: Uint8Array[], selection = "incremental") {
  return concat(
    text(`Hose\n${cells.length} ncells:${cells.length} sel0:${selection}\n`),
    ...cells
  )
}

const frame = (width: number, height: number, fill: number) => ({
  width,
  height,
  data: new Uint8Array(width * height).fill(fill),
})

describe("a tip set from frames", () => {
  test("one frame is a plain tip", () => {
    const tip = tipSet([frame(4, 3, 9)])
    expect(tip).toEqual({ width: 4, height: 3, data: tip.data })
    expect(tip.frameCount).toBeUndefined()
  })

  test("frames of different sizes are centred on the largest", () => {
    const tip = tipSet([frame(4, 4, 1), frame(2, 2, 7)])
    expect([tip.width, tip.height, tip.frameCount]).toEqual([4, 4, 2])
    validateTexture(tip)
    const second = tip.data.subarray(16)
    // The small frame sits in the middle, with no ink around it.
    expect([...second]).toEqual([
      0, 0, 0, 0, 0, 7, 7, 0, 0, 7, 7, 0, 0, 0, 0, 0,
    ])
  })

  test("a set too large to store is halved until it fits", () => {
    const tip = tipSet(
      Array.from({ length: 8 }, () => frame(300, 300, 200)),
      512
    )
    expect(tip.width).toBe(150)
    expect(tip.frameCount).toBe(8)
    expect(tip.data.length).toBeLessThanOrEqual(512 * 512)
    expect(tip.data[0]).toBe(200)
  })

  test("refuses no frames", () => {
    expect(() => tipSet([])).toThrow(/frame/)
  })
})

describe("reading a GIMP tip", () => {
  test("a .gbr is one frame, its spacing a fraction of the tip", () => {
    const tip = readGimpTip(gbr("Dot", 3, 2, 255), "gbr")
    expect(tip.name).toBe("Dot")
    expect([tip.width, tip.height, tip.spacing]).toEqual([3, 2, 0.4])
    expect(tip.texture.frameCount).toBeUndefined()
    expect(tip.selection).toBeUndefined()
  })

  test("a .gih is a tip set with its selection mode", () => {
    const tip = readGimpTip(
      gih([gbr("a", 2, 2, 10), gbr("b", 2, 2, 20), gbr("c", 2, 2, 30)]),
      "gih"
    )
    expect(tip.name).toBe("Hose")
    expect(tip.texture.frameCount).toBe(3)
    expect(tip.selection).toBe("sequential")
    expect([...tip.texture.data]).toEqual([
      10, 10, 10, 10, 20, 20, 20, 20, 30, 30, 30, 30,
    ])
  })
})

describe("a brush around an imported tip", () => {
  test("is sized to the tip and survives the store's normalising", () => {
    const tip = readGimpTip(
      gih([gbr("a", 40, 20, 1), gbr("b", 40, 20, 2)]),
      "gih"
    )
    const brush = tipBrush("Hose", "texture:1", tip)
    expect(brush.shape).toMatchObject({
      radius: 20,
      tipTextureId: "texture:1",
      tipSelection: "sequential",
      spacing: 0.4,
    })
    expect(normaliseBrushDefinition(brush)).toEqual(brush)
  })

  test("a huge tip is drawn at the largest size a brush may be", () => {
    const brush = tipBrush("Big", "t", {
      name: "Big",
      width: 4000,
      height: 10,
      texture: frame(1, 1, 1),
    })
    expect(brush.shape.radius).toBe(200)
    expect(brush.shape.spacing).toBe(0.25)
  })
})

describe("what a .kpp brings with it", () => {
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
  const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64")
  const preset = (...params: string[]) =>
    parseKritaPreset(
      `<Preset name="x" paintopid="paintbrush">${params.join("")}</Preset>`
    )

  test("its pattern, which Krita base64-encodes twice", () => {
    const twice = base64(text(base64(png)))
    expect(
      kritaEmbeddedPattern(
        preset(
          `<param type="bytearray" name="Texture/Pattern/Pattern">${twice}</param>`
        )
      )
    ).toEqual(png)
  })

  test("or once", () => {
    expect(
      kritaEmbeddedPattern(
        preset(
          `<param type="bytearray" name="Texture/Pattern/Pattern">${base64(png)}</param>`
        )
      )
    ).toEqual(png)
  })

  test("nothing when it embeds none", () => {
    expect(kritaEmbeddedPattern(preset())).toBeUndefined()
  })

  test("the tip file it references", () => {
    expect(
      kritaTipFile(
        preset(
          `<param type="string" name="brush_definition"><![CDATA[<Brush type="gbr_brush" filename="hearts.gih" spacing="0.25"/>]]></param>`
        )
      )
    ).toBe("hearts.gih")
    expect(kritaTipFile(preset())).toBeUndefined()
  })
})
