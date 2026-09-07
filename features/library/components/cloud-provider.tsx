"use client"

import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import type { ReactNode } from "react"

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL

// Built once per browser session. The studio at `/` deliberately does not mount
// this: painting works with no account and no backend, so a missing deployment
// URL must degrade to "the library is unavailable", never to a broken canvas.
const client = convexUrl ? new ConvexReactClient(convexUrl) : null

export function CloudProvider({ children }: { children: ReactNode }) {
  if (client === null) {
    return (
      <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-2 p-8">
        <h1 className="font-heading-display font-heading text-3xl">
          The library is not connected
        </h1>
        <p className="text-sm text-muted-foreground">
          Set <code className="font-mono">NEXT_PUBLIC_CONVEX_URL</code> and
          reload. Painting at <code className="font-mono">/</code> works without
          it.
        </p>
      </main>
    )
  }
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>
}
