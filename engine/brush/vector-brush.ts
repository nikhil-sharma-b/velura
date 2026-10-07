import { MAX_TAPER, type Taper } from "../doc/vector-path"

/** Kind-specific sections are extended by brush-library issues 10–12. */
export type VectorBrushKind = "profile" | "calligraphy" | "pattern" | "scatter"

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
}>

export type VectorBrush = Readonly<{
  id: string
  name: string
  kind: "profile"
  params: ProfileParams
}>

export const MIN_PRESSURE_CURVE = 0.25
export const MAX_PRESSURE_CURVE = 4

/** What a brush saved before profiles had reads as: the plain pressure fit. */
const NEUTRAL: Omit<ProfileParams, "pressure" | "taper"> = {
  pressureCurve: 1,
  thinning: 0,
  minWidth: 0,
  caps: "style",
  smoothing: 0,
  tremor: 0,
  wiggle: 0,
}

const profile = (
  params: Partial<ProfileParams> & Pick<ProfileParams, "pressure">
): ProfileParams => ({
  ...NEUTRAL,
  taper: { start: 0, end: 0 },
  ...params,
})

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
    brush.kind !== "profile" ||
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
    ].every((v) => share(v)) ||
    !["style", "round", "flat"].includes(params.caps)
  )
    throw new Error(
      "A vector brush needs an id, name and valid profile parameters."
    )
  return {
    id: brush.id,
    name: brush.name.trim().replace(/\s+/g, " "),
    kind: "profile",
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
    },
  }
}
