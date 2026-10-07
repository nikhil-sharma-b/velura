import { describe, expect, test } from "bun:test"

import { normaliseBrushDefinition } from "@/convex/lib/brush"
import {
  kritaTextureId,
  parseKritaPreset,
  readKpp,
  translateKritaPreset,
  type KritaTip,
} from "@/engine/brush/krita-preset"

/** One `<param>`, CDATA-wrapped as Krita writes strings. */
const param = (name: string, value: string | number | boolean) =>
  `<param name="${name}" type="string"><![CDATA[${value}]]></param>`

/** Krita also writes plain values as `internal` params, attributes swapped. */
const internal = (name: string, value: string | number | boolean) =>
  `<param type="internal" name="${name}">${value}</param>`

const sensor = (id: string, curve?: string) =>
  `<!DOCTYPE params> <params id="${id}">${curve ? ` <curve>${curve}</curve>` : ""} </params> `

const autoBrush = ({
  diameter = 20,
  ratio = 1,
  fade = 0.5,
  spacing = 0.1,
  angle = 0,
  id = "default",
  extra = "",
} = {}) =>
  `<Brush type="auto_brush" spacing="${spacing}" useAutoSpacing="0" autoSpacingCoeff="1" angle="${angle}" randomness="0" density="1" BrushVersion="2"> <MaskGenerator id="${id}" type="circle" diameter="${diameter}" ratio="${ratio}" hfade="${fade}" vfade="${fade}" spikes="2" antialiasEdges="1"${extra}/> </Brush> `

function preset(...params: string[]): string {
  return `<Preset name="b)_Test_Brush" paintopid="paintbrush"> ${param("brush_definition", autoBrush())} ${params.join(" ")} </Preset>`
}

/** A preset whose brush definition is the one given. */
function presetWith(definition: string, ...params: string[]): string {
  return `<Preset name="b)_Test_Brush" paintopid="paintbrush"> ${param("brush_definition", definition)} ${params.join(" ")} </Preset>`
}

/** An enabled option driven by one sensor. */
function option(name: string, value: number, sensorXml: string) {
  return [
    param(`Pressure${name}`, true),
    param(`${name}Sensor`, sensorXml),
    param(`${name}UseCurve`, true),
    param(`${name}Value`, value),
    param(`${name}curveMode`, 0),
  ]
}

const translate = (xml: string, tip?: (id: string) => KritaTip | undefined) =>
  translateKritaPreset(parseKritaPreset(xml), { tip })

describe("parsing a Krita preset", () => {
  test("reads the name, engine and both param spellings", () => {
    const parsed = parseKritaPreset(
      `<Preset paintopid="paintbrush" name="c)_Pencil&amp;Ink"> ${param("A", "x &lt; y")} ${internal("B", "1.5")} </Preset>`
    )
    expect(parsed.name).toBe("c)_Pencil&Ink")
    expect(parsed.engine).toBe("paintbrush")
    expect(parsed.params.get("A")).toBe("x &lt; y")
    expect(parsed.params.get("B")).toBe("1.5")
  })

  test("rejects text that is not a preset", () => {
    expect(() => parseKritaPreset("<Other/>")).toThrow(/preset/)
  })
})

