import {
  MAX_TAPER,
  type BezierPath,
  type PathNode,
  type Taper,
} from "../doc/vector-path"

/** How a profile stroke's two ends are finished; "style" keeps the shape style's cap. */
export type ProfileCap = "style" | "round" | "flat"

/**
 * A width-profile brush: how pressure, speed and seeded noise turn a spine
 * into per-node widths and positions. Every share is of the stroke's width.
 */
export type ProfileParams = Readonly<{
  pressure: boolean
  /** The exponent pressure is raised to: above 1 needs a firmer hand. */
  pressureCurve: number
  /** How much a fast hand thins the line, set as it is drawn. */
  thinning: number
  /** The narrowest the line gets, however light or fast. */
  minWidth: number
  taper: Taper
  caps: ProfileCap
  /** How loosely the spine is fitted to the hand. */
  smoothing: number
  /** Seeded width noise. */
  tremor: number
  /** Seeded noise along the normal. */
  wiggle: number
  /**
   * A calligraphy nib's angle, in degrees from the x axis; profile brushes
   * ignore it. A calligraphy brush's `minWidth` is the nib's edge.
   */
  nibAngle: number
  /** How far the nib holds its angle (1) rather than following tilt (0). */
  fixation: number
}>

/** Whether a pattern's tile is drawn once along the stroke, or end to end. */
export type PatternMode = "stretch" | "repeat"
/**
 * How a pattern meets a sharp corner: bent round it, or begun afresh on
 * each side of it.
 */
export type PatternCorners = "bend" | "split"

/**
 * Art laid along a spine axis: the x axis, from 0 to `length`, with y across
 * it. Both are in stroke widths, so y from -0.5 to 0.5 spans the stroke.
 */
export type PatternPiece = Readonly<{
  paths: readonly BezierPath[]
  length: number
}>

export type PatternParams = Readonly<{
  mode: PatternMode
  corners: PatternCorners
  tile: PatternPiece
  /** Drawn once at the stroke's start and end; the tile fills between. */
  start: PatternPiece | null
  end: PatternPiece | null
  /** The art it was made from, kept so caps and axis can be reassigned. */
  source?: PatternSourceArt | null
}>

/**
 * A selected object's art in document coordinates, and its open path when
 * it could be drawn as the axis.
 */
export type PatternShape = Readonly<{
  id: string
  paths: readonly BezierPath[]
  line: BezierPath | null
}>

/**
 * The line a pattern's art is laid along: across the middle of the art,
 * left to right or top to bottom, or an open path among the selection.
 */
export type PatternAxis =
  | "horizontal"
  | "vertical"
  | Readonly<{ drawn: string }>

/** Which selected objects are caps, and the axis the art lies on. */
export type PatternSource = Readonly<{
  start?: readonly string[]
  end?: readonly string[]
  axis?: PatternAxis
}>

/** The objects a pattern was made from, and how they were assigned. */
export type PatternSourceArt = Readonly<{
  shapes: readonly PatternShape[]
  made: PatternSource
}>

/**
 * Copies of `art` dropped along the stroke. The art is a pattern piece
 * centred on each place; lengths are in stroke widths, jitters are shares
 * of their widest swing, varied per copy by the stroke's seed.
 */
export type ScatterParams = Readonly<{
  art: PatternPiece
  /** From one copy's centre to the next, along the stroke. */
  spacing: number
  /** The art's height. */
  size: number
  /** Up to this share smaller or larger. */
  sizeJitter: number
  /** Up to this share of a half turn either way. */
  rotationJitter: number
  /** Up to this many stroke widths off the spine, either side. */
  offsetJitter: number
  /** Turned to follow the stroke, or kept upright. */
  align: boolean
}>

type BrushBase = Readonly<{
  id: string
  name: string
  params: ProfileParams
}>

/** Only a pattern brush has `pattern`, and only a scatter brush `scatter`. */
export type VectorBrush = BrushBase &
  Readonly<
    | { kind: "profile"; pattern?: never; scatter?: never }
    | { kind: "calligraphy"; pattern?: never; scatter?: never }
    | { kind: "pattern"; pattern: PatternParams; scatter?: never }
    | { kind: "scatter"; scatter: ScatterParams; pattern?: never }
  >

