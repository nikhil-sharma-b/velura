/**
 * Painted areas as polygons, for export: a stroke's outline as one shape
 * rather than its triangles, and an object with the eraser marks drawn
 * after it subtracted, as Illustrator and Affinity cut paths when you
 * erase. The canvas still draws triangles; only files written for other
 * editors need the shapes.
 *
 * Areas come from the same meshes the canvas draws. A fill's fan triangles,
 * kept with their signs, wind exactly as its outline does, so the polygon
 * library's fill rule recovers the outline; a stroke's triangles all turned
 * one way and read nonzero are their union.
 */

import {
  EndType,
  FillRule,
  JoinType,
  inflatePaths,
  simplifyPaths,
  difference,
  intersect,
  union,
  type Point64 as IPoint64,
  type Path64,
  type Paths64,
} from "@countertype/clipper2-ts"
import type { Bounds, Mesh } from "./tessellate"

/** Polygon coordinates are integers: hundredths of a document pixel. */
const SCALE = 100

/**
 * How far, 0.05 px, a written outline may stray from the triangles' edge:
 * points closer than that to the line through their neighbours are
 * dropped. A fifth of the canvas's own flattening tolerance, so the
 * outline still matches what the canvas draws.
 */
const SIMPLIFY = 0.05 * SCALE

/** The widest seam between a stroke's pieces that is closed: 0.02 px. */
const SEAM = 0.02 * SCALE

export type Region = Paths64

/** Twice the signed area of a triangle. */
function cross(a: IPoint64, b: IPoint64, c: IPoint64): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** A mesh's triangles as polygon paths, and the fill rule that reads them as it paints. */
function meshPaths(mesh: Mesh): { paths: Paths64; rule: FillRule } {
  const v = mesh.vertices,
    paths: Paths64 = []
  for (let i = 0; i < v.length; i += 6) {
    const a = { x: Math.round(v[i] * SCALE), y: Math.round(v[i + 1] * SCALE) }
    let b = { x: Math.round(v[i + 2] * SCALE), y: Math.round(v[i + 3] * SCALE) }
    let c = { x: Math.round(v[i + 4] * SCALE), y: Math.round(v[i + 5] * SCALE) }
    const turn = cross(a, b, c)
    if (!turn) continue
    if (mesh.rule === "union" && turn < 0) [b, c] = [c, b]
    paths.push([a, b, c] as Path64)
  }
  return {
    paths,
    rule: mesh.rule === "evenodd" ? FillRule.EvenOdd : FillRule.NonZero,
  }
}

/** The area a mesh paints, as non-overlapping rings. */
export function meshRegion(mesh: Mesh): Region {
  const { paths, rule } = meshPaths(mesh)
  const joined = union(paths, rule)
  if (mesh.rule !== "union") return joined
  // A stroke's pieces (band, joins, caps) are placed separately in floats
  // and can miss each other by a few thousandths of a pixel, which leaves
  // a cap as its own ring beside the band. Growing the outline by a hair
  // and shrinking it back closes those seams and nothing visible.
  const grown = inflatePaths(joined, SEAM, JoinType.Miter, EndType.Polygon, 2)
  return inflatePaths(grown, -SEAM, JoinType.Miter, EndType.Polygon, 2)
}

/**
 * What a mesh paints once every one of `erasers` is taken from it, or null
 * when none of them meets it. Rings from a union wind outward positive and
 * holes negative, so the erasers read together nonzero are their union
 * without forming it first. The mesh is joined into rings first: cut as
 * loose triangles, a hole comes out as a slit ring rather than its own ring.
 */
export function cutMesh(mesh: Mesh, erasers: readonly Region[]): Region | null {
  const region = meshRegion(mesh),
    clip = erasers.flat()
  if (!intersect(region, clip, FillRule.NonZero).length) return null
  return difference(region, clip, FillRule.NonZero)
}

/** One region of several, as one eraser's fill and stroke erase together. */
export function unionRegions(regions: readonly Region[]): Region {
  return union(regions.flat(), FillRule.NonZero)
}

/** A ring without repeated points or points on a straight run, which the triangles leave behind. */
function tidy(ring: Path64): Path64 {
  const out: Path64 = []
  // On one line and between its neighbours: a point that doubles back is
  // a spike, part of the shape, and stays.
  const straight = (a: IPoint64, b: IPoint64, c: IPoint64) =>
    cross(a, b, c) === 0 &&
    (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y) <= 0
  for (const p of ring) {
    while (
      out.length >= 2 &&
      straight(out[out.length - 2], out[out.length - 1], p)
    )
      out.pop()
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push(p)
  }
  // Then the seam, where the ring's end meets its start.
  for (let changed = true; changed && out.length >= 3;) {
    changed = false
    const n = out.length
    if (straight(out[n - 2], out[n - 1], out[0])) {
      out.pop()
      changed = true
    } else if (straight(out[n - 1], out[0], out[1])) {
      out.shift()
      changed = true
    }
  }
  return out
}

/** Rings as SVG path data, in document pixels. Read with either fill rule. */
export function regionPath(region: Region): string {
  return region
    .map((ring) => {
      // A ring only a few tenths of a pixel across, a tiny dab, could
      // simplify away to nothing; it keeps its points.
      const [simple] = simplifyPaths([ring], SIMPLIFY, true)
      return tidy(simple && simple.length >= 3 ? simple : ring)
    })
    .filter((ring) => ring.length >= 3)
    .map((ring) => ringPath(ring, Math.log10(SCALE)))
    .join(" ")
}

/** A number as path data writes it: at most `places` decimals, none trailing. */
function formatNumber(value: number, places: number): string {
  const step = 10 ** places
  const rounded = Math.round(value * step) / step
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

/** A ring on a grid of 10^-places as path data. */
function ringPath(ring: Path64, places: number): string {
  const step = 10 ** places
  return `M${ring.map((p) => `${formatNumber(p.x / step, places)} ${formatNumber(p.y / step, places)}`).join(" L")} Z`
}

/**
 * A closed outline as path data, its points rounded to `places` decimals
 * and the points left on a straight run by the rounding merged. Nothing
 * else is dropped: brush art is drawn as its designer made it. "" when
 * rounding leaves no area.
 */
export function outlinePath(
  points: readonly { x: number; y: number }[],
  places: number
): string {
  const step = 10 ** places
  const ring = tidy(
    points.map((p) => ({
      x: Math.round(p.x * step),
      y: Math.round(p.y * step),
    }))
  )
  return ring.length >= 3 ? ringPath(ring, places) : ""
}

/** Whether two boxes share any area: a cheap test before a cut. */
export function boundsOverlap(a: Bounds | null, b: Bounds | null): boolean {
  return (
    !!a &&
    !!b &&
    a.minX < b.maxX &&
    b.minX < a.maxX &&
    a.minY < b.maxY &&
    b.minY < a.maxY
  )
}