describe("translating the tip", () => {
  test("diameter becomes radius, spacing carries over", () => {
    const { brush } = translate(
      presetWith(autoBrush({ diameter: 30, spacing: 0.08 }))
    )
    expect(brush.shape.radius).toBe(15)
    expect(brush.shape.spacing).toBeCloseTo(0.08)
  })

  test("ratio becomes roundness", () => {
    const { brush } = translate(presetWith(autoBrush({ ratio: 0.4 })))
    expect(brush.shape.roundness).toBeCloseTo(0.4)
  })

  test("a ratio over one is the same ellipse turned a quarter", () => {
    const { brush } = translate(presetWith(autoBrush({ ratio: 2 })))
    expect(brush.shape.roundness).toBeCloseTo(0.5)
    expect(brush.shape.angle).toBeCloseTo(0.25)
  })

  test("the brush angle, counter-clockwise radians, becomes a clockwise turn", () => {
    const { brush } = translate(presetWith(autoBrush({ angle: Math.PI / 2 })))
    expect(brush.shape.angle).toBeCloseTo(0.75)
  })

  test("fade is where the falloff starts, so feather is what lies past it", () => {
    const { brush } = translate(
      presetWith(autoBrush({ diameter: 40, fade: 0.25 }))
    )
    expect(brush.shape.feather).toBeCloseTo(15)
  })

  test("fade one is a hard edge", () => {
    const { brush } = translate(
      presetWith(autoBrush({ diameter: 40, fade: 1 }))
    )
    expect(brush.shape.feather).toBe(0)
  })

  test("an image tip names its shipped texture and sizes by its pixels", () => {
    const definition = `<Brush type="png_brush" filename="Chalk_Grain 02.png" scale="0.5" spacing="0.2" angle="0" useAutoSpacing="0" BrushVersion="2"/> `
    const { brush, dropped } = translate(presetWith(definition), (id) =>
      id === "krita:chalk-grain-02" ? { width: 80, height: 60 } : undefined
    )
    expect(brush.shape.tipTextureId).toBe("krita:chalk-grain-02")
    expect(brush.shape.radius).toBe(20)
    expect(brush.shape.feather).toBe(0)
    expect(dropped).toEqual([])
  })

  test("a tip set keeps its frame selection", () => {
    const definition = `<Brush type="gbr_brush" filename="leaves.gih" scale="1" spacing="0.5" angle="0" useAutoSpacing="0" BrushVersion="2"/> `
    const { brush } = translate(presetWith(definition), () => ({
      width: 40,
      height: 40,
      selection: "incremental",
    }))
    expect(brush.shape.tipTextureId).toBe("krita:leaves")
    expect(brush.shape.tipSelection).toBe("sequential")
  })

  test("a tip Velura does not ship is reported and drawn round", () => {
    const definition = `<Brush type="png_brush" filename="missing.png" scale="1" spacing="0.1" angle="0" BrushVersion="2"/> `
    const { brush, dropped } = translate(
      presetWith(definition),
      () => undefined
    )
    expect(brush.shape.tipTextureId).toBeUndefined()
    expect(dropped.join()).toMatch(/missing\.png/)
  })

  test("mask shapes Velura cannot draw are reported", () => {
    const { dropped } = translate(
      presetWith(
        autoBrush({ extra: "" }).replace('type="circle"', 'type="rect"')
      )
    )
    expect(dropped.join()).toMatch(/square/i)
  })
})

