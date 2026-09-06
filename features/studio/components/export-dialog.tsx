"use client"

import { DownloadSimpleIcon, UploadSimpleIcon } from "@phosphor-icons/react"
import { useRef, useState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { encodeExportImage, type Engine } from "@/engine"

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function ExportDialog({ engine }: { engine: Engine }) {
  const [quality, setQuality] = useState(82)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function runOperation(label: string, work: () => Promise<void>) {
    setProblem(null)
    setBusy(label)
    try {
      await work()
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "The file could not be created."
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Export or import"
          className="rounded-lg"
        >
          <DownloadSimpleIcon />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Export or import</DialogTitle>
          <DialogDescription>
            Make a finished image, or keep every editable layer in a Velura
            backup.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 px-4">
          <Button
            disabled={busy !== null}
            onClick={() =>
              void runOperation("PNG", async () => {
                const blob = await encodeExportImage(
                  await engine.readPixels(),
                  { format: "png" }
                )
                download(blob, "untitled-artwork.png")
              })
            }
          >
            Export full-size PNG
          </Button>
          <div className="grid gap-2 rounded-none border p-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="jpeg-quality">JPEG quality</Label>
              <span className="text-muted-foreground tabular-nums">
                {quality}%
              </span>
            </div>
            <Slider
              id="jpeg-quality"
              aria-label="JPEG quality"
              value={[quality]}
              min={10}
              max={100}
              step={1}
              onValueChange={([value]) => setQuality(value)}
            />
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() =>
                void runOperation("JPEG", async () => {
                  const blob = await encodeExportImage(
                    await engine.readPixels(),
                    {
                      format: "jpeg",
                      quality: quality / 100,
                    }
                  )
                  download(blob, "untitled-artwork.jpg")
                })
              }
            >
              Export smaller JPEG
            </Button>
          </div>
          <Button
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void runOperation("Velura backup", async () => {
                const bytes = await engine.exportDocument()
                download(
                  new Blob([bytes as BlobPart], {
                    type: "application/x-velura",
                  }),
                  "untitled-artwork.velura"
                )
              })
            }
          >
            Export editable .velura backup
          </Button>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept=".velura,application/x-velura,application/zip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (!file) return
              void runOperation("Import", async () => {
                await engine.importDocument(
                  new Uint8Array(await file.arrayBuffer())
                )
              })
            }}
          />
          <Button
            variant="ghost"
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            <UploadSimpleIcon /> Import .velura backup
          </Button>
          {busy && (
            <p className="text-center text-muted-foreground" aria-live="polite">
              {busy}…
            </p>
          )}
          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