export type VectorBrushKind = VectorBrush["kind"]
/** The kinds that lay art made from a selection along the stroke. */
export type ArtBrushKind = "pattern" | "scatter"
export type ArtBrush<K extends ArtBrushKind = ArtBrushKind> = Extract<
  VectorBrush,
  { kind: K }
>

export const MIN_PRESSURE_CURVE = 0.25
/** More nodes than any brush's art needs; past it, a selection is too busy to deform live. */
export const MAX_PATTERN_NODES = 2000
/** The longest a piece of art may be, in stroke widths. */
/** The most nodes a pattern's kept source art, axis line included, may have. */
export const MAX_PATTERN_SOURCE_NODES = MAX_PATTERN_NODES * 2
export const MAX_PATTERN_LENGTH = 1000
export const MAX_PRESSURE_CURVE = 4
/** The closest and furthest scatter copies may be spaced, in stroke widths. */
export const MIN_SCATTER_SPACING = 0.1
export const MAX_SCATTER_SPACING = 50
/** The smallest and largest scatter art may be, in stroke widths. */
export const MIN_SCATTER_SIZE = 0.05
export const MAX_SCATTER_SIZE = 10
/** The furthest a scatter copy may jitter off the spine, in stroke widths. */
export const MAX_SCATTER_OFFSET = 10

/** What a brush saved before profiles had reads as: the plain pressure fit. */
const NEUTRAL: Omit<ProfileParams, "pressure" | "taper"> = {
  pressureCurve: 1,
  thinning: 0,
  minWidth: 0,
  caps: "style",
  smoothing: 0,
  tremor: 0,
  wiggle: 0,
  nibAngle: 45,
  fixation: 1,
}

const profile = (
  params: Partial<ProfileParams> & Pick<ProfileParams, "pressure">
): ProfileParams => ({
  ...NEUTRAL,
  taper: { start: 0, end: 0 },
  ...params,
})

/** A closed outline through `points`, straight from each to the next. */
function outline(points: readonly (readonly [number, number])[]): BezierPath {
  return {
    kind: "path",
    closed: true,
    nodes: points.map(([x, y]) => ({
      x,
      y,
      in: null,
      out: null,
      type: "cusp",
    })),
  }
}

/** A band along the axis, `half(x)` either side of it. */
function band(length: number, half: (x: number) => number): BezierPath {
  const xs = Array.from({ length: 25 }, (_, i) => (length * i) / 24)
  return outline([
    ...xs.map((x) => [x, -half(x)] as const),
    ...xs.toReversed().map((x) => [x, half(x)] as const),
  ])
}

/** A pointed leaf from `from` to `to` along the axis, on `side` of it. */
function leaf(from: number, to: number, side: 1 | -1): BezierPath {
  const ts = Array.from({ length: 9 }, (_, i) => i / 8)
  const at = (t: number) => from + (to - from) * t
  return outline([
    ...ts.map((t) => [at(t), side * (0.05 + 0.45 * t)] as const),
    ...ts
      .toReversed()
      .map((t) => [at(t), side * (0.05 + 0.45 * t * t)] as const),
  ])
}

const pattern = (
  mode: PatternMode,
  corners: PatternCorners,
  tile: PatternPiece,
  start: PatternPiece | null = null,
  end: PatternPiece | null = null
): PatternParams => ({ mode, corners, tile, start, end })

/** An outline round `r(θ)` about the middle of a one-tall piece. */
function polarPiece(
  count: number,
  r: (angle: number, i: number) => readonly [number, number]
): PatternPiece {
  const points = Array.from({ length: count }, (_, i) =>
    r((2 * Math.PI * i) / count, i)
  )
  const ys = points.map(([, y]) => y),
    xs = points.map(([x]) => x)
  const height = Math.max(...ys) - Math.min(...ys)
  const minX = Math.min(...xs),
    middle = (Math.max(...ys) + Math.min(...ys)) / 2
  return {
    length: (Math.max(...xs) - minX) / height,
    paths: [
      outline(
        points.map(([x, y]) => [(x - minX) / height, (y - middle) / height])
      ),
    ],
  }
}

