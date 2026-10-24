"use client"

import { AngleIcon } from "@phosphor-icons/react"
import { Popover as PopoverPrimitive } from "./popover"
import { useRef, useState, type KeyboardEvent } from "react"

import { Slider } from "@/components/ui/slider"
import { boardDown, type Board, type Engine } from "@/engine"
import { returnFocusForKeysOnly } from "@/lib/input-modality"
import { cn } from "@/lib/utils"

import { IconButton } from "./icon-button"

/** The dial's side in CSS pixels. */
const DIAL = 64
/** How far an arrow key turns the dial, and with shift. */
const TURN = 15
const TURN_FINE = 1

/** Which way is down, in degrees clockwise from the paper's bottom edge, of a point about the dial's middle. */
const directionOf = (dx: number, dy: number) =>
  Math.round(((Math.atan2(-dx, dy) * 180) / Math.PI + 360) % 360)

/**
 * Which way is down on the paper, as a dial: an arrow from the middle, and
 * the paper's bottom edge at the bottom. It turns as it is dragged and is
 * told the new direction once, as it is let go, so a turn is one step.
 */
function DirectionDial({
  direction,
  disabled,
  onTurn,
}: {
  direction: number
  disabled?: boolean
  onTurn: (direction: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? direction
  const dial = useRef<HTMLDivElement>(null)
  const at = (event: { clientX: number; clientY: number }) => {
    const box = dial.current!.getBoundingClientRect()
    return directionOf(
      event.clientX - box.left - box.width / 2,
      event.clientY - box.top - box.height / 2
    )
  }
  const down = boardDown({ steepness: 1, direction: shown })
  const reach = DIAL / 2 - 8
  const keys = (event: KeyboardEvent) => {
    const by = event.shiftKey ? TURN_FINE : TURN
    const turned =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? direction + by
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? direction - by
          : null
    if (turned === null) return
    event.preventDefault()
    onTurn((turned + 360) % 360)
  }
  return (
    <div
      ref={dial}
      role="slider"
      aria-label="Down"
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={shown}
      aria-valuetext={`${shown}° from the bottom edge`}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={disabled ? undefined : keys}
      onPointerDown={(event) => {
        if (disabled) return
        event.currentTarget.setPointerCapture(event.pointerId)
        setDraft(at(event))
      }}
      onPointerMove={(event) => {
        if (draft !== null) setDraft(at(event))
      }}
      onPointerUp={(event) => {
        if (draft === null) return
        const turned = at(event)
        setDraft(null)
        if (turned !== direction) onTurn(turned)
      }}
      onPointerCancel={() => setDraft(null)}
      style={{ width: DIAL, height: DIAL }}
      className={cn(
        "relative shrink-0 touch-none rounded-full border border-studio-edge bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring",
        disabled ? "opacity-50" : "cursor-grab"
      )}
    >
      <svg
        aria-hidden
        width={DIAL}
        height={DIAL}
        viewBox={`${-DIAL / 2} ${-DIAL / 2} ${DIAL} ${DIAL}`}
        className="absolute inset-0"
      >
        {/* The paper's bottom edge. */}
        <line
          x1={-10}
          y1={DIAL / 2 - 3}
          x2={10}
          y2={DIAL / 2 - 3}
          className="stroke-muted-foreground"
          strokeWidth={2}
        />
        <line
          x1={0}
          y1={0}
          x2={down.x * reach}
          y2={down.y * reach}
          className="stroke-foreground"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <circle
          cx={down.x * reach}
          cy={down.y * reach}
          r={3.5}
          className="fill-foreground"
        />
      </svg>
    </div>
  )
}

/**
 * The board the document's paper lies on (fluid brushes 38): how steep, and
 * which way is down on the paper. It is the document's, beside its paper.
 * A change is a step that undoes, and wet paint runs the new way at once.
 */
export function BoardControl({
  engine,
  board,
  disabled,
}: {
  engine: Engine
  board: Board
  disabled?: boolean
}) {
  // The steepness while the slider is dragged; the board's the rest of the
  // time, so undo moves the slider too.
  const [dragged, setDragged] = useState<number | null>(null)
  const steepness = dragged ?? board.steepness
  // A key tells the slider's commit before its change, so the change that
  // follows a commit is that value again, not a drag.
  const committed = useRef<number | null>(null)
  const tilt = (next: Board) => {
    if (
      next.steepness === board.steepness &&
      next.direction === board.direction
    )
      return
    void engine.dispatch({ type: "setBoard", ...next })
  }
  const flat = steepness <= 0
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <IconButton
          variant="ghost"
          size="icon"
          label="Board"
          side="bottom"
          disabled={disabled}
          className="rounded-lg"
        >
          <AngleIcon />
        </IconButton>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          onCloseAutoFocus={returnFocusForKeysOnly}
          side="bottom"
          align="start"
          sideOffset={10}
          collisionPadding={12}
          role="dialog"
          aria-label="Board"
          className="z-50 flex w-64 items-center gap-3 rounded-xl border bg-background p-3 shadow-xl outline-none"
        >
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-baseline justify-between text-sm">
              <span id="board-steepness">Steepness</span>
              <span className="text-muted-foreground tabular-nums">
                {flat ? "Flat" : `${Math.round(steepness * 100)}%`}
              </span>
            </div>
            <Slider
              aria-labelledby="board-steepness"
              min={0}
              max={1}
              step={0.01}
              value={[steepness]}
              onValueChange={([value]) => {
                if (committed.current === value) committed.current = null
                else setDragged(value)
              }}
              onValueCommit={([value]) => {
                committed.current = value
                setDragged(null)
                tilt({ steepness: value, direction: board.direction })
              }}
            />
          </div>
          <DirectionDial
            direction={board.direction}
            disabled={flat}
            onTurn={(direction) => tilt({ steepness, direction })}
          />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
