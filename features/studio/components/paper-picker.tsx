"use client"

import { NoteBlankIcon } from "@phosphor-icons/react"
import { Popover as PopoverPrimitive } from "./popover"
import { useEffect, useRef, useState } from "react"

import { PAPERS, paperSwatch, type Engine, type Paper } from "@/engine"
import { returnFocusForKeysOnly } from "@/lib/input-modality"
import { cn } from "@/lib/utils"

import { IconButton } from "./icon-button"

const PAPER_LABELS: Record<Paper, string> = {
  "hot-press": "Hot press",
  "cold-press": "Cold press",
  rough: "Rough",
}

/** The swatch's side in CSS pixels; it shows twice that in paper. */
const SWATCH = 32

/** Lit paper with shade in its valleys, a document pixel a texel. */
function swatchOf(paper: Paper): ImageData {
  const side = SWATCH * 2
  const heights = paperSwatch(paper, side)
  const image = new ImageData(side, side)
  heights.forEach((height, i) => {
    const shade = 150 + Math.round((105 * height) / 255)
    image.data.set([shade, shade - 4, shade - 12, 255], i * 4)
  })
  return image
}

function Swatch({ paper }: { paper: Paper }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    canvas.current?.getContext("2d")?.putImageData(swatchOf(paper), 0, 0)
  }, [paper])
  return (
    <canvas
      ref={canvas}
      width={SWATCH * 2}
      height={SWATCH * 2}
      aria-hidden
      className="size-8 shrink-0 rounded border border-studio-edge"
    />
  )
}

/**
 * The paper the document's fluid brushes paint on (fluid brushes 15). It is
 * the document's, not the brush's, so it sits among the document's own
 * controls; choosing one is a step that undoes, and dries wet paint first.
 */
export function PaperPicker({
  engine,
  paper,
  disabled,
}: {
  engine: Engine
  paper: Paper
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <PopoverPrimitive.Root modal open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <IconButton
          variant="ghost"
          size="icon"
          label="Paper"
          side="bottom"
          disabled={disabled}
          aria-haspopup="menu"
          className="rounded-lg"
        >
          <NoteBlankIcon />
        </IconButton>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onCloseAutoFocus={returnFocusForKeysOnly}
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          role="menu"
          aria-label="Paper"
          className="z-50 flex flex-col gap-0.5 rounded-xl border bg-background p-1 shadow-xl outline-none"
        >
          {PAPERS.map((choice) => (
            <button
              key={choice}
              type="button"
              role="menuitemradio"
              aria-checked={choice === paper}
              onClick={() => {
                setOpen(false)
                if (choice !== paper)
                  void engine.dispatch({ type: "setPaper", paper: choice })
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent",
                choice === paper && "bg-accent text-accent-foreground"
              )}
            >
              <Swatch paper={choice} />
              <span className="flex-1 pr-2">{PAPER_LABELS[choice]}</span>
            </button>
          ))}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
