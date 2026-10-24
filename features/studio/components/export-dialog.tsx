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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { encodeExportImage, type Engine } from "@/engine"

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

type ExportFormat = "png" | "jpeg" | "svg" | "velura"

const FORMATS: { id: ExportFormat; name: string; description: string }[] = [
  { id: "png", name: "PNG", description: "Full size, keeps transparency" },
  { id: "jpeg", name: "JPEG", description: "Smaller file, for sharing" },
  { id: "svg", name: "SVG", description: "Shapes stay sharp at any size" },
  {
    id: "velura",
    name: "Velura backup",
    description: "Every layer, editable later",
  },
]

export function ExportDialog({ engine }: { engine: Engine }) {
  const [format, setFormat] = useState<ExportFormat>("png")
  const [raster, setRaster] = useState<"embed" | "omit">("embed")
  const [brushData, setBrushData] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [quality, setQuality] = useState(82)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  // An image is of the dried picture: `readPixels` leaves wet paint wet.
  async function finalPixels() {
    await engine.dispatch({ type: "dryNow" })
    return await engine.readPixels()
  }

  async function runOperation(label: string, work: () => Promise<void>) {
    setProblem(null)
    setWarnings([])
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

  const chosen = FORMATS.find((option) => option.id === format)!

  function exportFormat() {
    const name = chosen.name
    if (format === "png")
      return void runOperation(`Exporting ${name}`, async () => {
        const blob = await encodeExportImage(await finalPixels(), {
          format: "png",
        })
        download(blob, "untitled-artwork.png")
      })
    if (format === "jpeg")
      return void runOperation(`Exporting ${name}`, async () => {
        const blob = await encodeExportImage(await finalPixels(), {
          format: "jpeg",
          quality: quality / 100,
        })
        download(blob, "untitled-artwork.jpg")
      })
    if (format === "svg")
      return void runOperation(`Exporting ${name}`, async () => {
        const result = await engine.exportSvg({ raster, brushData })
        setWarnings(result.warnings)
        download(
          new Blob([result.svg], { type: "image/svg+xml" }),
          "untitled-artwork.svg"
        )
      })
    void runOperation(`Exporting ${name}`, async () => {
      const bytes = await engine.exportDocument()
      download(
        new Blob([bytes as BlobPart], { type: "application/x-velura" }),
        "untitled-artwork.velura"
      )
    })
  }

  return (
    <Dialog>
      <TooltipProvider delayDuration={350}>
        <Tooltip>
          <TooltipTrigger asChild>
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
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={8}>
            Export or import
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DialogContent>
        <DialogHeader className="p-0">
          <DialogTitle>Export or import</DialogTitle>
          <DialogDescription>
            Save this artwork as an image, or as a backup that keeps every layer
            editable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <fieldset className="grid gap-2" disabled={busy !== null}>
            <legend className="sr-only">Format</legend>
            {/* One choice of format, so the dialog has one export button and
                shows only the options that format has. */}
            <div className="grid grid-cols-2 gap-px border bg-border">
              {FORMATS.map((option) => (
                <label
                  key={option.id}
                  className="relative grid cursor-pointer gap-0.5 bg-popover p-3 has-checked:bg-primary/10 has-checked:shadow-[inset_0_0_0_1px_var(--color-primary)] has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-primary has-disabled:cursor-default has-disabled:opacity-60"
                >
                  <input
                    type="radio"
                    name="export-format"
                    value={option.id}
                    checked={format === option.id}
                    onChange={() => setFormat(option.id)}
                    aria-describedby={`export-format-${option.id}`}
                    // Unseen but covering the tile, so the tile is the radio
                    // to a pointer as it is to a screen reader.
                    className="absolute inset-0 cursor-pointer appearance-none opacity-0 disabled:cursor-default"
                  />
                  <span className="font-medium">{option.name}</span>
                  <span
                    id={`export-format-${option.id}`}
                    className="text-xs text-muted-foreground"
                  >
                    {option.description}
                  </span>
                </label>
              ))}
            </div>
            {format === "jpeg" && (
              <div className="grid gap-2 py-1">
                <div className="flex items-center justify-between">
                  <Label htmlFor="jpeg-quality">Quality</Label>
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
              </div>
            )}
            {format === "svg" && (
              <div className="grid gap-2 py-1">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="svg-raster">Paint layers</Label>
                  <select
                    id="svg-raster"
                    value={raster}
                    onChange={(event) =>
                      setRaster(event.target.value as "embed" | "omit")
                    }
                    className="bg-transparent text-right"
                  >
                    <option value="embed">Embed as PNG images</option>
                    <option value="omit">Leave out</option>
                  </select>
                </div>
                <Label>
                  <input
                    type="checkbox"
                    checked={brushData}
                    onChange={(event) => setBrushData(event.target.checked)}
                  />
                  Keep brush settings (larger file)
                </Label>
              </div>
            )}
          </fieldset>
          <Button disabled={busy !== null} onClick={exportFormat}>
            <DownloadSimpleIcon />
            {busy ? `${busy}…` : `Export ${chosen.name}`}
          </Button>
          {warnings.length > 0 && (
            <Alert>
              <AlertDescription>
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {problem && (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          )}
          <p className="sr-only" aria-live="polite">
            {busy && `${busy}…`}
          </p>
          <input
            ref={input}
            className="sr-only"
            type="file"
            accept=".velura,application/x-velura,application/zip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ""
              if (!file) return
              void runOperation("Opening", async () => {
                await engine.importDocument(
                  new Uint8Array(await file.arrayBuffer())
                )
              })
            }}
          />
          {/* Bringing a backup in is not an export: it sits apart, below a
              rule, and quieter. */}
          <div className="-mx-4 flex items-center border-t px-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              <UploadSimpleIcon /> Import .velura backup
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
