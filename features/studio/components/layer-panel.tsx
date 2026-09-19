"use client"

import {
  CaretUpIcon,
  CopyIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderPlusIcon,
  FolderSimpleIcon,
  ImageIcon,
  IntersectIcon,
  LockIcon,
  LockOpenIcon,
  MaskHappyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { type Ref, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  blendModes,
  type BlendMode,
  type Engine,
  type EngineSnapshot,
  type LayerSummary,
} from "@/engine"

import { placeImageFile } from "../lib/image-import"
import { IconButton } from "./icon-button"

type LayerPanelProps = {
  engine: Engine
  snapshot: EngineSnapshot
  /**
   * Folds the panel away. The control sits in the panel's own header rather
   * than above it, so what it collapses is never in doubt — a lone button over
   * the column read as belonging to whatever panel happened to be under it.
   */
  onCollapse?(): void
  collapseRef?: Ref<HTMLButtonElement>
}

function findSummary(
  nodes: readonly LayerSummary[],
  id: string
): LayerSummary | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.kind === "group") {
      const found = findSummary(node.children, id)
      if (found) return found
    }
  }
}

function rasterCount(nodes: readonly LayerSummary[]): number {
  return nodes.reduce(
    (count, node) =>
      count + (node.kind === "raster" ? 1 : rasterCount(node.children)),
    0
  )
}

/** How long a finger rests on a row before the canvas picks its layer out. */
const LONG_PRESS_MS = 400

/** CSS pixels a side; the backing store is scaled by the device's density. */
const THUMBNAIL_EDGE = 32
/** The preview shown beside a thumbnail pointed at: big enough to read. */
const PREVIEW_EDGE = 176

/**
 * A canvas the engine draws one layer, group or mask into. The engine decides
 * when it is redrawn — never while a stroke is in flight — so React
 * re-rendering around it costs no pixels.
 */
function ThumbnailCanvas({
  engine,
  id,
  edge,
  className,
  onEmpty,
}: {
  engine: Engine
  id: string
  edge: number
  className?: string
  /** Must be stable, such as a state setter: a new one reattaches the canvas. */
  onEmpty?(empty: boolean): void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const density = Math.min(2, window.devicePixelRatio || 1)
    element.width = element.height = Math.round(edge * density)
    return engine.attachThumbnail(id, element, (drawn) =>
      onEmpty?.(drawn.empty)
    )
  }, [engine, id, edge, onEmpty])
  return (
    <canvas
      ref={canvas}
      aria-hidden
      style={{ width: edge, height: edge }}
      className={className}
    />
  )
}

/**
 * A live picture of one layer, group or mask, framed on its own work, with a
 * larger one beside it while pointed at.
 *
 * Empty and hidden are both states a reader must tell apart from work at a
 * glance, and neither is a picture: empty is a dashed outline with nothing in
 * it, hidden is the picture faded behind a slashed eye.
 */
