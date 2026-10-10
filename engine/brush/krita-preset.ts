import type { Brush, BrushGrain, BrushShape } from "./brush"
import type { Curve, CurvePoint } from "./curve"
import type {
  DynamicsMix,
  DynamicsSource,
  DynamicsTarget,
  Modulator,
} from "./dynamics"
import { MAX_SCATTER_AMOUNT, type BrushScatter } from "./scatter"
import { gimpTipSelection } from "./tip-sets"

/**
 * Krita brush presets (`.kpp`), translated into Velura brushes (brush library
 * 05).
 *
 * A `.kpp` is a PNG — the preset's thumbnail — with the preset itself as XML
 * in a `tEXt` or `zTXt` chunk keyed `preset`. The `paintbrush` and
 * `colorsmudge` engines are read as dry and wet brushes respectively. The
 * translator is plain TypeScript with no Node or DOM dependency, so the
 * curation script and the user-facing import (07) run the same translation.
 *
 * A translation is a draft, not a port. What Velura has no place for — masked
 * brushes, mirroring, sharpness, sensors it has no source for — is
 * dropped and named in the report, so a curator or an importing artist knows
 * what the brush lost on the way.
 */

export type KritaPreset = {
  name: string
  /** Krita's `paintopid`: which of its engines the preset is for. */
  engine: string
  params: ReadonlyMap<string, string>
}

/** What the translator needs to know about a tip image Velura ships. */
export type KritaTip = {
  /** The source image's size in pixels, before any shrinking to fit. */
  width: number
  height: number
  /** A tip set's frame selection, as the `.gih` names it. */
  selection?: string
}

export type KritaTranslateOptions = {
  /** The draft's id. Defaults to one made from the preset name. */
  id?: string
  /** Looks up a shipped tip by texture id; undefined when not shipped. */
  tip?: (id: string) => KritaTip | undefined
  /** Whether a paper is shipped; a preset naming one that is not loses it. */
  grain?: (id: string) => boolean
}

export type KritaTranslation = {
  brush: Brush
  /** One line per thing in the preset the brush does not carry. */
  dropped: string[]
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, name: string) => {
    if (name[0] === "#")
      return String.fromCodePoint(
        name[1] === "x" || name[1] === "X"
          ? parseInt(name.slice(2), 16)
          : parseInt(name.slice(1), 10)
      )
    return XML_ENTITIES[name] ?? whole
  })
}

function attributes(tag: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
    out.set(match[1], decodeEntities(match[2]))
  return out
}

/** An element's text: a CDATA section verbatim, or text with entities decoded. */
function elementText(body: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(body)
  return cdata ? cdata[1] : decodeEntities(body)
}

/**
 * The preset XML, flattened to its params.
 *
 * Krita writes a flat list of `<param>` elements, some CDATA-wrapped and some
 * not, with attributes in either order. A full XML parser would be a
 * dependency for a format this regular; a pattern over it is enough.
 */
export function parseKritaPreset(xml: string): KritaPreset {
  const open = /<Preset\b([^>]*)>/.exec(xml)
  if (!open) throw new Error("This is not a Krita brush preset.")
  const root = attributes(open[1])
  const params = new Map<string, string>()
  for (const match of xml.matchAll(
    /<param\b([^>]*?)(?:\/>|>([\s\S]*?)<\/param>)/g
  )) {
    const name = attributes(match[1]).get("name")
    if (name !== undefined) params.set(name, elementText(match[2] ?? ""))
  }
  return {
    name: root.get("name") ?? "",
    engine: root.get("paintopid") ?? "",
    params,
  }
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * The preset XML inside a `.kpp`. Async only because a `zTXt` chunk is
 * deflated, and the platform's decompressor is a stream.
 */
export async function readKpp(bytes: Uint8Array): Promise<string> {
  if (bytes.length < 8 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value))
    throw new Error("A .kpp must be a PNG.")
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const latin1 = new TextDecoder("latin1")
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at)
    const type = latin1.decode(bytes.subarray(at + 4, at + 8))
    const data = bytes.subarray(at + 8, at + 8 + length)
    at += 12 + length
    if (type !== "tEXt" && type !== "zTXt") continue
    const nul = data.indexOf(0)
    if (nul < 0 || latin1.decode(data.subarray(0, nul)) !== "preset") continue
    // Krita writes UTF-8 here, whatever the PNG spec says of tEXt.
    const text =
      type === "tEXt"
        ? data.subarray(nul + 1)
        : await inflate(data.subarray(nul + 2))
    return new TextDecoder().decode(text)
  }
  throw new Error("This PNG holds no Krita preset.")
}

