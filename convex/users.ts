import { getAuthUserId } from "@convex-dev/auth/server"

import { query } from "./_generated/server"

/**
 * Who is signed in, as the library's profile menu shows them: the address
 * they signed in with, and a name or picture should a sign-in method ever
 * supply one. Nothing when signed out.
 */
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx)
    if (userId === null) return null
    const user = await ctx.db.get(userId)
    if (user === null) return null
    return {
      email: user.email ?? null,
      name: user.name ?? null,
      image: user.image ?? null,
    }
  },
})