function LayerThumbnail({
  engine,
  id,
  label,
  hidden,
  className = "",
  children,
}: {
  engine: Engine
  id: string
  label: string
  /**
   * Hidden by its own eye, or by a group around it that is. Both keep it off
   * the canvas; only the first is something to switch back on from this row,
   * so only the first gets the slashed eye.
   */
  hidden: "self" | "group" | false
  className?: string
  children?: React.ReactNode
}) {
  const [empty, setEmpty] = useState(false)
  // Hidden wins the attribute; an empty hidden layer still draws its outline.
  const state = hidden ? "hidden" : empty ? "empty" : "shown"
  return (
    // Nothing in the preview can be used, so it closes the moment the pointer
    // leaves the thumbnail rather than waiting for it to cross the preview —
    // which, heading back to the canvas, it never does.
    <TooltipProvider delayDuration={450} disableHoverableContent>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            data-testid={`thumbnail-${label}`}
            data-state={state}
            data-hidden-by={hidden || undefined}
            className={`relative grid size-8 shrink-0 place-items-center ${
              empty
                ? "border border-dashed border-muted-foreground/50"
                : "border"
            } ${className}`}
          >
            <ThumbnailCanvas
              engine={engine}
              id={id}
              edge={THUMBNAIL_EDGE}
              onEmpty={setEmpty}
              className={
                empty ? "invisible" : hidden ? "opacity-30 grayscale" : ""
              }
            />
            {hidden === "self" && (
              <EyeSlashIcon
                aria-hidden
                className="absolute size-3.5 text-foreground"
              />
            )}
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="left"
          sideOffset={12}
          data-testid={`preview-${label}`}
          // Radix repeats tooltip content for screen readers unless given a
          // label, and a repeated canvas is a second thumbnail to draw.
          aria-label={`${label}${empty ? ", empty" : hidden ? ", hidden" : ""}`}
          className="flex-col items-stretch gap-1.5 p-1.5"
        >
          {!empty && (
            <ThumbnailCanvas engine={engine} id={id} edge={PREVIEW_EDGE} />
          )}
          <span className="px-0.5">
            {label}
            {empty
              ? " — empty"
              : hidden === "group"
                ? " — hidden with its group"
                : hidden
                  ? " — hidden"
                  : ""}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function LayerRow({
  engine,
  layer,
  dragProps,
  dropPosition,
  dragging,
  depth,
  selected,
  activeLayerId,
  paintingMask,
  groupHidden,
  totalRasters,
  onSelect,
}: {
  engine: Engine
  layer: LayerSummary
  /** A group somewhere around this row is hidden, which hides it too. */
  groupHidden: boolean
  dragProps: React.HTMLAttributes<HTMLDivElement>
  dropPosition?: "above" | "below" | "inside"
  dragging: boolean
  depth: number
  selected: boolean
  activeLayerId: string
  paintingMask: boolean
  totalRasters: number
  onSelect(id: string): void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(layer.name)
  const finishRename = () => {
    const nextName = name.trim()
    if (nextName && nextName !== layer.name)
      void engine.dispatch({ type: "setLayer", id: layer.id, name: nextName })
    else setName(layer.name)
    setEditing(false)
  }
  const hiddenBy = !layer.visible ? "self" : groupHidden ? "group" : false
  const removedRasters =
    layer.kind === "raster" ? 1 : rasterCount(layer.children)
  const highlight = (id: string | null) =>
    void engine.dispatch({ type: "highlightLayer", id })
  // A finger has no hover, so a touch picks the layer out by holding still on
  // its row; lifting puts the canvas back.
  const press = useRef<number | undefined>(undefined)
  const release = () => {
    if (press.current === undefined) return
    window.clearTimeout(press.current)
    press.current = undefined
    highlight(null)
  }

  return (
    <>
      <div
        draggable={!editing}
        data-layer-row
        data-testid={`layer-row-${layer.name}`}
        {...dragProps}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") highlight(layer.id)
        }}
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return
          press.current = window.setTimeout(
            () => highlight(layer.id),
            LONG_PRESS_MS
          )
        }}
        onPointerUp={release}
        onPointerCancel={release}
        className={`group relative border-b border-border/70 ${dragging ? "opacity-40" : ""} ${
          selected ? "bg-accent/80" : "bg-studio-surface/80 hover:bg-muted/60"
        } ${dropPosition === "inside" ? "bg-primary/15 ring-2 ring-primary ring-inset" : ""}`}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {dropPosition && (
          <div
            data-testid="layer-drop-indicator"
            aria-label={
              dropPosition === "inside"
                ? `Move into ${layer.name}`
                : `Move ${dropPosition} ${layer.name}`
            }
            className={
              dropPosition === "inside"
                ? "pointer-events-none absolute top-0 right-2 z-10 bg-primary px-1 text-[10px] text-primary-foreground"
                : `pointer-events-none absolute right-0 z-10 h-0.5 bg-primary ${dropPosition === "above" ? "top-0" : "bottom-0"}`
            }
            style={
              dropPosition === "inside" ? undefined : { left: depth * 14 + 8 }
            }
          >
            {dropPosition === "inside" ? (
              "Move into group"
            ) : (
              <span className="absolute -top-0.5 -left-1 size-1.5 rounded-full bg-primary" />
            )}
          </div>
        )}
        <div className="flex min-h-12 items-center gap-1.5 px-2 py-1.5">
          <DotsSixVerticalIcon
            aria-hidden
            className="size-4 shrink-0 cursor-grab text-muted-foreground transition-colors group-hover:text-foreground"
          />
          <button
            type="button"
            aria-label={`${selected ? "Selected" : "Select"} ${layer.name}`}
            onClick={() => {
              onSelect(layer.id)
              if (layer.kind === "raster")
                void engine.dispatch({ type: "selectLayer", id: layer.id })
            }}
            className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {layer.clip && (
              <IntersectIcon
                aria-label="Clipped to the layer below"
                className="size-3 shrink-0 text-muted-foreground"
              />
            )}
            <LayerThumbnail
              engine={engine}
              id={layer.id}
              label={layer.name}
              hidden={hiddenBy}
            >
              {layer.kind === "group" && (
                <FolderSimpleIcon
                  aria-hidden
                  weight="fill"
                  className="absolute -right-1 -bottom-1 size-3 text-muted-foreground"
                />
              )}
            </LayerThumbnail>
            {layer.mask && (
              <LayerThumbnail
                engine={engine}
                id={layer.mask.id}
                label={`${layer.name} mask`}
                hidden={hiddenBy || (!layer.mask.enabled && "self")}
                className={
                  paintingMask && layer.id === activeLayerId
                    ? "ring-2 ring-primary"
                    : ""
                }
              />
            )}
            {editing ? (
              <Input
                autoFocus
                aria-label="Layer name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={finishRename}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") finishRename()
                  if (event.key === "Escape") {
                    setName(layer.name)
                    setEditing(false)
                  }
                }}
                className="h-7"
              />
            ) : (
              <span
                onDoubleClick={(event) => {
                  event.stopPropagation()
                  setName(layer.name)
                  setEditing(true)
                }}
                className="min-w-0 flex-1 truncate text-xs font-medium"
              >
                {layer.name}
              </span>
            )}
          </button>
          <IconButton
            variant="ghost"
            size="icon-xs"
            label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
            onClick={() =>
              void engine.dispatch({
                type: "setLayer",
                id: layer.id,
                visible: !layer.visible,
              })
            }
          >
            {layer.visible ? <EyeIcon /> : <EyeSlashIcon />}
          </IconButton>
          {layer.kind === "raster" && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
              onClick={() =>
                void engine.dispatch({
                  type: "setLayer",
                  id: layer.id,
                  locked: !layer.locked,
                })
              }
            >
              {layer.locked ? <LockIcon /> : <LockOpenIcon />}
            </IconButton>
          )}
          {(selected || layer.id === activeLayerId) && (
            <>
              {layer.kind === "raster" && (
                <IconButton
                  variant="ghost"
                  size="icon-xs"
                  label={`Duplicate ${layer.name}`}
                  onClick={() =>
                    void engine.dispatch({
                      type: "duplicateLayer",
                      id: layer.id,
                    })
                  }
                >
                  <CopyIcon />
                </IconButton>
              )}
              <IconButton
                variant="ghost"
                size="icon-xs"
                label={`Delete ${layer.name}`}
                disabled={totalRasters === removedRasters}
                onClick={() =>
                  void engine.dispatch({ type: "removeLayer", id: layer.id })
                }
              >
                <TrashIcon />
              </IconButton>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Rows({
  engine,
  nodes,
  selectedId,
  activeLayerId,
  paintingMask,
  totalRasters,
  onSelect,
}: {
  engine: Engine
  nodes: readonly LayerSummary[]
  selectedId: string
  activeLayerId: string
  paintingMask: boolean
  totalRasters: number
  onSelect(id: string): void
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [target, setTarget] = useState<{
    id: string
    position: "above" | "below" | "inside"
    parentId: string | null
    index: number
  } | null>(null)
  const reset = () => {
    setDraggedId(null)
    setTarget(null)
  }
  const locate = (
    items: readonly LayerSummary[],
    id: string,
    parentId: string | null = null
  ): { index: number; parentId: string | null } | undefined => {
    for (const [index, node] of items.entries()) {
      if (node.id === id) return { index, parentId }
      if (node.kind === "group") {
        const found = locate(node.children, id, node.id)
        if (found) return found
      }
    }
  }
  const render = (
    items: readonly LayerSummary[],
    depth: number,
    parentId?: string,
    groupHidden = false
  ): React.ReactNode[] =>
    [...items].reverse().flatMap((layer, reverseIndex) => {
      const index = items.length - reverseIndex - 1
      return [
        <LayerRow
          key={layer.id}
          engine={engine}
          layer={layer}
          dragging={draggedId === layer.id}
          dropPosition={
            target?.id === layer.id &&
            !(layer.kind === "group" && target.position === "below")
              ? target.position
              : undefined
          }
          dragProps={{
            onDragStart: (event) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", layer.id)
              setDraggedId(layer.id)
            },
            onDragEnd: reset,
            onDragLeave: (event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null
                )
              )
                setTarget(null)
            },
            onDragOver: (event) => {
              const source = draggedId
                ? findSummary(nodes, draggedId)
                : undefined
              if (
                !source ||
                source.id === layer.id ||
                (source.kind === "group" &&
                  findSummary(source.children, layer.id))
              ) {
                setTarget(null)
                return
              }
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              const bounds = event.currentTarget.getBoundingClientRect()
              const fraction = (event.clientY - bounds.top) / bounds.height
              const position =
                layer.kind === "group" && fraction > 0.25 && fraction < 0.75
                  ? "inside"
                  : fraction < 0.5
                    ? "above"
                    : "below"
              const destinationParent =
                position === "inside" ? layer.id : (parentId ?? null)
              let destinationIndex =
                position === "inside" && layer.kind === "group"
                  ? layer.children.length
                  : index + (position === "above" ? 1 : 0)
              const origin = locate(nodes, source.id)
              if (
                origin?.parentId === destinationParent &&
                origin.index < destinationIndex
              )
                destinationIndex--
              setTarget({
                id: layer.id,
                position,
                parentId: destinationParent,
                index: destinationIndex,
              })
            },
            onDrop: (event) => {
              event.preventDefault()
              if (
                target?.id === layer.id &&
                draggedId &&
                event.dataTransfer.getData("text/plain") === draggedId
              )
                void engine.dispatch({
                  type: "moveLayer",
                  id: draggedId,
                  index: target.index,
                  parentId: target.parentId,
                })
              reset()
            },
          }}
          depth={depth}
          selected={layer.id === selectedId}
          activeLayerId={activeLayerId}
          paintingMask={paintingMask}
          groupHidden={groupHidden}
          totalRasters={totalRasters}
          onSelect={onSelect}
        />,
        ...(layer.kind === "group"
          ? render(
              layer.children,
              depth + 1,
              layer.id,
              groupHidden || !layer.visible
            )
          : []),
        ...(layer.kind === "group" &&
        target?.id === layer.id &&
        target.position === "below"
          ? [
              <div
                key={`drop-${layer.id}`}
                className="pointer-events-none relative"
                aria-label={`Move below ${layer.name}`}
                data-testid="layer-drop-indicator"
              >
                <div
                  className="absolute -top-0.5 right-0 z-10 h-0.5 bg-primary"
                  style={{ left: depth * 14 + 8 }}
                >
                  <span className="absolute -top-0.5 -left-1 size-1.5 rounded-full bg-primary" />
                </div>
              </div>,
            ]
          : []),
      ]
    })
  return <>{render(nodes, 0)}</>
}