describe("translating sensors", () => {
  test("pressure on size becomes a multiply with Krita's curve", () => {
    const { brush } = translate(
      preset(...option("Size", 1, sensor("pressure", "0,0.5;1,1;")))
    )
    expect(brush.dynamics).toEqual([
      {
        source: "pressure",
        target: "size",
        curve: [
          { x: 0, y: 0.5 },
          { x: 1, y: 1 },
        ],
        range: [0, 1],
        mix: "multiply",
      },
    ])
  })

  test("the option's strength is the top of the range", () => {
    const { brush } = translate(
      preset(...option("Opacity", 0.6, sensor("pressure")))
    )
    expect(brush.dynamics[0]).toMatchObject({
      target: "flow",
      range: [0, 0.6],
    })
    expect(brush.dynamics[0].curve).toBeUndefined()
  })

  test("an option with its sensor off is a constant on the brush", () => {
    const { brush } = translate(
      preset(
        param("PressureFlow", true),
        param("FlowSensor", sensor("pressure")),
        param("FlowUseCurve", false),
        param("FlowValue", 0.3)
      )
    )
    expect(brush.dynamics).toEqual([])
    expect(brush.rendering.flow).toBeCloseTo(0.3)
  })

  test("constant opacity and flow compound into each dab's flow", () => {
    const { brush } = translate(
      preset(
        param("OpacityUseCurve", false),
        param("OpacityValue", 0.5),
        param("FlowUseCurve", false),
        param("FlowValue", 0.4)
      )
    )
    expect(brush.rendering.flow).toBeCloseTo(0.2)
    expect(brush.rendering.opacity).toBe(1)
  })

  const alwaysOn = (name: string, curve: string) => [
    param(`${name}Sensor`, sensor("pressure", curve)),
    param(`${name}UseCurve`, true),
    param(`${name}Value`, 1),
  ]

  test("opacity and flow are always on, so need no enable flag", () => {
    for (const name of ["Opacity", "Flow"]) {
      const { brush } = translate(preset(...alwaysOn(name, "0,0.2;1,1;")))
      expect(brush.dynamics.map((m) => [m.source, m.target])).toEqual([
        ["pressure", "flow"],
      ])
    }
  })

  test("opacity drives each dab, since Velura's opacity is set once a stroke", () => {
    const { brush, dropped } = translate(
      preset(
        ...alwaysOn("Opacity", "0,0.2;1,1;"),
        ...alwaysOn("Flow", "0,0.5;1,1;")
      )
    )
    expect(brush.dynamics).toEqual([
      {
        source: "pressure",
        target: "flow",
        curve: [
          { x: 0, y: 0.2 },
          { x: 1, y: 1 },
        ],
        range: [0, 1],
        mix: "multiply",
      },
    ])
    expect(dropped.join()).toMatch(/flow sensor/i)
  })

  test("a constant option Velura cannot hold is reported", () => {
    const { brush, dropped } = translate(
      preset(
        param("PressureRotation", true),
        param("RotationUseCurve", false),
        param("RotationValue", 0.3)
      )
    )
    expect(brush.dynamics).toEqual([])
    expect(dropped.join()).toMatch(/constant Rotation/)
  })

  test("a disabled option is ignored", () => {
    const { brush } = translate(
      preset(
        param("PressureSize", false),
        param("SizeSensor", sensor("pressure")),
        param("SizeUseCurve", true),
        param("SizeValue", 1)
      )
    )
    expect(brush.dynamics).toEqual([])
  })

  test.each([
    ["pressure", "pressure"],
    ["speed", "velocity"],
    ["drawingangle", "direction"],
    ["fuzzy", "random"],
    ["ascension", "tiltDirection"],
    ["fade", "strokeProgress"],
  ] as const)("Krita's %s sensor reads Velura's %s", (krita, velura) => {
    const { brush } = translate(preset(...option("Size", 1, sensor(krita))))
    expect(brush.dynamics[0].source).toBe(velura)
  })

  test("declination is elevation, so it reads tilt mirrored", () => {
    const { brush } = translate(
      preset(...option("Size", 1, sensor("declination", "0,0;0.25,1;1,1;")))
    )
    expect(brush.dynamics[0].source).toBe("tilt")
    expect(brush.dynamics[0].curve).toEqual([
      { x: 0, y: 1 },
      { x: 0.75, y: 1 },
      { x: 1, y: 0 },
    ])
  })

  test("sensors Velura has no source for are reported", () => {
    const { brush, dropped } = translate(
      preset(...option("Size", 1, sensor("tangentialpressure")))
    )
    expect(brush.dynamics).toEqual([])
    expect(dropped.join()).toMatch(/tangentialpressure/)
  })

  test("a sensor list becomes one mapping per sensor", () => {
    const list = `<!DOCTYPE params> <params id="sensorslist"> <ChildSensor id="speed"> <curve>0,1;1,0;</curve> </ChildSensor> <ChildSensor id="pressure"> <curve>0,0.75;1,1;</curve> </ChildSensor> </params> `
    const { brush } = translate(preset(...option("Size", 1, list)))
    expect(brush.dynamics.map((m) => [m.source, m.range])).toEqual([
      ["velocity", [0, 1]],
      ["pressure", [0, 1]],
    ])
  })

  test("rotation is an offset, turned clockwise", () => {
    const { brush } = translate(
      preset(...option("Rotation", 0.5, sensor("pressure")))
    )
    expect(brush.dynamics[0]).toMatchObject({
      target: "angle",
      range: [0, -0.5],
      mix: "add",
    })
  })

  test("drawing angle follows the stroke clockwise", () => {
    const { brush } = translate(
      preset(...option("Rotation", 1, sensor("drawingangle")))
    )
    expect(brush.dynamics[0]).toMatchObject({
      source: "direction",
      range: [0, 1],
    })
  })

  test("ratio drives roundness", () => {
    const { brush } = translate(
      preset(...option("Ratio", 1, sensor("pressure")))
    )
    expect(brush.dynamics[0]).toMatchObject({
      target: "roundness",
      mix: "multiply",
    })
  })

  test("scatter sets the amount in radii and maps its sensor", () => {
    const { brush } = translate(
      preset(
        ...option("Scatter", 1.5, sensor("pressure", "0,1;1,0;")),
        param("Scattering/AxisX", true),
        param("Scattering/AxisY", true)
      )
    )
    expect(brush.scatter).toEqual({ amount: 3, count: 1, axes: "both" })
    expect(brush.dynamics[0]).toMatchObject({
      target: "scatter",
      range: [0, 1],
      mix: "multiply",
    })
  })

  test("scatter across only, when Krita throws on Y alone", () => {
    const { brush } = translate(
      preset(
        ...option("Scatter", 1, sensor("fuzzy")),
        param("Scattering/AxisX", false),
        param("Scattering/AxisY", true)
      )
    )
    expect(brush.scatter?.axes).toBe("across")
  })

  test("darken lowers lightness", () => {
    const { brush } = translate(
      preset(...option("Darken", 0.5, sensor("pressure")))
    )
    expect(brush.dynamics[0]).toMatchObject({
      target: "lightness",
      range: [0, -0.5],
      mix: "add",
    })
  })

  test("hue swings both ways about its midpoint", () => {
    const { brush } = translate(preset(...option("h", 0.2, sensor("fuzzy"))))
    expect(brush.dynamics[0]).toMatchObject({
      source: "random",
      target: "hue",
      range: [-0.1, 0.1],
      mix: "add",
    })
  })

  test("options Velura cannot draw are reported, not translated", () => {
    const { dropped } = translate(
      preset(
        ...option("Sharpness", 1, sensor("pressure")),
        ...option("Softness", 1, sensor("pressure")),
        ...option("Spacing", 1, sensor("pressure")),
        param("HorizontalMirrorEnabled", true),
        param("MaskingBrush/Enabled", true),
        param("CompositeOp", "multiply")
      )
    )
    expect(dropped).toEqual([
      expect.stringMatching(/sharpness/i),
      expect.stringMatching(/softness/i),
      expect.stringMatching(/spacing/i),
      expect.stringMatching(/mirror/i),
      expect.stringMatching(/masked brush/i),
      expect.stringMatching(/multiply/),
    ])
  })
})

