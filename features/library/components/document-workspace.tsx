"use client"

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvex,
  useQuery,
} from "convex/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { createConvexRemoteIndex } from "@/features/library/lib/convex-remote-index"
import { useConvexPaletteStore } from "@/features/color/lib/convex-palette-store"
import { CanvasHost } from "@/features/studio/components/canvas-host"

/**
 * Opens a document. The row supplies identity and access — it must exist and
 * belong to the signed-in artist before the engine is mounted — and the id it
 * supplies is what the pixels are stored locally under, and synced to, (§9.2).
 */
export function DocumentWorkspace({ documentId }: { documentId: string }) {
  return (
    <>
      <AuthLoading>
        <CentredSpinner />
      </AuthLoading>
      <Unauthenticated>
        <RedirectToSignIn />
      </Unauthenticated>
      <Authenticated>
        {/* The segment is unvalidated text until Convex resolves it; a bad or
            foreign id throws in the query and lands on the error boundary. */}
        <OwnedDocument documentId={documentId as Id<"documents">} />
      </Authenticated>
    </>
  )
}

/** One id per tab, for the life of the tab: what a heartbeat is filed under. */
function useSessionId(): string {
  return useMemo(() => crypto.randomUUID(), [])
}

/** Keeps this tab's presence row alive while the document stays open (18). */
function useHeartbeat(documentId: Id<"documents">, sessionId: string) {
  const convex = useConvex()
  useEffect(() => {
    const beat = () =>
      void convex.mutation(api.sessions.heartbeat, { documentId, sessionId })
    beat()
    // Comfortably inside the backend's active window, so a beat missed to a
    // slow tick or a backgrounded tab does not read as "closed".
    const interval = setInterval(beat, 5_000)
    return () => clearInterval(interval)
  }, [convex, documentId, sessionId])
}

function OwnedDocument({ documentId }: { documentId: Id<"documents"> }) {
  // A document belonging to someone else, or a deleted one, throws in the query
  // rather than resolving to null, so the not-found branch is the error branch.
  const document = useQuery(api.documents.get, { documentId })
  const convex = useConvex()
  const remote = useMemo(
    () => createConvexRemoteIndex(convex, documentId),
    [convex, documentId]
  )
  // Palettes belong to the artist rather than to this document, which is what
  // lets a scheme built on one machine be there on the next (23).
  const palettes = useConvexPaletteStore()
  const sessionId = useSessionId()
  useHeartbeat(documentId, sessionId)
  const openElsewhere = useQuery(api.sessions.openElsewhere, {
    documentId,
    sessionId,
  })

  if (document === undefined) return <CentredSpinner />
  return (
    <CanvasHost
      documentId={documentId}
      remote={remote}
      palettes={palettes}
      openElsewhere={openElsewhere ?? false}
    />
  )
}

function RedirectToSignIn() {
  const router = useRouter()
  useEffect(() => {
    router.replace("/signin")
  }, [router])
  return <CentredSpinner />
}

function CentredSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner />
    </div>
  )
}

export function DocumentNotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center gap-4 text-center">
      <h1 className="font-heading text-3xl">That document is not here</h1>
      <Button asChild>
        <Link href="/library">Back to the library</Link>
      </Button>
    </main>
  )
}