export function LayerPanel({
  engine,
  snapshot,
  onCollapse,
  collapseRef,
}: LayerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  /** Why the last image would not come in; cleared by the next attempt. */
  const [imageProblem, setImageProblem] = useState<string | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const selected =
    findSummary(snapshot.layers, selectedId ?? snapshot.activeLayerId) ??
    findSummary(snapshot.layers, snapshot.activeLayerId)
  const count = rasterCount(snapshot.layers)
  // A folded or closed panel cannot leave a layer picked out behind it.
  useEffect(
    () => () => void engine.dispatch({ type: "highlightLayer", id: null }),
    [engine]
  )

  return (
    <section
      role="region"
      aria-label="Layers"
      className="flex min-h-0 flex-col"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold tracking-wide uppercase">
          Layers
        </h2>
        <div className="flex">
          {/*
            The button is the control and the input is only how it reaches a
            file: the browser's picker cannot be opened any other way, but a
            bare file input would sit beside its neighbours looking like
            something else — a different weight, and no tooltip.
          */}
          <IconButton
            variant="ghost"
            size="icon-sm"
            label="Place an image on its own layer"
            onClick={() => imageInput.current?.click()}
          >
            <ImageIcon />
          </IconButton>
          <input
            ref={imageInput}
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              // Cleared, so placing the same file twice in a row is a change
              // the input reports rather than silently swallows.
              event.target.value = ""
              if (!file) return
              setImageProblem(null)
              void placeImageFile(engine, file).catch((error: unknown) =>
                setImageProblem(
                  error instanceof Error
                    ? error.message
                    : "That image could not be placed."
                )
              )
            }}
          />
          <IconButton
            variant="ghost"
            size="icon-sm"
            label="Group active layer"
            onClick={() => void engine.dispatch({ type: "addGroup" })}
          >
            <FolderPlusIcon />
          </IconButton>
          <IconButton
            variant="ghost"
            size="icon-sm"
            label="Add layer"
            onClick={() => void engine.dispatch({ type: "addLayer" })}
          >
            <PlusIcon />
          </IconButton>
          {onCollapse && (
            <IconButton
              ref={collapseRef}
              variant="ghost"
              size="icon-sm"
              label="Collapse layers"
              aria-expanded
              onClick={onCollapse}
              className="ml-1"
            >
              <CaretUpIcon />
            </IconButton>
          )}
        </div>
      </header>

      {imageProblem && (
        <p role="alert" className="shrink-0 px-3 py-2 text-xs text-destructive">
          {imageProblem}
        </p>
      )}

      {/*
        Pointing at a row picks its layer out on the canvas, everything else
        dimmed; leaving the list, rather than each row, puts it back, so
        moving from row to row does not flash the whole stack between them.
      */}
      <div
        className="max-h-48 min-h-12 shrink-0 overflow-y-auto"
        onPointerLeave={(event) => {
          if (event.pointerType !== "touch")
            void engine.dispatch({ type: "highlightLayer", id: null })
        }}
      >
        <Rows
          engine={engine}
          nodes={snapshot.layers}
          selectedId={selected?.id ?? snapshot.activeLayerId}
          activeLayerId={snapshot.activeLayerId}
          paintingMask={snapshot.paintingMask}
          totalRasters={count}
          onSelect={setSelectedId}
        />
      </div>

      {selected && (
        <details className="shrink-0 border-t bg-studio-surface/95">
          <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            Layer properties
          </summary>
          <div className="space-y-3 px-3 pb-3">
            <div className="flex items-center gap-1">
              <Button
                variant={selected.clip ? "secondary" : "outline"}
                size="sm"
                aria-pressed={selected.clip}
                onClick={() =>
                  void engine.dispatch({
                    type: "setLayer",
                    id: selected.id,
                    clip: !selected.clip,
                  })
                }
              >
                <IntersectIcon /> Clip
              </Button>
              {selected.kind === "raster" && (
                <Button
                  variant={snapshot.paintingMask ? "secondary" : "outline"}
                  size="sm"
                  onClick={() =>
                    void engine.dispatch(
                      selected.mask
                        ? { type: "selectMask", id: selected.id }
                        : { type: "addMask", id: selected.id }
                    )
                  }
                >
                  <MaskHappyIcon /> {selected.mask ? "Paint mask" : "Add mask"}
                </Button>
              )}
            </div>
            {selected.mask && (
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void engine.dispatch({
                      type: "setMaskEnabled",
                      id: selected.id,
                      enabled: !selected.mask!.enabled,
                    })
                  }
                >
                  {selected.mask.enabled ? "Disable mask" : "Enable mask"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void engine.dispatch({
                      type: "removeMask",
                      id: selected.id,
                    })
                  }
                >
                  Remove mask
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="blend-mode">Blend</Label>
              <Select
                value={selected.blend}
                onValueChange={(blend: BlendMode) =>
                  void engine.dispatch({
                    type: "setLayer",
                    id: selected.id,
                    blend,
                  })
                }
              >
                <SelectTrigger
                  id="blend-mode"
                  aria-label="Blend mode"
                  size="sm"
                  className="w-36"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {Object.entries(blendModes).map(([value, mode]) => (
                    <SelectItem key={value} value={value}>
                      {mode.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label id="layer-opacity-label">Opacity</Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {Math.round(selected.opacity * 100)}%
                </span>
              </div>
              <Slider
                aria-label="Layer opacity"
                min={0}
                max={100}
                step={1}
                value={[Math.round(selected.opacity * 100)]}
                onValueChange={([opacity]) =>
                  void engine.dispatch({
                    type: "setLayer",
                    id: selected.id,
                    opacity: opacity / 100,
                  })
                }
              />
            </div>
          </div>
        </details>
      )}
    </section>
  )
}
