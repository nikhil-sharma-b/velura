import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"
import { MAX_CANVAS_SIZE } from "@/convex/lib/documents"

// `convex-test` normally discovers functions with Vite's `import.meta.glob`,
// which the Bun runner does not provide. Listing the modules explicitly is the
// supported alternative and has the useful side effect of failing loudly when a
// new backend module is added without a test.
const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./documents.ts": () => import("@/convex/documents"),
  "./http.ts": () => import("@/convex/http"),
}

function setup() {
  return convexTest(schema, modules)
}

async function createUser(t: ReturnType<typeof setup>, email: string) {
  return await t.run(async (ctx) => await ctx.db.insert("users", { email }))
}

function asUser(t: ReturnType<typeof setup>, userId: Id<"users">) {
  return t.withIdentity({ subject: userId })
}

describe("creating documents", () => {
  test("claiming the same anonymous document is idempotent and merges into the library", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const existing = await artist.mutation(api.documents.create, {
      name: "Already here",
      width: 512,
      height: 512,
    })
    const source = {
      sourceId: "local-browser-drawing",
      name: "Anonymous sketch",
      width: 1024,
      height: 768,
    }

    const first = await artist.mutation(api.documents.claimAnonymous, source)
    const retry = await artist.mutation(api.documents.claimAnonymous, source)

    expect(retry).toBe(first)
    expect(
      (await artist.query(api.documents.list, {})).map((doc) => doc._id)
    ).toContain(existing)
    expect(
      await artist.query(api.documents.get, { documentId: first })
    ).toMatchObject({
      name: "Anonymous sketch",
      width: 1024,
      height: 768,
      anonymousSourceId: source.sourceId,
    })
  })

  test("stores the requested size and lists it back to its owner", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))

    await artist.mutation(api.documents.create, {
      name: "  Sea   study  ",
      width: 2048,
      height: 3508,
    })

    const documents = await artist.query(api.documents.list, {})
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      name: "Sea study",
      width: 2048,
      height: 3508,
    })
  })

  test("refuses a canvas larger than the engine can open", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))

    await expect(
      artist.mutation(api.documents.create, {
        width: MAX_CANVAS_SIZE + 1,
        height: 512,
      })
    ).rejects.toThrow(/Width/)
    expect(await artist.query(api.documents.list, {})).toHaveLength(0)
  })

  test("leaves the plan and quota fields dormant", async () => {
    const t = setup()
    const userId = await createUser(t, "artist@example.com")
    const artist = asUser(t, userId)

    await artist.mutation(api.documents.create, { width: 512, height: 512 })

    // The schema carries these from the first migration; nothing writes them
    // in v1, and a mutation that started to would be a billing decision.
    const user = await t.run(async (ctx) => await ctx.db.get(userId))
    expect(user?.plan).toBeUndefined()
    expect(user?.storageBytes).toBeUndefined()
    expect(user?.docCount).toBeUndefined()
  })

  test("accepts the plan and quota fields the schema declares", async () => {
    const t = setup()
    const userId = await t.run(
      async (ctx) =>
        await ctx.db.insert("users", {
          email: "artist@example.com",
          plan: "free",
          storageBytes: 0,
          docCount: 0,
        })
    )
    const user = await t.run(async (ctx) => await ctx.db.get(userId))
    expect(user).toMatchObject({ plan: "free", storageBytes: 0, docCount: 0 })
  })

  test("rejects a signed-out caller", async () => {
    const t = setup()
    await expect(
      t.mutation(api.documents.create, { width: 512, height: 512 })
    ).rejects.toThrow(/Sign in/)
  })
})

describe("managing the library", () => {
  test("renames, duplicates and deletes", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await artist.mutation(api.documents.create, {
      name: "Sea study",
      width: 1024,
      height: 768,
    })

    await artist.mutation(api.documents.rename, { documentId, name: "Harbour" })
    expect((await artist.query(api.documents.get, { documentId })).name).toBe(
      "Harbour"
    )

    const copyId = await artist.mutation(api.documents.duplicate, {
      documentId,
    })
    const copy = await artist.query(api.documents.get, { documentId: copyId })
    expect(copy).toMatchObject({
      name: "Harbour copy",
      width: 1024,
      height: 768,
    })
    expect(copy.previewVersion).toBeUndefined()

    await artist.mutation(api.documents.remove, { documentId })
    const remaining = await artist.query(api.documents.list, {})
    expect(remaining.map((doc) => doc._id)).toEqual([copyId])
  })

  test("a rename that changes nothing leaves the order alone", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const first = await artist.mutation(api.documents.create, {
      name: "First",
      width: 512,
      height: 512,
    })
    await artist.mutation(api.documents.create, {
      name: "Second",
      width: 512,
      height: 512,
    })

    await artist.mutation(api.documents.rename, {
      documentId: first,
      name: " First ",
    })

    expect(
      (await artist.query(api.documents.list, {})).map((doc) => doc.name)
    ).toEqual(["Second", "First"])
  })

  test("lists most recently touched first", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const first = await artist.mutation(api.documents.create, {
      name: "First",
      width: 512,
      height: 512,
    })
    await artist.mutation(api.documents.create, {
      name: "Second",
      width: 512,
      height: 512,
    })
    await artist.mutation(api.documents.rename, {
      documentId: first,
      name: "First again",
    })

    expect(
      (await artist.query(api.documents.list, {})).map((doc) => doc.name)
    ).toEqual(["First again", "Second"])
  })
})

describe("access control", () => {
  test("one artist cannot see, read or change another's documents", async () => {
    const t = setup()
    const owner = asUser(t, await createUser(t, "owner@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const documentId = await owner.mutation(api.documents.create, {
      name: "Private",
      width: 512,
      height: 512,
    })

    expect(await stranger.query(api.documents.list, {})).toEqual([])
    await expect(
      stranger.query(api.documents.get, { documentId })
    ).rejects.toThrow(/does not exist/)
    await expect(
      stranger.mutation(api.documents.rename, { documentId, name: "Mine now" })
    ).rejects.toThrow(/does not exist/)
    await expect(
      stranger.mutation(api.documents.duplicate, { documentId })
    ).rejects.toThrow(/does not exist/)
    await expect(
      stranger.mutation(api.documents.remove, { documentId })
    ).rejects.toThrow(/does not exist/)

    // And the owner's document survived every attempt.
    expect((await owner.query(api.documents.get, { documentId })).name).toBe(
      "Private"
    )
  })

  test("a signed-out visitor sees an empty library rather than someone else's", async () => {
    const t = setup()
    const owner = asUser(t, await createUser(t, "owner@example.com"))
    await owner.mutation(api.documents.create, { width: 512, height: 512 })

    expect(await t.query(api.documents.list, {})).toEqual([])
  })
})