/** `krita:<slug>`, as `tooling/krita-assets.ts` names a converted file. */
export function kritaTextureId(file: string): string {
  const base = file.split("/").pop() ?? file
  const stem = base.replace(/\.[^.]+$/, "")
  return `krita:${stem
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`
}

/** The slug a shipped brush's id is made from, e.g. `pencil-2`. */
export function kritaPresetSlug(file: string): string {
  return kritaTextureId(kritaPresetName(file.replace(/\.kpp$/, ""))).slice(
    "krita:".length
  )
}

/** A preset's display name: Krita's sort prefix and underscores removed. */
export function kritaPresetName(name: string): string {
  return name
    .replace(/^[a-z]\)_/i, "")
    .replace(/_/g, " ")
    .trim()
}

const SOURCES: Readonly<Record<string, DynamicsSource>> = {
  pressure: "pressure",
  pressurein: "pressure",
  speed: "velocity",
  drawingangle: "direction",
  fuzzy: "random",
  fuzzydab: "random",
  // Krita's fade, distance and time all grow along the stroke; Velura's one
  // such source is progress, which is the nearest reading of each.
  fade: "strokeProgress",
  distance: "strokeProgress",
  time: "strokeProgress",
  ascension: "tiltDirection",
  tiltdirection: "tiltDirection",
  declination: "tilt",
  tiltelevation: "tilt",
}

/** Elevation runs the other way from tilt: one is upright. */
const MIRRORED = new Set(["declination", "tiltelevation"])

/** Sources measured as a turn, whose sign follows the stroke rather than Krita's axes. */
const CLOCKWISE_SOURCES = new Set<DynamicsSource>([
  "direction",
  "tiltDirection",
  "random",
])

function parseCurve(
  text: string | undefined,
  mirror: boolean
): Curve | undefined {
  if (!text) return undefined
  let points: CurvePoint[] = text
    .split(";")
    .map((pair) => pair.split(",").map(Number))
    .filter((pair) => pair.length === 2 && pair.every(Number.isFinite))
    .map(([x, y]) => ({ x: clamp(x), y: clamp(y) }))
  if (mirror) points = points.map(({ x, y }) => ({ x: 1 - x, y })).reverse()
  // Velura's curves must strictly increase along x.
  const strict: CurvePoint[] = []
  for (const point of points)
    if (!strict.length || point.x > strict[strict.length - 1].x)
      strict.push(point)
  if (strict.length < 2) return undefined
  const linear =
    strict.length === 2 &&
    strict[0].x === 0 &&
    strict[0].y === 0 &&
    strict[1].x === 1 &&
    strict[1].y === 1
  return linear ? undefined : strict
}

const clamp = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value)
const round = (value: number) => Math.round(value * 1e6) / 1e6

type Sensor = { id: string; curve?: string }

function readSensors(xml: string | undefined): Sensor[] {
  if (!xml) return []
  const root = /<params\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/params>|$)/.exec(xml)
  if (!root) return []
  const id = attributes(root[1]).get("id") ?? "pressure"
  const body = root[3] ?? ""
  if (id !== "sensorslist")
    return [{ id, curve: /<curve>([^<]*)<\/curve>/.exec(body)?.[1] }]
  return [
    ...body.matchAll(
      /<ChildSensor\b([^>]*?)(?:\/>|>([\s\S]*?)<\/ChildSensor>)/g
    ),
  ].map((child) => ({
    id: attributes(child[1]).get("id") ?? "pressure",
    curve: /<curve>([^<]*)<\/curve>/.exec(child[2] ?? "")?.[1],
  }))
}

/**
 * How one Krita option reaches a Velura target. `range` is the target value
 * at the curve's 0 and 1, given the option's strength.
 */
type OptionRule = {
  target: DynamicsTarget
  mix: DynamicsMix
  range: (value: number, source: DynamicsSource) => [number, number]
}

const scale: OptionRule["range"] = (value) => [0, value]

