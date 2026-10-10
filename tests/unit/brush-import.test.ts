import { describe, expect, test } from "bun:test"

import type { Brush } from "@/engine/brush/brush"
import type { SourceImage } from "@/engine/brush/source-image"
import type { GrayscaleTexture } from "@/engine/brush/texture"
import {
  IMPORT_SET,
  importBrushFiles,
  type ImportDeps,
} from "@/features/studio/lib/brush-import"

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

/** A PNG holding only the given chunks, CRCs zeroed: the reader skips them. */
function png(...chunks: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ]
  for (const [type, data] of [...chunks, ["IEND", new Uint8Array()] as const])
    parts.push(words(data.length), text(type), data, new Uint8Array(4))
  return concat(...parts)
}

function kpp(engine: string, ...params: string[]) {
  const xml = `<Preset name="b)_My_Brush" paintopid="${engine}">${params.join("")}</Preset>`
  return png(["tEXt", text(`preset\0${xml}`)])
}

const definition = (brush: string) =>
  `<param type="string" name="brush_definition"><![CDATA[${brush}]]></param>`

function gbr(name: string, width: number, height: number) {
  const label = concat(text(name), new Uint8Array([0]))
  return concat(
    words(28 + label.length, 2, width, height, 1),
    text("GIMP"),
    words(50),
    label,
    new Uint8Array(width * height).fill(255)
  )
}

function gih(name: string, cells: Uint8Array[]) {
  return concat(
    text(`${name}\n${cells.length} ncells:${cells.length} sel0:random\n`),
    ...cells
  )
}

/** A store and a decoder that remember what they were given. */
function fakes(images: Record<string, SourceImage> = {}) {
  const textures: { name: string; texture: GrayscaleTexture }[] = []
  const brushes: { name: string; set: string; brush: Brush }[] = []
  const deps: ImportDeps = {
    async decodeImage(bytes) {
      const key = new TextDecoder("latin1").decode(bytes.subarray(-4))
      const image = images[key]
      if (!image) throw new Error("That image could not be read.")
      return image
    },
    async saveTexture(name, texture) {
      textures.push({ name, texture })
      return `texture:${textures.length}`
    },
    async save(name, set, brush) {
      brushes.push({ name, set, brush })
      return `brush:${brushes.length}`
    },
    async shippedTip(id) {
      return id === "krita:shipped-tip" ? { width: 64, height: 32 } : undefined
    },
    shippedGrain: (id) => id === "krita:shipped-paper",
  }
  return { deps, textures, brushes }
}

const file = (name: string, bytes: Uint8Array) => ({ name, bytes })

/** An image the fake decoder recognises by its last four bytes. */
const rgba = (width: number, height: number, value: number): SourceImage => ({
  width,
  height,
  channels: 4,
  pixels: new Uint8Array(width * height * 4).map((_, i) =>
    i % 4 === 3 ? 255 : value
  ),
})

