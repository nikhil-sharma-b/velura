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
  TrashIcon,
} from "@phosphor-icons/react"
import { memo, useEffect, useId, useRef, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { AlignAnchor, Engine, EngineCommand, ShapeStyle } from "@/engine"
import { cn } from "@/lib/utils"

import { ALIGN_ANCHORS } from "../lib/studio-commands"
import { IconButton } from "./icon-button"
import { SliderSetting } from "./slider-setting"

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
  currentColor,
  runCommand,
}: {
  engine: Engine | null
  /** The selection's style while there is one, else the tool's. */
  style: ShapeStyle
  selected: boolean
  /** What a paint with no colour of its own is drawn in. */
  currentColor: string
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
      <p className="text-xs font-medium">
        {selected ? "Selected objects" : "New shapes"}
      </p>
      <div role="group" aria-label="Paint" className="space-y-1.5">
        <PaintRow
          label="Fill"
          on={style.fill}
          editable={!selected || style.fill}
          color={style.fillColor ?? currentColor}
          onToggle={() => setStyle({ fill: !style.fill })}
          onColor={(fillColor) => setStyle({ fillColor })}
        />
        <PaintRow
          label="Outline"
          on={style.stroke}
          editable={outlined}
          color={style.strokeColor ?? currentColor}
          onToggle={() => setStyle({ stroke: !style.stroke })}
          onColor={(strokeColor) => setStyle({ strokeColor })}
        />
      </div>
      <SliderSetting
        label="Outline width"
        value={style.strokeWidth}
        min={1}
        max={64}
        step={1}
        unit="px"
        disabled={!outlined}
        onChange={(strokeWidth) => setStyle({ strokeWidth })}
      />
      <Choice
        label="Cap"
        options={CAPS}
        value={style.strokeCap}
        disabled={!outlined}
        onChange={(strokeCap) => setStyle({ strokeCap })}
      />
      <Choice
        label="Join"
        options={JOINS}
        value={style.strokeJoin}
        disabled={!outlined}
        onChange={(strokeJoin) => setStyle({ strokeJoin })}
      />
      {selected && (
        <>
          <Separator />
          <div role="group" aria-label="Object actions" className="space-y-1">
            <p className="text-xs text-muted-foreground">Objects</p>
            <div className="flex gap-0.5">
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
              <span aria-hidden className="mx-1 w-px self-stretch bg-border" />
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
            </div>
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

function ActionButton({
  label,
  command,
  onClick,
  children,
}: {
  label: string
  command?: string
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
  editable,
  color,
  onToggle,
  onColor,
}: {
  label: string
  on: boolean
  /** Whether the colour can be chosen now. */
  editable: boolean
  color: string
  onToggle(): void
  onColor(hex: string): void
}) {
  const input = useRef<HTMLInputElement>(null)
  // The picker's own `change`, not React's per-move `input`: one colour
  // chosen is one restyle, and so one undo step rather than one per drag.
  // Registered once; the handler it calls is kept current beside it.
  const latest = useRef(onColor)
  useEffect(() => {
    latest.current = onColor
  })
  useEffect(() => {
    const element = input.current
    if (!element) return
    const changed = () => latest.current(element.value)
    element.addEventListener("change", changed)
    return () => element.removeEventListener("change", changed)
  }, [])
  // Uncontrolled between choices, since the picker owns its value while it
  // is open; put back to what the shape has whenever that moves.
  useEffect(() => {
    if (input.current) input.current.value = color.toLowerCase()
  }, [color])
  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={on}
        className="flex-1 justify-start rounded-md border-transparent aria-pressed:border-primary aria-pressed:bg-primary/10"
        onClick={onToggle}
      >
        {label}
      </Button>
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
    <div className="flex items-center justify-between gap-2">
      <Label id={id} className="text-xs">
        {label}
      </Label>
      <div
        role="group"
        aria-labelledby={id}
        className="grid grid-cols-3 gap-0.5"
      >
        {options.map(([option, name]) => (
          <Button
            key={option}
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={value === option}
            disabled={disabled}
            className="rounded-md border-transparent aria-pressed:border-primary aria-pressed:bg-primary/10"
            onClick={() => onChange(option)}
          >
            {name}
          </Button>
        ))}
      </div>
    </div>
  )
}
