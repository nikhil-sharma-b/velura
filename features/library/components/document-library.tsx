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
import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
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
import { PreferencesSync } from "@/features/commands/components/preferences-sync"
import { forgetAccountKeybinds } from "@/features/commands/hooks/use-keybind-overrides"
import { AnonymousMigration } from "@/features/library/components/anonymous-migration"
import { IconButton } from "@/features/studio/components/icon-button"
import {
  cachedSignedUrl,
  forgetSignedUrl,
  deviceState,
  localPreviewIsCurrent,
  previewIsStale,
  rememberSignedUrl,
  subscribeDeviceState,
} from "@/features/library/lib/preview-cache"
import { APP_NAME } from "@/lib/constants"
import { cn } from "@/lib/utils"

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
        <PreferencesSync />
        <LibraryHeader />
        <DocumentList />
      </Authenticated>
    </main>
  )
}

function SignedOutNotice() {
  return (
    <div className="m-auto flex flex-col items-center gap-4 text-center">
      <h1 className="font-heading-display font-heading text-4xl">
        Your {APP_NAME} library
      </h1>
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
      <h1 className="font-heading-display font-heading text-4xl">Documents</h1>
      <div className="flex items-center gap-2">
        <NewDocumentDialog />
        <Button
          variant="ghost"
          onClick={async () => {
            // Everything the browser holds for this account — the JWT and the
            // refresh token — goes with the server session, so a shared machine
            // is left with nothing to reopen.
            await signOut()
            forgetAccountKeybinds()
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
  const preview = useDocumentPreview(document)

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
        className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-muted"
      >
        {preview.url ? (
          // The URL is a short-lived, authenticated R2 signature. Sending it
          // through Next's server-side image optimiser would leak that
          // capability outside this signed-in browser session.
          // oxlint-disable-next-line next/no-img-element
          <img
            src={preview.url}
            alt=""
            className={cn(
              "h-full w-full object-contain transition-opacity duration-300",
              preview.stale && "opacity-60"
            )}
            onLoad={preview.onLoad}
            onError={preview.onError}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--muted),var(--background))] text-sm text-muted-foreground">
            {preview.stale ? "" : "Blank canvas"}
          </div>
        )}
        {preview.stale && (
          // Subtle on purpose: the picture is still worth looking at, it is
          // only not the newest one yet.
          <span className="absolute top-2 right-2 flex items-center gap-1.5 rounded-full bg-background/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
            <Spinner className="size-3" aria-label="Updating preview" />
            Updating
          </span>
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
        <IconButton
          variant="ghost"
          size="icon-sm"
          label="Share"
          aria-label={`Share ${document.name}`}
          onClick={async () => {
            if (document.previewVersion === undefined) {
              toast.error("Sync this document before sharing it")
              return
            }
            const result = await createShare({ documentId: document._id })
            setShareToken(result.token)
            setSharing(true)
          }}
        >
          <ShareNetworkIcon />
        </IconButton>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label="Rename"
          aria-label={`Rename ${document.name}`}
          onClick={() => setEditing(true)}
        >
          <PencilSimpleIcon />
        </IconButton>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label="Duplicate"
          aria-label={`Duplicate ${document.name}`}
          onClick={async () => {
            await duplicate({ documentId: document._id })
            toast.success(`Duplicated ${document.name}`)
          }}
        >
          <CopyIcon />
        </IconButton>
        <IconButton
          variant="ghost"
          size="icon-sm"
          label="Delete"
          aria-label={`Delete ${document.name}`}
          onClick={() => setConfirmingDelete(true)}
        >
          <TrashIcon />
        </IconButton>
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

function useDocumentPreview(document: Doc<"documents">): {
  url: string | null
  /** The picture shown is behind the document, and a newer one is coming. */
  stale: boolean
  onLoad: () => void
  onError: () => void
} {
  const previewDownload = useAction(api.tilesActions.presignPreviewDownload)
  const documentId = document._id
  const version = document.previewVersion
  const device = useSyncExternalStore(
    subscribeDeviceState,
    () => deviceState(documentId),
    () => undefined
  )
  const showLocal = localPreviewIsCurrent(device?.local, version)
  // Read on every render, so a card coming back into view shows its picture
  // on the first frame, from a URL the browser has already loaded.
  const cached =
    version === undefined ? undefined : cachedSignedUrl(documentId, version)
  const [signed, setSigned] = useState<{
    version: number
    url: string
  } | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const onError = useCallback(() => {
    forgetSignedUrl(documentId)
    setSigned(null)
    setAttempt((value) => value + 1)
  }, [documentId])

  useEffect(() => {
    // Nothing to fetch: no preview yet, this device's own picture is the
    // newer one, or a signed URL for this version is still good.
    if (version === undefined || showLocal || cached) return
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryMs = 1_000
    const load = () => {
      void previewDownload({ documentId }).then(
        (url) => {
          if (!current) return
          rememberSignedUrl(documentId, version, url)
          setSigned({ version, url })
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
  }, [attempt, cached, documentId, version, showLocal, previewDownload])

  // A signature for an older version is still a picture of the document, and
  // better than a blank card while the newer one is fetched.
  const shown = showLocal
    ? { url: device!.local!.url, version }
    : cached
      ? { url: cached, version }
      : signed
  const url = shown?.url ?? null
  return {
    url,
    stale:
      previewIsStale(device, shown?.version, version) ||
      // Swapping one picture for another, the browser keeps the old one up
      // until the new one decodes. A card's first picture has nothing older
      // on screen to be mistaken for current, so it is not "updating".
      (loaded !== null && url !== null && url !== loaded),
    onLoad: () => setLoaded(url),
    onError,
  }
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
