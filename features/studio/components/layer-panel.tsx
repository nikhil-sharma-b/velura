"use client"

import {
  CopyIcon,
  DotsSixVerticalIcon,
  EyeIcon,
  EyeSlashIcon,
  LockIcon,
  LockOpenIcon,
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

type LayerPanelProps = {
  engine: Engine
  snapshot: EngineSnapshot
}

function LayerRow({
  engine,
  layer,
  index,
  layerCount,
  active,
}: {
  engine: Engine
  layer: LayerSummary
  index: number
  layerCount: number
  active: boolean
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

  return (
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
          void engine.dispatch({ type: "moveLayer", id, index })
      }}
      className={`group border-b border-border/70 ${
        active ? "bg-accent/80" : "bg-background/80 hover:bg-muted/60"
      }`}
    >
      <div className="flex min-h-14 items-center gap-1.5 px-2 py-1.5">
        <DotsSixVerticalIcon
          className="size-3.5 shrink-0 text-muted-foreground opacity-50"
          aria-hidden="true"
        />
        <button
          type="button"
          aria-label={`${active ? "Selected" : "Select"} ${layer.name}`}
          onClick={() =>
            void engine.dispatch({ type: "selectLayer", id: layer.id })
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <span className="grid size-9 shrink-0 place-items-center border bg-[linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%),linear-gradient(45deg,var(--muted)_25%,transparent_25%,transparent_75%,var(--muted)_75%)] bg-[length:8px_8px] bg-[position:0_0,4px_4px]">
            <span className="size-5 rounded-full bg-gradient-to-br from-brand-violet/70 to-brand-coral/70" />
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
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
          onClick={() =>
            void engine.dispatch({
              type: "setLayer",
              id: layer.id,
              visible: !layer.visible,
            })
          }
        >
          {layer.visible ? <EyeIcon /> : <EyeSlashIcon />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
          onClick={() =>
            void engine.dispatch({
              type: "setLayer",
              id: layer.id,
              locked: !layer.locked,
            })
          }
        >
          {layer.locked ? <LockIcon /> : <LockOpenIcon />}
        </Button>
        {active && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Duplicate ${layer.name}`}
              onClick={() =>
                void engine.dispatch({ type: "duplicateLayer", id: layer.id })
              }
            >
              <CopyIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Delete ${layer.name}`}
              disabled={layerCount === 1}
              onClick={() =>
                void engine.dispatch({ type: "removeLayer", id: layer.id })
              }
            >
              <TrashIcon />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export function LayerPanel({ engine, snapshot }: LayerPanelProps) {
  const active = snapshot.layers.find(
    (layer) => layer.id === snapshot.activeLayerId
  )

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
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Add layer"
          onClick={() => void engine.dispatch({ type: "addLayer" })}
        >
          <PlusIcon />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {[...snapshot.layers].reverse().map((layer) => (
          <LayerRow
            key={layer.id}
            engine={engine}
            layer={layer}
            index={snapshot.layers.findIndex((item) => item.id === layer.id)}
            layerCount={snapshot.layers.length}
            active={layer.id === snapshot.activeLayerId}
          />
        ))}
      </div>

      {active && (
        <div className="shrink-0 space-y-3 border-t bg-background/95 p-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="blend-mode">Blend</Label>
            <Select
              value={active.blend}
              onValueChange={(blend: BlendMode) =>
                void engine.dispatch({
                  type: "setLayer",
                  id: active.id,
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
                {Math.round(active.opacity * 100)}%
              </span>
            </div>
            <Slider
              aria-label="Layer opacity"
              min={0}
              max={100}
              step={1}
              value={[Math.round(active.opacity * 100)]}
              onValueChange={([opacity]) =>
                void engine.dispatch({
                  type: "setLayer",
                  id: active.id,
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
