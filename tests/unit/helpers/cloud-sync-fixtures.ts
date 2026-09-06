import type { SurfaceTiles } from "../../../engine/store/document-store"

/** Groups flat tile refs by surface, the shape `DocumentSnapshot.surfaces` expects. */
export function surfaces(
  tiles: readonly { surfaceId: string; x: number; y: number; hash: string }[]
): SurfaceTiles[] {
  const bySurface = new Map<string, { x: number; y: number; hash: string }[]>()
  for (const tile of tiles) {
    const list = bySurface.get(tile.surfaceId) ?? []
    list.push({ x: tile.x, y: tile.y, hash: tile.hash })
    bySurface.set(tile.surfaceId, list)
  }
  return [...bySurface].map(([surfaceId, tileList]) => ({
    surfaceId,
    tiles: tileList,
  }))
}
