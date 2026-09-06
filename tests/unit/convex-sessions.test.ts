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
  "./sessions.ts": () => import("@/convex/sessions"),
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
    width: 512,
    height: 512,
  })
}

describe("open elsewhere", () => {
  test("a document with only this session's heartbeat is not open elsewhere", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await artist.mutation(api.sessions.heartbeat, {
      documentId,
      sessionId: "tab-a",
    })

    expect(
      await artist.query(api.sessions.openElsewhere, {
        documentId,
        sessionId: "tab-a",
      })
    ).toBe(false)
  })

  test("a second session's heartbeat is seen as open elsewhere by the first", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await artist.mutation(api.sessions.heartbeat, {
      documentId,
      sessionId: "tab-a",
    })
    await artist.mutation(api.sessions.heartbeat, {
      documentId,
      sessionId: "tab-b",
    })

    expect(
      await artist.query(api.sessions.openElsewhere, {
        documentId,
        sessionId: "tab-a",
      })
    ).toBe(true)
    expect(
      await artist.query(api.sessions.openElsewhere, {
        documentId,
        sessionId: "tab-b",
      })
    ).toBe(true)
  })

  test("a stale heartbeat past the active window no longer counts", async () => {
    const t = setup()
    const artist = asUser(t, await createUser(t, "artist@example.com"))
    const documentId = await createDocument(t, artist)

    await artist.mutation(api.sessions.heartbeat, {
      documentId,
      sessionId: "tab-a",
    })
    // Backdate the other tab's row past the active window, as if its tab had
    // been closed a while ago without a beat since.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("sessions")
        .withIndex("by_document_session", (q) =>
          q.eq("documentId", documentId).eq("sessionId", "tab-a")
        )
        .unique()
      if (row) await ctx.db.patch(row._id, { lastSeen: Date.now() - 60_000 })
    })
    await artist.mutation(api.sessions.heartbeat, {
      documentId,
      sessionId: "tab-b",
    })

    expect(
      await artist.query(api.sessions.openElsewhere, {
        documentId,
        sessionId: "tab-b",
      })
    ).toBe(false)
  })

  test("a stranger cannot heartbeat or query someone else's document", async () => {
    const t = setup()
    const owner = asUser(t, await createUser(t, "owner@example.com"))
    const stranger = asUser(t, await createUser(t, "stranger@example.com"))
    const documentId = await createDocument(t, owner)

    await expect(
      stranger.mutation(api.sessions.heartbeat, {
        documentId,
        sessionId: "tab-x",
      })
    ).rejects.toThrow()
    await expect(
      stranger.query(api.sessions.openElsewhere, {
        documentId,
        sessionId: "tab-x",
      })
    ).rejects.toThrow()
  })
})