const scatter = (
  art: PatternPiece,
  params: Omit<ScatterParams, "art">
): ScatterParams => ({ art, ...params })

export const BUILTIN_VECTOR_BRUSHES: readonly VectorBrush[] = [
  {
    id: "vector:solid",
    name: "Solid",
    kind: "profile",
    params: profile({ pressure: false }),
  },
  {
    id: "vector:pressure",
    name: "Pressure",
    kind: "profile",
    params: profile({ pressure: true }),
  },
  {
    id: "vector:fineliner",
    name: "Fineliner",
    kind: "profile",
    params: profile({ pressure: false, caps: "round", smoothing: 0.3 }),
  },
  {
    id: "vector:technical-pen",
    name: "Technical pen",
    kind: "profile",
    params: profile({ pressure: false, caps: "flat", smoothing: 0.5 }),
  },
  {
    id: "vector:dip-pen",
    name: "Dip pen",
    kind: "profile",
    params: profile({
      caps: "round",
      pressure: true,
      pressureCurve: 2,
      thinning: 0.3,
      minWidth: 0.1,
      taper: { start: 0.15, end: 0.25 },
    }),
  },
  {
    id: "vector:brush-pen",
    name: "Brush pen",
    kind: "profile",
    params: profile({
      caps: "round",
      pressure: true,
      pressureCurve: 0.7,
      thinning: 0.5,
      minWidth: 0.05,
      taper: { start: 0.3, end: 0.4 },
      smoothing: 0.4,
    }),
  },
  {
    id: "vector:marker",
    name: "Marker",
    kind: "profile",
    params: profile({ pressure: false, caps: "flat", tremor: 0.06 }),
  },
  {
    id: "vector:wiggly",
    name: "Wiggly",
    kind: "profile",
    params: profile({ caps: "round", pressure: false, wiggle: 0.6 }),
  },
  {
    id: "vector:splotchy",
    name: "Splotchy",
    kind: "profile",
    params: profile({
      caps: "round",
      pressure: true,
      minWidth: 0.3,
      tremor: 0.7,
    }),
  },
  {
    id: "vector:broad-nib",
    name: "Broad nib",
    kind: "calligraphy",
    params: profile({
      pressure: false,
      caps: "flat",
      minWidth: 0.12,
      nibAngle: 30,
      smoothing: 0.3,
    }),
  },
  {
    id: "vector:italic",
    name: "Italic",
    kind: "calligraphy",
    params: profile({
      pressure: true,
      pressureCurve: 0.6,
      caps: "flat",
      minWidth: 0.08,
      nibAngle: 45,
      taper: { start: 0.05, end: 0.1 },
      smoothing: 0.4,
    }),
  },
  {
    id: "vector:pointed-tilt-nib",
    name: "Pointed tilt nib",
    kind: "calligraphy",
    params: profile({
      pressure: true,
      caps: "round",
      minWidth: 0.05,
      nibAngle: 60,
      fixation: 0.2,
      taper: { start: 0.2, end: 0.3 },
    }),
  },
  {
    id: "vector:ribbon",
    name: "Ribbon",
    kind: "pattern",
    params: profile({ pressure: false }),
    pattern: pattern("repeat", "bend", {
      length: 3,
      paths: [
        band(3, (x) => 0.12 + 0.38 * Math.abs(Math.cos((Math.PI * x) / 3))),
      ],
    }),
  },
  {
    id: "vector:rope",
    name: "Rope",
    kind: "pattern",
    params: profile({ pressure: false }),
    pattern: pattern("repeat", "bend", {
      length: 1,
      paths: [
        outline([
          [0, -0.5],
          [0.45, -0.5],
          [0.95, 0.5],
          [0.5, 0.5],
        ]),
      ],
    }),
  },
  {
    id: "vector:vine",
    name: "Vine",
    kind: "pattern",
    params: profile({ pressure: false }),
    pattern: pattern("repeat", "bend", {
      length: 4,
      paths: [
        outline([
          [0, -0.06],
          [4, -0.06],
          [4, 0.06],
          [0, 0.06],
        ]),
        leaf(0.6, 1.8, -1),
        leaf(2.6, 3.8, 1),
      ],
    }),
  },
  {
    id: "vector:tapered-stroke",
    name: "Tapered stroke",
    kind: "pattern",
    params: profile({ pressure: true }),
    pattern: pattern("stretch", "bend", {
      length: 10,
      paths: [band(10, (x) => 0.5 * Math.sin((Math.PI * x) / 10) ** 0.6)],
    }),
  },
  {
    id: "vector:arrow",
    name: "Arrow",
    kind: "pattern",
    params: profile({ pressure: false }),
    pattern: pattern(
      "stretch",
      "bend",
      {
        length: 1,
        paths: [
          outline([
            [0, -0.12],
            [1, -0.12],
            [1, 0.12],
            [0, 0.12],
          ]),
        ],
      },
      {
        length: 0.8,
        paths: [
          outline([
            [0, -0.35],
            [0.8, -0.12],
            [0.8, 0.12],
            [0, 0.35],
            [0.3, 0],
          ]),
        ],
      },
      {
        length: 1.5,
        paths: [
          outline([
            [0, -0.5],
            [1.5, 0],
            [0, 0.5],
          ]),
        ],
      }
    ),
  },
  {
    id: "vector:dots",
    name: "Dots",
    kind: "scatter",
    params: profile({ pressure: true }),
    scatter: scatter(
      polarPiece(24, (a) => [Math.cos(a), Math.sin(a)]),
      {
        spacing: 1.5,
        size: 1,
        sizeJitter: 0,
        rotationJitter: 0,
        offsetJitter: 0,
        align: false,
      }
    ),
  },
  {
    id: "vector:stars",
    name: "Stars",
    kind: "scatter",
    params: profile({ pressure: false }),
    scatter: scatter(
      polarPiece(10, (a, i) => {
        const r = i % 2 ? 0.4 : 1
        return [r * Math.sin(a), -r * Math.cos(a)]
      }),
      {
        spacing: 2,
        size: 1.4,
        sizeJitter: 0.4,
        rotationJitter: 0.2,
        offsetJitter: 0.6,
        align: false,
      }
    ),
  },
  {
    id: "vector:confetti",
    name: "Confetti",
    kind: "scatter",
    params: profile({ pressure: false }),
    scatter: scatter(
      {
        length: 2,
        paths: [
          outline([
            [0, -0.5],
            [2, -0.5],
            [2, 0.5],
            [0, 0.5],
          ]),
        ],
      },
      {
        spacing: 1,
        size: 0.4,
        sizeJitter: 0.5,
        rotationJitter: 1,
        offsetJitter: 1.5,
        align: false,
      }
    ),
  },
  {
    id: "vector:leaves",
    name: "Leaves",
    kind: "scatter",
    params: profile({ pressure: false }),
    scatter: scatter(
      polarPiece(24, (a) => [
        1.5 * Math.cos(a),
        0.5 * Math.sin(a) * (1 + Math.cos(a)) * 0.9,
      ]),
      {
        spacing: 1.2,
        size: 0.8,
        sizeJitter: 0.3,
        rotationJitter: 0.25,
        offsetJitter: 0.3,
        align: true,
      }
    ),
  },
  {
    id: "vector:hearts",
    name: "Hearts",
    kind: "scatter",
    params: profile({ pressure: false }),
    scatter: scatter(
      // The classic heart curve, point down.
      polarPiece(32, (a) => [
        16 * Math.sin(a) ** 3,
        -(
          13 * Math.cos(a) -
          5 * Math.cos(2 * a) -
          2 * Math.cos(3 * a) -
          Math.cos(4 * a)
        ),
      ]),
      {
        spacing: 1.8,
        size: 1,
        sizeJitter: 0.2,
        rotationJitter: 0.1,
        offsetJitter: 0,
        align: false,
      }
    ),
  },
]

