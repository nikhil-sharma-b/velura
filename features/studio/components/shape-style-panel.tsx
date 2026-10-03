"use client"

import {
  AlignBottomIcon,
  AlignCenterHorizontalIcon,
  AlignCenterVerticalIcon,
  AlignLeftIcon,
  AlignRightIcon,
  AlignTopIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  BoundingBoxIcon,
  CopyIcon,
  LineSegmentIcon,
  LinkIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { memo, useEffect, useId, useRef, type ReactNode } from "react"

import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { AlignAnchor, Engine, EngineCommand, ShapeStyle } from "@/engine"
import { cn } from "@/lib/utils"

import { ALIGN_ANCHORS } from "../lib/studio-commands"
import { IconButton } from "./icon-button"

const ALIGN_ICONS: Record<AlignAnchor, ReactNode> = {
  left: <AlignLeftIcon />,
  hcenter: <AlignCenterHorizontalIcon />,
  right: <AlignRightIcon />,
  top: <AlignTopIcon />,
  vcenter: <AlignCenterVerticalIcon />,
  bottom: <AlignBottomIcon />,
}

const CAPS = [
  ["butt", "Butt"],
  ["round", "Round"],
  ["square", "Square"],
] as const
const JOINS = [
  ["miter", "Miter"],
  ["round", "Round"],
  ["bevel", "Bevel"],
] as const

/**
 * The shape options (19, 21): what the shape tools give a new shape, or —
 * with objects selected — the selected objects' own style, edited in place.
 * One panel for both, because to the artist they are the same question
 * asked of different things: what is this filled and outlined with.
 */
export const ShapeStylePanel = memo(function ShapeStylePanel({
  engine,
  style,
  selected,
  outlineOnly = false,
  currentColor,
  joinable = { merge: false, segment: false },
  curves = false,
  runCommand,
}: {
  engine: Engine | null
  /** The selection's style while there is one, else the tool's. */
  style: ShapeStyle
  selected: boolean
  /** The tool in the hand draws lines, outlined and never filled. */
  outlineOnly?: boolean
  /** What a paint with no colour of its own is drawn in. */
  currentColor: string
  /** Whether the selected curves can be joined, merged or by a segment. */
  joinable?: { merge: boolean; segment: boolean }
  /** Curves are among the selected objects, so joining applies. */
  curves?: boolean
  /** Runs a studio command by id, as its keybind or the palette would. */
  runCommand(id: string): void
}) {
  // A selected object without an outline has no width, cap or join to set,
  // nor a colour for a paint it lacks: those wait until the paint is on.
  const outlined = !selected || style.stroke
  const dispatch = (command: EngineCommand) =>
    void engine?.dispatch(command).catch(() => {
      // A style the engine will not take is simply not applied.
    })
  const setStyle = (
    change: Omit<Extract<EngineCommand, { type: "setShapeStyle" }>, "type">
  ) => dispatch({ type: "setShapeStyle", ...change })

  return (
    <div className="space-y-3">
      <p className="border-b border-border pb-2 text-xs font-semibold">
        {selected ? "Selected objects" : "New shapes"}
      </p>
      <div role="group" aria-label="Paint" className="space-y-1.5">
        <PaintRow
          label="Fill"
          on={style.fill}
          locked={outlineOnly}
          editable={!outlineOnly && (!selected || style.fill)}
          color={style.fillColor ?? currentColor}
          onToggle={() => setStyle({ fill: !style.fill })}
          onColor={(fillColor) => setStyle({ fillColor })}
        />
        <PaintRow
          label="Outline"
          on={style.stroke}
          locked={outlineOnly}
          editable={outlined}
          color={style.strokeColor ?? currentColor}
          onToggle={() => setStyle({ stroke: !style.stroke })}
          onColor={(strokeColor) => setStyle({ strokeColor })}
        />
      </div>
      {/* The width is the size setting on the rail, as a brush's size is:
          the adjustment made between one stroke and the next, a click away
          rather than in here. */}
      <p className="text-xs text-muted-foreground">
        Outline width is set with{" "}
        <strong className="font-semibold text-foreground">Width</strong> in the
        rail.
      </p>
      <Choice
        label="Line ends"
        options={CAPS}
        value={style.strokeCap}
        disabled={!outlined}
        onChange={(strokeCap) => setStyle({ strokeCap })}
      />
      <Choice
        label="Corners"
        options={JOINS}
        value={style.strokeJoin}
        disabled={!outlined}
        onChange={(strokeJoin) => setStyle({ strokeJoin })}
      />
      {selected && (
        <>
          <Separator />
          {/* Grouped by what they do, one row each, so the panel's width
              holds them and an action is found by its purpose. */}
          <div role="group" aria-label="Object actions" className="space-y-1">
            <ActionRow label="Edit">
              <ActionButton
                label="Transform objects"
                command="object.transform"
                onClick={() => runCommand("object.transform")}
              >
                <BoundingBoxIcon />
              </ActionButton>
              <ActionButton
                label="Duplicate objects"
                command="object.duplicate"
                onClick={() => runCommand("object.duplicate")}
              >
                <CopyIcon />
              </ActionButton>
              <ActionButton
                label="Delete objects"
                command="object.delete"
                onClick={() => runCommand("object.delete")}
              >
                <TrashIcon />
              </ActionButton>
            </ActionRow>
            <ActionRow label="Order">
              <ActionButton
                label="Bring to front"
                onClick={() =>
                  dispatch({ type: "reorderVectorObjects", to: "front" })
                }
              >
                <ArrowLineUpIcon />
              </ActionButton>
              <ActionButton
                label="Send to back"
                onClick={() =>
                  dispatch({ type: "reorderVectorObjects", to: "back" })
                }
              >
                <ArrowLineDownIcon />
              </ActionButton>
            </ActionRow>
            {/* Only curves have ends to join; a rectangle never shows it. */}
            {curves && (
              <ActionRow label="Join">
                <ActionButton
                  label="Join curves"
                  command="node.join"
                  disabled={!joinable.merge}
                  onClick={() => runCommand("node.join")}
                >
                  <LinkIcon />
                </ActionButton>
                <ActionButton
                  label="Join curves with a segment"
                  command="node.joinWithSegment"
                  disabled={!joinable.segment}
                  onClick={() => runCommand("node.joinWithSegment")}
                >
                  <LineSegmentIcon />
                </ActionButton>
              </ActionRow>
            )}
          </div>
          <div role="group" aria-label="Align to canvas" className="space-y-1">
            <p className="text-xs text-muted-foreground">Align to canvas</p>
            <div className="flex gap-0.5">
              {ALIGN_ANCHORS.map(([anchor, lines]) => (
                <ActionButton
                  key={anchor}
                  label={`Align ${lines} to canvas`}
                  onClick={() =>
                    dispatch({
                      type: "alignVectorObjects",
                      anchor,
                      to: "canvas",
                    })
                  }
                >
                  {ALIGN_ICONS[anchor]}
                </ActionButton>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
})

/**
 * A named row of actions: what they are for, then the buttons, which start
 * on one line down the rows so they read as a column.
 */
function ActionRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-center">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex gap-0.5">{children}</div>
    </div>
  )
}

function ActionButton({
  label,
  command,
  disabled,
  onClick,
  children,
}: {
  label: string
  command?: string
  disabled?: boolean
  onClick(): void
  children: ReactNode
}) {
  return (
    <IconButton
      label={label}
      command={command}
      variant="ghost"
      size="icon-sm"
      className="rounded-md"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </IconButton>
  )
}

/**
 * A paint, fill or outline: whether the shape has it, and its colour. The
 * swatch shows the colour itself, and a paint turned off reads as none
 * rather than as a colour it does not have.
 */
function PaintRow({
  label,
  on,
  locked = false,
  editable,
  color,
  onToggle,
  onColor,
}: {
  label: string
  on: boolean
  /** Whether the paint is fixed on or off by the tool, not the artist. */
  locked?: boolean
  /** Whether the colour can be chosen now. */
  editable: boolean
  color: string
  onToggle(): void
  onColor(hex: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  // Every move of the picker restyles at once, as the colour is chosen, not
  // when the picker is closed or Enter pressed; the engine folds the run into
  // one undo step. Moves land at most once a frame, as the screen can show no
  // more. Registered once; the handler it calls is kept current beside it.
  const latest = useRef(onColor)
  useEffect(() => {
    latest.current = onColor
  })
  useEffect(() => {
    const element = input.current
    if (!element) return
    let frame = 0
    const moved = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        latest.current(element.value)
      })
    }
    element.addEventListener("input", moved)
    return () => {
      element.removeEventListener("input", moved)
      // A colour still waiting on its frame when the options close is the
      // last one chosen, so it lands now rather than being dropped.
      if (frame) {
        cancelAnimationFrame(frame)
        latest.current(element.value)
      }
    }
  }, [])
  // Uncontrolled between choices, since the picker owns its value while it
  // is open; put back to what the shape has whenever that moves.
  useEffect(() => {
    if (input.current) input.current.value = color.toLowerCase()
  }, [color])
  return (
    <div className="flex items-center gap-2">
      {/* A switch, not a button with the paint's name on it: the name is a
          label, and whether the paint is on is a state to flip. */}
      <span className="flex-1 text-xs">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={locked}
        className="relative h-4 w-7 shrink-0 rounded-full bg-muted-foreground/30 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 aria-checked:bg-primary"
        onClick={onToggle}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 left-0.5 size-3 rounded-full bg-background shadow-sm motion-safe:transition-transform",
            on && "translate-x-3"
          )}
        />
      </button>
      <label
        className={cn(
          "relative flex h-7 w-14 items-center justify-center rounded-md border border-foreground/15 focus-within:ring-2 focus-within:ring-ring/50",
          editable ? "cursor-pointer" : "opacity-50",
          !on && "bg-background"
        )}
        style={on ? { backgroundColor: color } : undefined}
        title={on ? color : "None"}
      >
        {!on && (
          // A slash through an empty swatch: the common mark for no paint.
          <span
            aria-hidden
            className="absolute inset-0 rounded-md bg-[linear-gradient(to_top_right,transparent_calc(50%-1px),var(--destructive)_calc(50%-1px),var(--destructive)_calc(50%+1px),transparent_calc(50%+1px))]"
          />
        )}
        <input
          ref={input}
          type="color"
          aria-label={`${label} colour`}
          className="sr-only"
          disabled={!editable}
          defaultValue={color.toLowerCase()}
        />
        <span className="sr-only">{on ? color : "None"}</span>
      </label>
    </div>
  )
}

function Choice<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string
  options: readonly (readonly [T, string])[]
  value: T
  disabled?: boolean
  onChange(value: T): void
}) {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label id={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {/* One control in a sunken track, the choice raised out of it, so the
          options read as alternatives and not as more labels. */}
      <div
        role="group"
        aria-labelledby={id}
        className={cn(
          "grid grid-cols-3 gap-0.5 rounded-md bg-muted p-0.5",
          disabled && "opacity-50"
        )}
      >
        {options.map(([option, name]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            disabled={disabled}
            className="rounded-[5px] py-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-sm"
            onClick={() => onChange(option)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}
