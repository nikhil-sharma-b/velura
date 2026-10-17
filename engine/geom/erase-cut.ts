/**
 * Erasing as geometry, for export: an object's painted area with the
 * eraser marks drawn after it subtracted, as Illustrator and Affinity cut
 * paths when you erase. The canvas still erases by drawing; only files
 * written for other editors need the cut shapes.
 *
 * Areas come from the same meshes the canvas draws. A fill's fan triangles,
 * kept with their signs, wind exactly as its outline does, so the polygon
 * library's fill rule recovers the outline; a stroke's triangles all turned
 * one way and read nonzero are their union.
 */

import {
  Clipper,
  FillRule,
  type IPoint64,
  type Path64,
  type Paths64,
} from "clipper2-js"
import type { Bounds, Mesh } from "./tessellate"

/** Polygon coordinates are integers: hundredths of a document pixel. */
const SCALE = 100

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
  return Clipper.Union(paths, undefined, rule)
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
    clip = erasers.flat() as Paths64
  if (!Clipper.Intersect(region, clip, FillRule.NonZero).length) return null
  return Clipper.Difference(region, clip, FillRule.NonZero)
}

/** One region of several, as one eraser's fill and stroke erase together. */
export function unionRegions(regions: readonly Region[]): Region {
  return Clipper.Union(regions.flat() as Paths64, undefined, FillRule.NonZero)
}

/** A ring without repeated points or points on a straight run, which the triangles leave behind. */
function tidy(ring: Path64): Path64 {
  const out: Path64 = [] as unknown as Path64
  const straight = (a: IPoint64, b: IPoint64, c: IPoint64) =>
    cross(a, b, c) === 0
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
    .map(tidy)
    .filter((ring) => ring.length >= 3)
    .map(
      (ring) =>
        `M${ring.map((p) => `${p.x / SCALE} ${p.y / SCALE}`).join(" L")} Z`
    )
    .join(" ")
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