const share = (value: unknown, max = 1): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= max

export function parseVectorBrush(value: unknown): VectorBrush {
  const brush = value as VectorBrush
  const params = { ...NEUTRAL, ...brush?.params } as ProfileParams
  if (
    !brush ||
    typeof brush.id !== "string" ||
    !brush.id.trim() ||
    brush.id.length > 200 ||
    typeof brush.name !== "string" ||
    !brush.name.trim() ||
    brush.name.length > 100 ||
    !Object.hasOwn(KIND_FIELDS, brush.kind) ||
    typeof params.pressure !== "boolean" ||
    !share(params.taper?.start, MAX_TAPER) ||
    !share(params.taper?.end, MAX_TAPER) ||
    typeof params.pressureCurve !== "number" ||
    !(params.pressureCurve >= MIN_PRESSURE_CURVE) ||
    !(params.pressureCurve <= MAX_PRESSURE_CURVE) ||
    ![
      params.thinning,
      params.minWidth,
      params.smoothing,
      params.tremor,
      params.wiggle,
      params.fixation,
    ].every((v) => share(v)) ||
    !share(params.nibAngle, 180) ||
    !["style", "round", "flat"].includes(params.caps)
  )
    throw new Error("A vector brush needs an id, name and valid parameters.")
  return {
    id: brush.id,
    name: brush.name.trim().replace(/\s+/g, " "),
    params: {
      pressure: params.pressure,
      pressureCurve: params.pressureCurve,
      thinning: params.thinning,
      minWidth: params.minWidth,
      taper: { start: params.taper.start, end: params.taper.end },
      caps: params.caps,
      smoothing: params.smoothing,
      tremor: params.tremor,
      wiggle: params.wiggle,
      nibAngle: params.nibAngle,
      fixation: params.fixation,
    },
    ...KIND_FIELDS[brush.kind](brush),
  } as VectorBrush
}