const OPTIONS: ReadonlyArray<[string, OptionRule]> = [
  ["Size", { target: "size", mix: "multiply", range: scale }],
  // Velura's opacity target is read once a stroke; Krita's is per dab, which
  // in Velura is flow.
  ["Opacity", { target: "flow", mix: "multiply", range: scale }],
  ["Flow", { target: "flow", mix: "multiply", range: scale }],
  ["Ratio", { target: "roundness", mix: "multiply", range: scale }],
  [
    "Rotation",
    {
      target: "angle",
      mix: "add",
      // Krita turns counter-clockwise, Velura clockwise; a source that is
      // itself a clockwise turn already agrees with the stroke.
      range: (value, source) =>
        CLOCKWISE_SOURCES.has(source) ? [0, value] : [0, -value],
    },
  ],
  ["Scatter", { target: "scatter", mix: "multiply", range: () => [0, 1] }],
  ["Darken", { target: "lightness", mix: "add", range: (v) => [0, -v] }],
  // Krita's colour options sit neutral at the curve's midpoint.
  ["h", { target: "hue", mix: "add", range: (v) => [-v / 2, v / 2] }],
  ["s", { target: "saturation", mix: "add", range: (v) => [-v, v] }],
  ["v", { target: "lightness", mix: "add", range: (v) => [-v, v] }],
]

/**
 * Options with no enable checkbox in Krita, so no `Pressure*` flag is written
 * for them: they are on unless a flag says otherwise.
 */
const ALWAYS_ON = new Set(["Opacity", "Flow"])

/** Options Krita's paintbrush has and Velura does not, by their report line. */
const UNSUPPORTED_OPTIONS: ReadonlyArray<[string, string]> = [
  ["Sharpness", "sharpness option"],
  ["Softness", "softness option"],
  ["Spacing", "spacing sensor"],
  ["Mirror", "mirror option"],
  ["Mix", "mix option"],
  ["Rate", "airbrush rate option"],
  ["SmudgeRate", "smudge option"],
  ["ColorRate", "colour rate option"],
]

const COMBINE_MODES = ["multiply"]

