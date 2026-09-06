import { describe, expect, test } from "bun:test"
import { convexTest } from "convex-test"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import schema from "@/convex/schema"

const modules = {
  "./_generated/api.js": () => import("@/convex/_generated/api"),
  "./_generated/server.js": () => import("@/convex/_generated/server"),
  "./auth.ts": () => import("@/convex/auth"),
  "./documents.ts": () => import("@/convex/documents"),
  "./shareLinks.ts": () => import("@/convex/shareLinks"),
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

async function createDocument(
  t: ReturnType<typeof setup>,
  artist: ReturnType<typeof asUser>
) {
  return await artist.mutation(api.documents.create, {
    name: "Sea study",
    width: 1200,
    height: 800,
  })
}

describe("share links", () => {
  test("an artist creates one stable unlisted link for their document", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    const first = await artist.mutation(api.shareLinks.create, { documentId })
    const retry = await artist.mutation(api.shareLinks.create, { documentId })

    expect(retry).toEqual(first)
    expect(first.token).toMatch(/^[0-9a-f-]{36}$/)
  })

  test("a signed-out visitor sees only presentation data and its current preview version", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const { token } = await artist.mutation(api.shareLinks.create, {
      documentId,
    })

    expect(await t.query(api.shareLinks.publicView, { token })).toEqual({
      previewVersion: null,
    })

    await artist.run(async (ctx) =>
      ctx.db.patch(documentId, { previewVersion: 2 })
    )
    expect(await t.query(api.shareLinks.publicView, { token })).toEqual({
      previewVersion: 2,
    })
  })

  test("a stranger cannot create or revoke the link", async () => {
    const t = setup()
    const owner = asUser(t, await createUser(t, "owner@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const documentId = await createDocument(t, owner)
    const { token } = await owner.mutation(api.shareLinks.create, {
      documentId,
    })

    await expect(
      stranger.mutation(api.shareLinks.create, { documentId })
    ).rejects.toThrow(/does not exist/)
    await expect(
      stranger.mutation(api.shareLinks.revoke, { documentId })
    ).rejects.toThrow(/does not exist/)
    expect(await t.query(api.shareLinks.publicView, { token })).not.toBeNull()
  })

  test("revocation makes the public capability disappear immediately", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)
    const { token } = await artist.mutation(api.shareLinks.create, {
      documentId,
    })

    await artist.mutation(api.shareLinks.revoke, { documentId })

    expect(await t.query(api.shareLinks.publicView, { token })).toBeNull()
  })
})
