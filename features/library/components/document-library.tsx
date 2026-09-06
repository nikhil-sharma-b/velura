"use client"

import { useAuthActions } from "@convex-dev/auth/react"
import {
  CopyIcon,
  PencilSimpleIcon,
  ShareNetworkIcon,
  SignOutIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useMutation,
  useAction,
  useQuery,
} from "convex/react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import type { Doc } from "@/convex/_generated/dataModel"
import { NewDocumentDialog } from "@/features/library/components/new-document-dialog"
import { AnonymousMigration } from "@/features/library/components/anonymous-migration"
import { APP_NAME } from "@/lib/constants"

export function DocumentLibrary() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-4xl flex-col gap-8 p-6 md:p-10">
      <AuthLoading>
        <Spinner className="mx-auto mt-20" />
      </AuthLoading>
      <Unauthenticated>
        <SignedOutNotice />
      </Unauthenticated>
      <Authenticated>
        <AnonymousMigration />
        <LibraryHeader />
        <DocumentList />
      </Authenticated>
    </main>
  )
}

function SignedOutNotice() {
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <h1 className="font-heading text-4xl">Your {APP_NAME} library</h1>
      <p className="text-muted-foreground">
        Sign in to see the documents you have saved.
      </p>
      <Button asChild>
        <Link href="/signin">Sign in</Link>
      </Button>
    </div>
  )
}

function LibraryHeader() {
  const { signOut } = useAuthActions()
  const router = useRouter()

  return (
    <header className="flex items-center justify-between gap-4">
      <h1 className="font-heading text-4xl">Documents</h1>
      <div className="flex items-center gap-2">
        <NewDocumentDialog />
        <Button
          variant="ghost"
          onClick={async () => {
            // Everything the browser holds for this account — the JWT and the
            // refresh token — goes with the server session, so a shared machine
            // is left with nothing to reopen.
            await signOut()
            router.replace("/signin")
          }}
        >
          <SignOutIcon />
          Sign out
        </Button>
      </div>
    </header>
  )
}

function DocumentList() {
  const documents = useQuery(api.documents.list)

  if (documents === undefined) return <Spinner className="mx-auto mt-20" />
  if (documents.length === 0) {
    return (
      <p className="m-auto text-center text-muted-foreground">
        No documents yet. Create one and it appears here.
      </p>
    )
  }

  return (
    <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {documents.map((document) => (
        <DocumentRow key={document._id} document={document} />
      ))}
    </ul>
  )
}

function DocumentRow({ document }: { document: Doc<"documents"> }) {
  const rename = useMutation(api.documents.rename)
  const duplicate = useMutation(api.documents.duplicate)
  const remove = useMutation(api.documents.remove)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [shareToken, setShareToken] = useState<string | null>(null)
  const createShare = useMutation(api.shareLinks.create)
  const revokeShare = useMutation(api.shareLinks.revoke)
  const [previewUrl, retryPreview] = useDocumentPreview(document)

  const commitRename = async (name: string) => {
    setEditing(false)
    if (name.trim() === document.name) return
    await rename({ documentId: document._id, name })
  }

  return (
    <li className="group overflow-hidden rounded-xl border bg-card shadow-sm">
      <Link
        href={`/d/${document._id}`}
        aria-label={`Open ${document.name}`}
        className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted"
      >
        {previewUrl ? (
          // The URL is a short-lived, authenticated R2 signature. Sending it
          // through Next's server-side image optimiser would leak that
          // capability outside this signed-in browser session.
          // oxlint-disable-next-line next/no-img-element
          <img
            src={previewUrl}
            alt=""
            className="h-full w-full object-contain"
            onError={retryPreview}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--muted),var(--background))] text-sm text-muted-foreground">
            Blank canvas
          </div>
        )}
      </Link>
      <div className="flex items-center gap-1 p-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <Input
              autoFocus
              defaultValue={document.name}
              aria-label={`Rename ${document.name}`}
              onBlur={(event) => void commitRename(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter")
                  void commitRename(event.currentTarget.value)
                if (event.key === "Escape") setEditing(false)
              }}
            />
          ) : (
            <Link
              href={`/d/${document._id}`}
              className="truncate hover:underline"
            >
              {document.name}
            </Link>
          )}
          <span className="font-mono text-xs text-muted-foreground">
            {document.width}×{document.height}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Share ${document.name}`}
          onClick={async () => {
            setSharing(true)
            const result = await createShare({ documentId: document._id })
            setShareToken(result.token)
          }}
        >
          <ShareNetworkIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Rename ${document.name}`}
          onClick={() => setEditing(true)}
        >
          <PencilSimpleIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Duplicate ${document.name}`}
          onClick={async () => {
            await duplicate({ documentId: document._id })
            toast.success(`Duplicated ${document.name}`)
          }}
        >
          <CopyIcon />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Delete ${document.name}`}
          onClick={() => setConfirmingDelete(true)}
        >
          <TrashIcon />
        </Button>
        <DeleteDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          name={document.name}
          onConfirm={() => remove({ documentId: document._id })}
        />
        <ShareDialog
          open={sharing}
          onOpenChange={setSharing}
          name={document.name}
          token={shareToken}
          onRevoke={async () => {
            await revokeShare({ documentId: document._id })
            setShareToken(null)
          }}
        />
      </div>
    </li>
  )
}

function ShareDialog({
  open,
  onOpenChange,
  name,
  token,
  onRevoke,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  token: string | null
  onRevoke: () => Promise<void>
}) {
  const url = token === null ? null : `${window.location.origin}/s/${token}`
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share {name}</DialogTitle>
          <DialogDescription>
            Anyone with this unlisted link can see the latest synced preview,
            but cannot open or edit the layered document.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Share link"
          readOnly
          value={url ?? "Creating link…"}
          onFocus={(event) => event.currentTarget.select()}
        />
        <DialogFooter>
          <Button
            variant="destructive"
            disabled={url === null}
            onClick={async () => {
              await onRevoke()
              onOpenChange(false)
              toast.success("Share link revoked")
            }}
          >
            Revoke link
          </Button>
          <Button
            disabled={url === null}
            onClick={async () => {
              if (url === null) return
              await navigator.clipboard.writeText(url)
              toast.success("Share link copied")
            }}
          >
            Copy link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function useDocumentPreview(
  document: Doc<"documents">
): readonly [string | null, () => void] {
  const previewDownload = useAction(api.tilesActions.presignPreviewDownload)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => {
    setPreviewUrl(null)
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    if (document.previewVersion === undefined) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryMs = 1_000
    const load = () => {
      void previewDownload({ documentId: document._id }).then(
        (url) => {
          if (current) setPreviewUrl(url)
        },
        () => {
          if (!current) return
          timer = setTimeout(load, retryMs)
          retryMs = Math.min(retryMs * 2, 60_000)
        }
      )
    }
    load()
    return () => {
      current = false
      if (timer) clearTimeout(timer)
    }
  }, [attempt, document._id, document.previewVersion, previewDownload])

  return [previewUrl, retry]
}

function DeleteDialog({
  open,
  onOpenChange,
  name,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onConfirm: () => Promise<unknown>
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The document and everything in it goes. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await onConfirm()
              toast.success(`Deleted ${name}`)
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