function number(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? NaN : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const flag = (value: string | undefined) => value === "true"

/** A turn in [0, 1), from Krita's counter-clockwise radians. */
function turnFromRadians(radians: number): number {
  const turn = -radians / (2 * Math.PI)
  return round(turn - Math.floor(turn))
}

/** A default tip radius when nothing says how big an image tip is. */
const FALLBACK_RADIUS = 10

function translateShape(
  definition: string | undefined,
  options: KritaTranslateOptions,
  dropped: string[]
): BrushShape {
  const brush = /<Brush\b([^>]*)>?/.exec(definition ?? "")
  if (!brush) {
    dropped.push("brush tip: no brush definition, drawn round")
    return {
      radius: FALLBACK_RADIUS,
      feather: 1,
      roundness: 1,
      angle: 0,
      spacing: 0.1,
    }
  }
  const attrs = attributes(brush[1])
  const type = attrs.get("type")
  let spacing = number(attrs.get("spacing"), 0.1)
  if (attrs.get("useAutoSpacing") === "1") {
    spacing = 0.1 * number(attrs.get("autoSpacingCoeff"), 1)
    dropped.push("auto spacing: approximated as a fixed spacing")
  }
  let angle = turnFromRadians(number(attrs.get("angle"), 0))

  if (type === "auto_brush") {
    const mask = /<MaskGenerator\b([^>]*)>?/.exec(definition ?? "")
    const generator = attributes(mask?.[1] ?? "")
    const radius = number(generator.get("diameter"), 2 * FALLBACK_RADIUS) / 2
    let ratio = number(generator.get("ratio"), 1)
    if (ratio > 1) {
      ratio = 1 / ratio
      angle = round((angle + 0.25) % 1)
    }
    const fade = clamp(
      Math.min(
        number(generator.get("hfade"), 1),
        number(generator.get("vfade"), 1)
      )
    )
    if (generator.get("type") === "rect")
      dropped.push("square mask: drawn as an ellipse")
    if (number(generator.get("spikes"), 2) !== 2) dropped.push("mask spikes")
    if (number(attrs.get("randomness"), 0) !== 0)
      dropped.push("mask randomness")
    if (number(attrs.get("density"), 1) !== 1) dropped.push("mask density")
    return {
      radius: round(radius),
      // Fade is how far out the falloff starts: one is a hard rim.
      feather: round(radius * (1 - fade)),
      roundness: round(Math.max(0.01, ratio)),
      angle,
      spacing: round(Math.max(0.01, spacing)),
    }
  }

  if (type === "png_brush" || type === "gbr_brush" || type === "abr_brush") {
    const file = attrs.get("filename") ?? ""
    const id = kritaTextureId(file)
    const tip = options.tip?.(id)
    const shape: BrushShape = {
      radius: FALLBACK_RADIUS,
      feather: 0,
      roundness: 1,
      angle,
      spacing: round(Math.max(0.01, spacing)),
    }
    if (!tip) {
      dropped.push(`tip image ${file}: not shipped, drawn round`)
      shape.feather = 1
      return shape
    }
    shape.radius = round(
      (number(attrs.get("scale"), 1) * Math.max(tip.width, tip.height)) / 2
    )
    shape.tipTextureId = id
    if (tip.selection) shape.tipSelection = gimpTipSelection(tip.selection)
    return shape
  }

  dropped.push(`brush tip of type ${type ?? "unknown"}: drawn round`)
  return {
    radius: FALLBACK_RADIUS,
    feather: 1,
    roundness: 1,
    angle,
    spacing: 0.1,
  }
}

/**
 * The modulators one option produces, one per sensor it reads. Krita combines
 * a sensor list by multiplying, which is what consecutive multiplies do;
 * other combinations are reported rather than approximated.
 */
function optionModulators(
  label: string,
  rule: OptionRule,
  sensorXml: string | undefined,
  value: number,
  combineMode: string | undefined,
  dropped: string[]
): Modulator[] {
  const sensors = readSensors(sensorXml)
  if (
    sensors.length > 1 &&
    combineMode &&
    !["0", ...COMBINE_MODES].includes(combineMode)
  )
    dropped.push(
      `${label}: sensor combination mode ${combineMode}, multiplied instead`
    )
  const out: Modulator[] = []
  for (const sensor of sensors) {
    const source = SOURCES[sensor.id]
    if (!source) {
      dropped.push(`${label}: ${sensor.id} sensor`)
      continue
    }
    const modulator: Modulator = {
      source,
      target: rule.target,
      range: rule.range(round(value), source).map(round) as [number, number],
      mix: rule.mix,
    }
    const curve = parseCurve(sensor.curve, MIRRORED.has(sensor.id))
    if (curve) modulator.curve = curve
    out.push(modulator)
  }
  return out
}

export function translateKritaPreset(
  preset: KritaPreset,
  options: KritaTranslateOptions = {}
): KritaTranslation {
  const colourSmudge = preset.engine === "colorsmudge"
  if (preset.engine !== "paintbrush" && !colourSmudge)
    throw new Error(
      `Only Krita's pixel brush and colour-smudge engines can be imported, not ${preset.engine || "an unknown one"}.`
    )
  const p = preset.params
  const dropped: string[] = []
  const name = kritaPresetName(preset.name) || "Krita brush"
  const shape = translateShape(p.get("brush_definition"), options, dropped)
  const brush: Brush = {
    id:
      options.id ??
      `krita:${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}`,
    name,
    shape,
    rendering: { accumulation: "buildup", opacity: 1, flow: 1 },
    dynamics: [],
  }

  for (const [option, rule] of OPTIONS) {
    const enabled = p.get(`Pressure${option}`)
    if (ALWAYS_ON.has(option) ? enabled === "false" : !flag(enabled)) continue
    const value = number(p.get(`${option}Value`), 1)
    if (option === "Scatter") {
      const x = p.get("Scattering/AxisX") !== "false"
      const y = p.get("Scattering/AxisY") !== "false"
      if (x && !y)
        dropped.push("scatter along the stroke only: scattered across")
      const scatter: BrushScatter = {
        amount: round(Math.min(MAX_SCATTER_AMOUNT, value * 2)),
        count: 1,
        axes: x ? "both" : "across",
      }
      brush.scatter = scatter
    }
    if (p.get(`${option}UseCurve`) === "false") {
      // No sensor: Krita applies the strength as a constant.
      if (option === "Size")
        shape.radius = round(Math.max(0.5, shape.radius * value))
      // Opacity is per dab in Krita, as flow is, so the two compound.
      else if (option === "Opacity" || option === "Flow")
        brush.rendering.flow = round(clamp(brush.rendering.flow * value))
      else if (option === "Ratio")
        shape.roundness = round(Math.max(0.01, shape.roundness * value))
      else if (option !== "Scatter")
        dropped.push(`constant ${option} of ${value}`)
      continue
    }
    if (
      option === "Flow" &&
      brush.dynamics.some((modulator) => modulator.target === "flow")
    ) {
      // Both would land on flow, and pressure applied twice is not what
      // either option meant.
      dropped.push("flow sensor: opacity's drives flow instead")
      continue
    }
    brush.dynamics.push(
      ...optionModulators(
        option,
        rule,
        p.get(`${option}Sensor`),
        value,
        p.get(`${option}curveMode`),
        dropped
      )
    )
  }

  if (colourSmudge) translateColourSmudge(p, brush, dropped)

  for (const [option, label] of UNSUPPORTED_OPTIONS)
    if (colourSmudge && (option === "SmudgeRate" || option === "ColorRate"))
      continue
    else if (flag(p.get(`Pressure${option}`))) dropped.push(label)

  const grain = translateTexture(p, brush, dropped)
  if (grain && options.grain && !options.grain(grain.textureId))
    dropped.push(`paper ${grain.textureId}: not shipped`)
  else if (grain) brush.grain = grain

  if (
    flag(p.get("HorizontalMirrorEnabled")) ||
    flag(p.get("VerticalMirrorEnabled"))
  )
    dropped.push("mirroring")
  if (flag(p.get("MaskingBrush/Enabled"))) dropped.push("masked brush")
  if (flag(p.get("PaintOpSettings/isAirbrushing"))) dropped.push("airbrushing")
  const source = p.get("ColorSource/Type")
  if (source && source !== "plain") dropped.push(`colour source ${source}`)
  const composite = p.get("CompositeOp")
  if (composite && composite !== "normal")
    dropped.push(`blending mode ${composite}`)

  return { brush, dropped }
}

/** Rate strengths live on the brush; sensor ranges scale them exactly once. */
function translateColourSmudge(
  p: ReadonlyMap<string, string>,
  brush: Brush,
  dropped: string[]
): void {
  const pickup = round(clamp(number(p.get("SmudgeRateValue"), 1)))
  const flow =
    p.get("PressureColorRate") === "false"
      ? 0
      : round(clamp(number(p.get("ColorRateValue"), 1)))
  brush.rendering.wet = { pickup }
  brush.rendering.flow = round(brush.rendering.flow * flow)
  for (const [option, target, value] of [
    ["SmudgeRate", "pickup", pickup],
    ["ColorRate", "flow", flow],
  ] as const) {
    if (value === 0 || p.get(`${option}UseCurve`) === "false") continue
    brush.dynamics.push(
      ...optionModulators(
        option,
        { target, mix: "multiply", range: scale },
        p.get(`${option}Sensor`),
        1,
        p.get(`${option}curveMode`),
        dropped
      )
    )
  }
  if (flag(p.get("PressureSmudgeRadius"))) dropped.push("smudge radius option")
  if (p.has("SmudgeRateMode")) dropped.push("smearing/dulling mode switch")
  if (flag(p.get("MergedPaint"))) dropped.push("overlay mode")
}

function translateTexture(
  p: ReadonlyMap<string, string>,
  brush: Brush,
  dropped: string[]
): BrushGrain | undefined {
  if (!flag(p.get("Texture/Pattern/Enabled"))) return undefined
  const file =
    p.get("Texture/Pattern/Name") || p.get("Texture/Pattern/PatternFileName")
  if (!file) {
    dropped.push("texture: no pattern named")
    return undefined
  }
  const strength = clamp(number(p.get("Texture/Strength/Value"), 1))
  if (
    flag(p.get("PressureTexture/Strength/")) &&
    p.get("Texture/Strength/UseCurve") !== "false"
  )
    brush.dynamics.push(
      ...optionModulators(
        "Texture strength",
        { target: "grainDepth", mix: "multiply", range: scale },
        p.get("Texture/Strength/Sensor"),
        1,
        p.get("Texture/Strength/curveMode"),
        dropped
      )
    )
  if (flag(p.get("Texture/Pattern/Invert"))) dropped.push("texture invert")
  if (number(p.get("Texture/Pattern/Brightness"), 0) !== 0)
    dropped.push("texture brightness")
  if (number(p.get("Texture/Pattern/Contrast"), 1) !== 1)
    dropped.push("texture contrast")
  const left = number(p.get("Texture/Pattern/CutoffLeft"), 0)
  const right = number(p.get("Texture/Pattern/CutoffRight"), 255)
  if (left > 0 || right < 254) dropped.push("texture cutoff")
  return {
    textureId: kritaTextureId(file),
    scale: round(Math.max(0.01, number(p.get("Texture/Pattern/Scale"), 1))),
    depth: round(strength),
    movement: 0,
  }
}
