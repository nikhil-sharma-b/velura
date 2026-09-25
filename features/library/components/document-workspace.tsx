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
import {
  recordLocalPreview,
  recordSyncStatus,
} from "@/features/library/lib/preview-cache"
import { tabSessionId } from "@/features/library/lib/tab-session"
import { useConvexPaletteStore } from "@/features/color/lib/convex-palette-store"
import { useConvexBrushStore } from "@/features/studio/lib/convex-brush-store"
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

/** One id per tab, kept across reloads: what a heartbeat is filed under. */
function useSessionId(): string {
  return useMemo(() => tabSessionId(), [])
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
  // Brushes likewise belong to the artist rather than to this document, which
  // is what makes a tool shaped on one machine available on the next (25).
  const brushes = useConvexBrushStore()
  const sessionId = useSessionId()
  useHeartbeat(documentId, sessionId)
  const openElsewhere = useQuery(api.sessions.openElsewhere, {
    documentId,
    sessionId,
  })

  if (document === undefined) return <CentredSpinner />
  const documentSize = { width: document.width, height: document.height }
  return (
    <CanvasHost
      documentId={documentId}
      documentName={document.name}
      libraryHref="/library"
      documentSize={documentSize}
      remote={remote}
      onPreview={(preview) => recordLocalPreview(documentId, preview)}
      onSyncStatus={(status) => recordSyncStatus(documentId, status)}
      palettes={palettes}
      brushes={brushes}
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
      <h1 className="font-heading-display font-heading text-3xl">
        That document is not here
      </h1>
      <Button asChild>
        <Link href="/library">Back to the library</Link>
      </Button>
    </main>
  )
}
