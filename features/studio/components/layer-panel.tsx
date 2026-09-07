"use client"

import {
  CopyIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderPlusIcon,
  IntersectIcon,
  LockIcon,
  LockOpenIcon,
  MaskHappyIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react"
import { useState } from "react"

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
  blendModes,
  type BlendMode,
  type Engine,
  type EngineSnapshot,
  type LayerSummary,
} from "@/engine"

import { IconButton } from "./icon-button"

type LayerPanelProps = { engine: Engine; snapshot: EngineSnapshot }

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

function LayerRow({
  engine,
  layer,
  index,
  parentId,
  depth,
  selected,
  activeLayerId,
  totalRasters,
  onSelect,
}: {
  engine: Engine
  layer: LayerSummary
  index: number
  parentId?: string
  depth: number
  selected: boolean
  activeLayerId: string
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
  const removedRasters =
    layer.kind === "raster" ? 1 : rasterCount(layer.children)

  return (
    <>
      <div
        draggable={!editing}
        data-layer-row
        data-testid={`layer-row-${layer.name}`}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move"
          event.dataTransfer.setData("text/plain", layer.id)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "move"
        }}
        onDrop={(event) => {
          event.preventDefault()
          const id = event.dataTransfer.getData("text/plain")
          if (id && id !== layer.id)
            void engine.dispatch({ type: "moveLayer", id, index, parentId })
        }}
        className={`group border-b border-border/70 ${
          selected ? "bg-accent/80" : "bg-studio-surface/80 hover:bg-muted/60"
        }`}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
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
            <span className="grid size-8 shrink-0 place-items-center border bg-muted/50 text-xs">
              {layer.kind === "group" ? "▣" : layer.mask ? "◐" : "●"}
            </span>
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
  totalRasters,
  onSelect,
}: {
  engine: Engine
  nodes: readonly LayerSummary[]
  selectedId: string
  activeLayerId: string
  totalRasters: number
  onSelect(id: string): void
}) {
  const render = (
    items: readonly LayerSummary[],
    depth: number,
    parentId?: string
  ): React.ReactNode[] =>
    [...items].reverse().flatMap((layer, reverseIndex) => {
      const index = items.length - reverseIndex - 1
      return [
        <LayerRow
          key={layer.id}
          engine={engine}
          layer={layer}
          index={index}
          parentId={parentId}
          depth={depth}
          selected={layer.id === selectedId}
          activeLayerId={activeLayerId}
          totalRasters={totalRasters}
          onSelect={onSelect}
        />,
        ...(layer.kind === "group"
          ? render(layer.children, depth + 1, layer.id)
          : []),
      ]
    })
  return <>{render(nodes, 0)}</>
}

export function LayerPanel({ engine, snapshot }: LayerPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected =
    findSummary(snapshot.layers, selectedId ?? snapshot.activeLayerId) ??
    findSummary(snapshot.layers, snapshot.activeLayerId)
  const count = rasterCount(snapshot.layers)

  return (
    <section
      role="region"
      aria-label="Layers"
      className="flex min-h-0 flex-1 flex-col"
    >
      <header className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold tracking-wide uppercase">
          Layers
        </h2>
        <div className="flex">
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
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Rows
          engine={engine}
          nodes={snapshot.layers}
          selectedId={selected?.id ?? snapshot.activeLayerId}
          activeLayerId={snapshot.activeLayerId}
          totalRasters={count}
          onSelect={setSelectedId}
        />
      </div>

      {selected && (
        <div className="shrink-0 space-y-3 border-t bg-studio-surface/95 p-3">
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
                  void engine.dispatch({ type: "removeMask", id: selected.id })
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
      )}
    </section>
  )
}
