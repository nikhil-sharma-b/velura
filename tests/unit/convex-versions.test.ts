import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"

// See tests/unit/convex-documents.test.ts for why the module map is explicit.
const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./documents.ts": () => import("@/convex/documents"),
  "./tiles.ts": () => import("@/convex/tiles"),
  "./versions.ts": () => import("@/convex/versions"),
  "./http.ts": () => import("@/convex/http"),
}

const STRUCTURE = { layers: [], activeLayerId: "", paintingMask: false }
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function setup() {
  return convexTest(schema, modules)
}

async function createUser(t: ReturnType<typeof setup>, email: string) {
  return await t.run(async (ctx) => await ctx.db.insert("users", { email }))
}

function asUser(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.withIdentity({ subject: userId })
}

async function createDocument(
  t: ReturnType<typeof setup>,
  artist: ReturnType<typeof asUser>
) {
  return await artist.mutation(api.documents.create, {
    name: "Sea study",
    width: 512,
    height: 512,
  })
}

async function flush(
  artist: ReturnType<typeof asUser>,
  documentId: Id<"documents">,
  hash: string
) {
  await artist.mutation(api.tiles.commitFlush, {
    documentId,
    tiles: [{ surfaceId: "layer-1", x: 0, y: 0, hash }],
    uploaded: [{ hash, size: 100 }],
    structure: STRUCTURE,
    metrics: { putCount: 1, mutationCount: 1 },
  })
}

/** Backdates the rows a flush just wrote, standing in for a passing week. */
async function ageVersions(t: ReturnType<typeof setup>, by: number) {
  await t.run(async (ctx) => {
    for (const version of await ctx.db.query("versions").collect())
      await ctx.db.patch(version._id, { createdAt: version.createdAt - by })
  })
}

describe("restore points", () => {
  test("a flush writes one, naming the tiles it flushed rather than copying them", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await flush(artist, documentId, "hash-a")

    const [point] = await artist.query(api.versions.list, { documentId })
    expect(point).toBeDefined()
    const full = await artist.query(api.versions.get, { versionId: point!.id })
    expect(full.tiles).toEqual([
      { surfaceId: "layer-1", x: 0, y: 0, hash: "hash-a" },
    ])
    expect(full.structure).toEqual(STRUCTURE)
  })

  test("the ladder reads newest first", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await flush(artist, documentId, "hash-a")
    await ageVersions(t, 3 * HOUR)
    await flush(artist, documentId, "hash-b")

    const points = await artist.query(api.versions.list, { documentId })
    expect(points.length).toBe(2)
    expect(points[0]!.createdAt).toBeGreaterThan(points[1]!.createdAt)
  })

  test("a week-old history decays as the flush that follows it lands", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    // A fortnight of painting, one flush per simulated hour.
    for (let hour = 0; hour < 14 * 24; hour++) {
      await flush(artist, documentId, `hash-${hour}`)
      await ageVersions(t, HOUR)
    }
    await flush(artist, documentId, "hash-latest")

    const points = await artist.query(api.versions.list, { documentId })
    const now = points[0]!.createdAt
    // Bounded: an hourly day plus a daily week, not a fortnight of hours.
    expect(points.length).toBeLessThan(40)
    for (const point of points)
      expect(now - point.createdAt).toBeLessThan(8 * DAY)
    // Yesterday is still reachable, which is the point of keeping any of it.
    expect(points.some((point) => now - point.createdAt >= DAY)).toBe(true)
  })

  test("another artist's restore points are not readable", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    await flush(artist, documentId, "hash-a")
    const [point] = await artist.query(api.versions.list, { documentId })

    const stranger = asUser(t, await createUser(t, "stranger@example.com"))

    await expect(
      stranger.query(api.versions.get, { versionId: point!.id })
    ).rejects.toThrow()
    await expect(
      stranger.query(api.versions.list, { documentId })
    ).rejects.toThrow()
  })
})
