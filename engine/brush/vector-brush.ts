import type { Taper } from "../doc/vector-path"

/** Kind-specific sections are extended by brush-library issues 09–12. */
export type VectorBrushKind = "profile" | "calligraphy" | "pattern" | "scatter"
export type VectorBrush = Readonly<{
  id: string
  name: string
  kind: "profile"
  params: Readonly<{ pressure: boolean; taper: Taper }>
}>

export const BUILTIN_VECTOR_BRUSHES: readonly VectorBrush[] = [
  {
    id: "vector:solid",
    name: "Solid",
    kind: "profile",
    params: { pressure: false, taper: { start: 0, end: 0 } },
  },
  {
    id: "vector:pressure",
    name: "Pressure",
    kind: "profile",
    params: { pressure: true, taper: { start: 0, end: 0 } },
  },
]

export function parseVectorBrush(value: unknown): VectorBrush {
  const brush = value as VectorBrush
  if (
    !brush ||
    typeof brush.id !== "string" ||
    !brush.id.trim() ||
    brush.id.length > 200 ||
    typeof brush.name !== "string" ||
    !brush.name.trim() ||
    brush.name.length > 100 ||
    brush.kind !== "profile" ||
    typeof brush.params?.pressure !== "boolean" ||
    ![brush.params.taper?.start, brush.params.taper?.end].every(
      (t) => typeof t === "number" && Number.isFinite(t) && t >= 0 && t <= 0.5
    )
  )
    throw new Error(
      "A vector brush needs an id, name and valid profile parameters."
    )
  return {
    id: brush.id,
    name: brush.name.trim().replace(/\s+/g, " "),
    kind: "profile",
    params: {
      pressure: brush.params.pressure,
      taper: { start: brush.params.taper.start, end: brush.params.taper.end },
    },
  }
}