describe("translating the texture", () => {
  test("pattern, scale and strength become grain", () => {
    const { brush } = translate(
      preset(
        param("Texture/Pattern/Enabled", true),
        param("Texture/Pattern/PatternFileName", "paper/Canvas 01.pat"),
        param("Texture/Pattern/Scale", 0.8),
        param("Texture/Strength/Value", 0.7)
      )
    )
    expect(brush.grain).toEqual({
      textureId: "krita:canvas-01",
      scale: 0.8,
      depth: 0.7,
      movement: 0,
    })
  })

  test("a strength sensor drives grain depth", () => {
    const { brush } = translate(
      preset(
        param("Texture/Pattern/Enabled", true),
        param("Texture/Pattern/PatternFileName", "a.png"),
        param("Texture/Pattern/Scale", 1),
        param("PressureTexture/Strength/", true),
        param("Texture/Strength/Sensor", sensor("pressure", "0,1;1,0;")),
        param("Texture/Strength/UseCurve", true),
        param("Texture/Strength/Value", 1)
      )
    )
    expect(brush.dynamics[0]).toMatchObject({
      source: "pressure",
      target: "grainDepth",
      mix: "multiply",
    })
  })

  test("a paper Velura does not ship is reported and left off", () => {
    const { brush, dropped } = translateKritaPreset(
      parseKritaPreset(
        preset(
          param("Texture/Pattern/Enabled", true),
          param("Texture/Pattern/Name", "embedded.png"),
          param("Texture/Pattern/Scale", 1)
        )
      ),
      { grain: () => false }
    )
    expect(brush.grain).toBeUndefined()
    expect(dropped.join()).toMatch(/krita:embedded: not shipped/)
  })

  test("a disabled texture leaves the surface smooth", () => {
    const { brush } = translate(preset(param("Texture/Pattern/Enabled", false)))
    expect(brush.grain).toBeUndefined()
  })

  test("pattern adjustments Velura lacks are reported", () => {
    const { dropped } = translate(
      preset(
        param("Texture/Pattern/Enabled", true),
        param("Texture/Pattern/PatternFileName", "a.png"),
        param("Texture/Pattern/Scale", 1),
        param("Texture/Pattern/Invert", true)
      )
    )
    expect(dropped.join()).toMatch(/invert/i)
  })
})