describe("importing a .kpp", () => {
  test("translates it, saves it in the imported set, and says what it lost", async () => {
    const { deps, brushes } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "b)_My_Brush.kpp",
          kpp(
            "paintbrush",
            definition(
              `<Brush type="auto_brush" spacing="0.1"><MaskGenerator diameter="20" hfade="1" vfade="1" type="circle"/></Brush>`
            ),
            `<param name="HorizontalMirrorEnabled">true</param>`
          )
        ),
      ],
      deps
    )
    expect(outcome.failed).toEqual([])
    expect(outcome.imported).toHaveLength(1)
    const [imported] = outcome.imported
    expect(imported.brush.id).toBe("brush:1")
    expect(imported.brush.name).toBe("My Brush")
    expect(imported.dropped).toContain("mirroring")
    expect(brushes[0]).toMatchObject({ name: "My Brush", set: IMPORT_SET })
    expect(brushes[0].brush.shape.radius).toBe(10)
  })

  test("refuses another engine with a clear reason, and imports the rest", async () => {
    const { deps } = fakes()
    const outcome = await importBrushFiles(
      [
        file("smudge.kpp", kpp("spraybrush")),
        file("dots.gbr", gbr("Dots", 4, 4)),
      ],
      deps
    )
    expect(outcome.failed).toEqual([
      {
        file: "smudge.kpp",
        reason:
          "Only Krita's pixel brush and colour-smudge engines can be imported, not spraybrush.",
      },
    ])
    expect(outcome.imported.map((entry) => entry.brush.name)).toEqual(["Dots"])
  })

  test("keeps a tip it names when that tip is shipped", async () => {
    const { deps, textures } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            definition(`<Brush type="png_brush" filename="shipped_tip.png"/>`)
          )
        ),
      ],
      deps
    )
    expect(outcome.imported[0].brush.shape.tipTextureId).toBe(
      "krita:shipped-tip"
    )
    expect(textures).toEqual([])
  })

  test("takes the tip it names from the files brought with it", async () => {
    const { deps, textures, brushes } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            definition(
              `<Brush type="gbr_brush" filename="Hearts.gih" scale="1"/>`
            )
          )
        ),
        file("hearts.gih", gih("Hearts", [gbr("a", 8, 6), gbr("b", 8, 6)])),
      ],
      deps
    )
    expect(outcome.failed).toEqual([])
    // The tip went into the preset rather than becoming a brush of its own.
    expect(brushes).toHaveLength(1)
    expect(textures).toHaveLength(1)
    expect(textures[0].texture.frameCount).toBe(2)
    const shape = outcome.imported[0].brush.shape
    expect(shape.tipTextureId).toBe("texture:1")
    expect(shape.tipSelection).toBe("random")
    expect(shape.radius).toBe(4)
    expect(outcome.imported[0].dropped).toEqual([])
  })

  test("a tip brought with it that will not read leaves it round", async () => {
    const { deps } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            definition(`<Brush type="png_brush" filename="broken.png"/>`)
          )
        ),
        file("broken.png", text("XXXX")),
      ],
      deps
    )
    // Not claimed by the brush, so it is reported on its own rather than lost.
    expect(outcome.failed.map((entry) => entry.file)).toEqual(["broken.png"])
    expect(outcome.imported[0].brush.shape.tipTextureId).toBeUndefined()
    expect(outcome.imported[0].dropped[0]).toMatch(
      /^tip image broken\.png: That image could not be read\., drawn round$/
    )
  })

  test("says a tip it names but was not given is missing", async () => {
    const { deps } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            definition(`<Brush type="png_brush" filename="elsewhere.png"/>`)
          )
        ),
      ],
      deps
    )
    expect(outcome.imported[0].brush.shape.tipTextureId).toBeUndefined()
    expect(outcome.imported[0].dropped).toContain(
      "tip image elsewhere.png: not included, drawn round"
    )
  })

  test("stores the pattern it embeds as the brush's paper", async () => {
    const pattern = concat(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      text("PAT1")
    )
    const twice = btoa(btoa(String.fromCharCode(...pattern)))
    const image = rgba(2, 2, 0)
    image.pixels[0] = image.pixels[1] = image.pixels[2] = 255
    const { deps, textures } = fakes({ PAT1: image })
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            `<param name="Texture/Pattern/Enabled">true</param>`,
            `<param name="Texture/Pattern/Name">own_paper.png</param>`,
            `<param type="bytearray" name="Texture/Pattern/Pattern">${twice}</param>`
          )
        ),
      ],
      deps
    )
    expect(outcome.imported[0].brush.grain?.textureId).toBe("texture:1")
    expect(textures[0].name).toBe("Own paper")
    // Read as paper: light is a peak, stretched to the full range.
    expect([...textures[0].texture.data]).toEqual([255, 0, 0, 0])
    expect(outcome.imported[0].dropped.join()).not.toMatch(/paper/)
  })

  test("a shipped paper is used rather than a stored copy", async () => {
    const { deps, textures } = fakes()
    const outcome = await importBrushFiles(
      [
        file(
          "a.kpp",
          kpp(
            "paintbrush",
            `<param name="Texture/Pattern/Enabled">true</param>`,
            `<param name="Texture/Pattern/Name">shipped_paper.png</param>`
          )
        ),
      ],
      deps
    )
    expect(outcome.imported[0].brush.grain?.textureId).toBe(
      "krita:shipped-paper"
    )
    expect(textures).toEqual([])
  })
})

describe("importing tips", () => {
  test("a .gih becomes a brush stamping its frames", async () => {
    const { deps, textures, brushes } = fakes()
    const outcome = await importBrushFiles(
      [file("leaves.gih", gih("Leaves", [gbr("a", 10, 10), gbr("b", 10, 10)]))],
      deps
    )
    expect(textures[0]).toMatchObject({ name: "Leaves" })
    expect(brushes[0]).toMatchObject({ name: "Leaves", set: IMPORT_SET })
    expect(outcome.imported[0].brush.shape).toMatchObject({
      tipTextureId: "texture:1",
      tipSelection: "random",
      spacing: 0.5,
      radius: 5,
    })
  })

  test("several PNGs brought together are one tip set", async () => {
    const { deps, textures } = fakes({
      AAAA: rgba(4, 4, 0),
      BBBB: rgba(4, 4, 255),
    })
    const outcome = await importBrushFiles(
      [file("splat-2.png", text("BBBB")), file("splat-1.png", text("AAAA"))],
      deps
    )
    expect(outcome.failed).toEqual([])
    expect(textures).toHaveLength(1)
    expect(textures[0].texture.frameCount).toBe(2)
    // In name order: the first frame is the dark one, which is ink.
    expect(textures[0].texture.data[0]).toBe(255)
    expect(textures[0].texture.data[16]).toBe(0)
    expect(outcome.imported[0].brush.name).toBe("Splat")
  })

  test("a file it does not know is refused", async () => {
    const { deps } = fakes()
    const outcome = await importBrushFiles(
      [file("brush.abr", new Uint8Array(4))],
      deps
    )
    expect(outcome.failed[0].reason).toMatch(/\.kpp, \.gbr, \.gih or \.png/)
  })
})