/**
 * Each kind's own fields, copied down from a saved brush; throws on bad
 * ones. A new kind is one entry here, one in `ART_OUTLINES` and one in the
 * library's `KINDS`.
 */
const KIND_FIELDS: {
  [K in VectorBrushKind]: (
    brush: Record<string, unknown>
  ) => Omit<Extract<VectorBrush, { kind: K }>, keyof BrushBase>
} = {
  profile: () => ({ kind: "profile" }),
  calligraphy: () => ({ kind: "calligraphy" }),
  pattern: (brush) => ({
    kind: "pattern",
    pattern: parsePattern(brush.pattern),
  }),
  scatter: (brush) => ({
    kind: "scatter",
    scatter: parseScatter(brush.scatter),
  }),
}

const finite = (...values: unknown[]) =>
  values.every((v) => typeof v === "number" && Number.isFinite(v))

/** A pattern's art, copied down to the fields it uses; throws on anything else. */
function parsePattern(value: unknown): PatternParams {
  const art = value as PatternParams
  const piece = pieceParser()
  try {
    if (
      !art ||
      !["stretch", "repeat"].includes(art.mode) ||
      !["bend", "split"].includes(art.corners)
    )
      throw new Error("bad pattern")
    const source = parseSourceArt(art.source)
    return {
      mode: art.mode,
      corners: art.corners,
      tile: piece(art.tile),
      start: art.start ? piece(art.start) : null,
      end: art.end ? piece(art.end) : null,
      ...(source && { source }),
    }
  } catch {
    throw new Error(
      `A pattern brush needs a tile of at most ${MAX_PATTERN_NODES} nodes, and a stretch or repeat mode.`
    )
  }
}

const ids = (value: unknown): string[] | undefined => {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
    throw new Error("bad ids")
  return [...value]
}

/**
 * The art a pattern was made from, copied down; null when missing or bad,
 * so a brush that cannot be remade still draws.
 */