describe("the draft", () => {
  test("is a brush the library will store", () => {
    const { brush } = translate(
      preset(
        ...option("Size", 1, sensor("pressure", "0,0.3;0.5,0.8;1,1;")),
        ...option("Rotation", 1, sensor("drawingangle")),
        ...option("h", 0.3, sensor("fuzzy")),
        ...option("Scatter", 20, sensor("fuzzy"))
      )
    )
    expect(normaliseBrushDefinition(brush)).toEqual(brush)
  })

  test("is named and id'd from the preset", () => {
    const { brush } = translateKritaPreset(parseKritaPreset(preset()), {
      id: "builtin:krita-test",
    })
    expect(brush.id).toBe("builtin:krita-test")
    expect(brush.name).toBe("Test Brush")
  })

  test("only the paintbrush engine translates", () => {
    expect(() =>
      translate(`<Preset name="x" paintopid="colorsmudge"></Preset>`)
    ).toThrow(/colorsmudge/)
  })
})

describe("texture ids", () => {
  test("match the asset pipeline's slugs", () => {
    expect(kritaTextureId("brushes/Basic_tip_default.png")).toBe(
      "krita:basic-tip-default"
    )
    expect(kritaTextureId("Chalk 02.gih")).toBe("krita:chalk-02")
  })
})

/** A PNG holding only the given chunks, CRCs zeroed: the reader skips them. */
function png(...chunks: [string, Uint8Array][]): Uint8Array {
  const parts: Uint8Array[] = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  ]
  for (const [type, data] of [...chunks, ["IEND", new Uint8Array()] as const]) {
    const head = new Uint8Array(8)
    new DataView(head.buffer).setUint32(0, data.length)
    head.set(new TextEncoder().encode(type), 4)
    parts.push(head, data, new Uint8Array(4))
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

const latin1 = (text: string) => new TextEncoder().encode(text)

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

describe("reading a .kpp", () => {
  const xml = preset()

  test("from a tEXt chunk", async () => {
    const bytes = png(["tEXt", latin1(`preset\0${xml}`)])
    expect(await readKpp(bytes)).toBe(xml)
  })

  test("from a zTXt chunk", async () => {
    const body = await deflate(latin1(xml))
    const data = new Uint8Array([...latin1("preset\0"), 0, ...body])
    expect(await readKpp(png(["zTXt", data]))).toBe(xml)
  })

  test("skips text chunks with other keywords", async () => {
    const bytes = png(
      ["tEXt", latin1("version\x002.2")],
      ["tEXt", latin1(`preset\0${xml}`)]
    )
    expect(await readKpp(bytes)).toBe(xml)
  })

  test("rejects a PNG with no preset", async () => {
    await expect(readKpp(png())).rejects.toThrow(/preset/)
  })

  test("rejects a file that is not a PNG", async () => {
    await expect(readKpp(new Uint8Array(12))).rejects.toThrow(/PNG/)
  })
})
