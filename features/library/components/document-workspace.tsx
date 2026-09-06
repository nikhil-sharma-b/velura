"use client"

import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useQuery,
} from "convex/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { CanvasHost } from "@/features/studio/components/canvas-host"

/**
 * Opens a document to an empty canvas. Pixels are not persisted until ticket
 * 16, so what the document supplies here is identity and access: the row must
 * exist and belong to the signed-in artist before the engine is mounted.
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

function OwnedDocument({ documentId }: { documentId: Id<"documents"> }) {
  // A document belonging to someone else, or a deleted one, throws in the query
  // rather than resolving to null, so the not-found branch is the error branch.
  const document = useQuery(api.documents.get, { documentId })

  if (document === undefined) return <CentredSpinner />
  return <CanvasHost />
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