function parseSourceArt(value: unknown): PatternSourceArt | null {
  const source = value as PatternSourceArt | null | undefined
  if (!source) return null
  try {
    let budget = MAX_PATTERN_SOURCE_NODES
    const path = (value: unknown, closed?: boolean): BezierPath => {
      const p = value as BezierPath
      if (!Array.isArray(p?.nodes) || p.nodes.length < 2)
        throw new Error("bad path")
      if ((budget -= p.nodes.length) < 0) throw new Error("too many")
      return {
        kind: "path",
        closed: closed ?? !!p.closed,
        nodes: p.nodes.map(parseNode),
      }
    }
    if (!Array.isArray(source.shapes) || !source.shapes.length)
      throw new Error("bad shapes")
    const shapes = source.shapes.map((shape): PatternShape => {
      if (typeof shape?.id !== "string" || !Array.isArray(shape.paths))
        throw new Error("bad shape")
      return {
        id: shape.id,
        paths: shape.paths.map((p: unknown) => path(p, true)),
        line: shape.line ? path(shape.line, false) : null,
      }
    })
    const made = source.made ?? {}
    const axis = made.axis
    if (
      axis !== undefined &&
      axis !== "horizontal" &&
      axis !== "vertical" &&
      typeof (axis as { drawn?: unknown })?.drawn !== "string"
    )
      throw new Error("bad axis")
    const start = ids(made.start),
      end = ids(made.end)
    return {
      shapes,
      made: {
        ...(start && { start }),
        ...(end && { end }),
        ...(axis !== undefined && {
          axis: typeof axis === "string" ? axis : { drawn: axis.drawn },
        }),
      },
    }
  } catch {
    return null
  }
}

const parsePoint = (p: unknown) => {
  const q = p as { x: number; y: number } | null
  if (q === null) return null
  if (!q || !finite(q.x, q.y)) throw new Error("bad point")
  return { x: q.x, y: q.y }
}

const parseNode = (n: PathNode): PathNode => {
  if (!n || !finite(n.x, n.y)) throw new Error("bad node")
  return {
    x: n.x,
    y: n.y,
    in: parsePoint(n.in ?? null),
    out: parsePoint(n.out ?? null),
    type: n.type === "smooth" ? "smooth" : "cusp",
  }
}

/** Reads pieces of art, at most `MAX_PATTERN_NODES` nodes between them. */
function pieceParser() {
  let budget = MAX_PATTERN_NODES
  const piece = (value: unknown): PatternPiece => {
    const p = value as PatternPiece
    if (
      !p ||
      !finite(p.length) ||
      !(p.length > 0) ||
      p.length > MAX_PATTERN_LENGTH ||
      !Array.isArray(p.paths) ||
      !p.paths.length
    )
      throw new Error("bad piece")
    return {
      length: p.length,
      paths: p.paths.map((path): BezierPath => {
        if (!Array.isArray(path?.nodes) || path.nodes.length < 2)
          throw new Error("bad path")
        if ((budget -= path.nodes.length) < 0) throw new Error("too many")
        return {
          kind: "path",
          closed: true,
          nodes: path.nodes.map(parseNode),
        }
      }),
    }
  }
  return piece
}

/** A scatter's art and placement, copied down; throws on anything else. */
function parseScatter(value: unknown): ScatterParams {
  const params = value as ScatterParams
  try {
    if (
      !params ||
      !finite(params.spacing, params.size) ||
      !(params.spacing >= MIN_SCATTER_SPACING) ||
      !(params.spacing <= MAX_SCATTER_SPACING) ||
      !(params.size >= MIN_SCATTER_SIZE) ||
      !(params.size <= MAX_SCATTER_SIZE) ||
      !share(params.sizeJitter) ||
      !share(params.rotationJitter) ||
      !share(params.offsetJitter, MAX_SCATTER_OFFSET) ||
      typeof params.align !== "boolean"
    )
      throw new Error("bad scatter")
    return {
      art: pieceParser()(params.art),
      spacing: params.spacing,
      size: params.size,
      sizeJitter: params.sizeJitter,
      rotationJitter: params.rotationJitter,
      offsetJitter: params.offsetJitter,
      align: params.align,
    }
  } catch {
    throw new Error(
      `A scatter brush needs art of at most ${MAX_PATTERN_NODES} nodes, and spacing, size and jitter in range.`
    )
  }
}
