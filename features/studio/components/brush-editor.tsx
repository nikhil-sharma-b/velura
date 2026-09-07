"use client"

import { PlusIcon, TrashIcon } from "@phosphor-icons/react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { PressureCurve } from "@/components/ui/pressure-curve"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { Brush } from "@/engine/brush/brush"
import { LINEAR_CURVE } from "@/engine/brush/curve"
import {
  type DynamicsMix,
  type DynamicsSource,
  type DynamicsTarget,
  isOffsetTarget,
  type Modulator,
  targetLimit,
} from "@/engine/brush/dynamics"

import {
  type BrushEdit,
  editBrush,
  featherOf,
  hardnessOf,
  newModulator,
} from "../lib/brush-draft"
import { BrushPreview } from "./brush-preview"
import { SliderSetting } from "./slider-setting"

/**
 * The brush editor (D32): the dynamics graph of ticket 05 as a tool rather
 * than an internal model.
 *
 * Four tabs, because a brush has four separable parts and putting them on one
 * page would make each of them harder to read: the tip and how it is spaced,
 * the paper under it, how the marks combine, and — the substance of it — which
 * input drives which parameter, through a curve the artist draws.
 *
 * The editor never touches the engine directly. It is given the working brush
 * and hands back the next one; the host decides that the working brush is what
 * paints and that the saved brush is untouched until Save. That is what keeps
 * this a view of a `Brush` and nothing more, and what will let the brush
 * library (D25) reuse it over a brush that is not the one in the hand.
 */

const SOURCE_LABELS: Record<DynamicsSource, string> = {
  pressure: "Pressure",
  tilt: "Tilt",
  tiltDirection: "Tilt direction",
  velocity: "Speed",
  direction: "Direction",
  random: "Randomness",
  strokeProgress: "Stroke progress",
}

/**
 * The targets, as the editor shows them.
 *
 * One entry per target rather than a table of labels beside a table of
 * ceilings: adding a target to the graph should be one edit here, not three.
 * `drawn` says whether a renderer consumes it yet — the graph carries scatter
 * and hue for the renderers that will read them (see `DynamicsTarget`), and an
 * artist mapping onto one deserves to be told it does nothing on the canvas
 * today rather than left wondering why the stroke never changes.
 */
const TARGETS: Record<DynamicsTarget, { label: string; drawn: boolean }> = {
  size: { label: "Size", drawn: true },
  opacity: { label: "Opacity", drawn: true },
  flow: { label: "Flow", drawn: true },
  angle: { label: "Angle", drawn: true },
  roundness: { label: "Roundness", drawn: true },
  grainDepth: { label: "Grain depth", drawn: true },
  scatter: { label: "Scatter", drawn: false },
  hue: { label: "Hue", drawn: false },
}

function targetLabel(target: DynamicsTarget): string {
  const { label, drawn } = TARGETS[target]
  return drawn ? label : `${label} (not drawn yet)`
}

const MIX_LABELS: Record<DynamicsMix, string> = {
  multiply: "Scales it",
  add: "Adds to it",
  replace: "Replaces it",
}

/**
 * The mixes a target accepts. An offset target refuses a multiply, so it is
 * never offered rather than offered and then thrown back by the engine.
 */
function mixesFor(target: DynamicsTarget): DynamicsMix[] {
  return isOffsetTarget(target)
    ? ["add", "replace"]
    : ["multiply", "add", "replace"]
}

function TextureSelect({
  label,
  value,
  textures,
  noneLabel,
  onChange,
  onImport,
}: {
  label: string
  value: string | null
  textures: readonly string[]
  noneLabel: string
  onChange(id: string | null): void
  /** Brings a texture in from a file and selects it (24/25). */
  onImport?(file: File): void
}) {
  const NONE = "__none__"
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label className="text-xs">{label}</Label>
        {onImport && (
          // A file input rather than a button that opens one: the browser's
          // own picker is the only way to a file, and dressing it up as
          // something else costs the keyboard path to it.
          <label className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2">
            Import…
            <input
              type="file"
              accept="image/*"
              aria-label={`Import a ${label.toLowerCase()} texture`}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                // Cleared, so importing the same file twice in a row is a
                // change the input reports rather than silently swallows.
                event.target.value = ""
                if (file) onImport(file)
              }}
            />
          </label>
        )}
      </div>
      <Select
        value={value ?? NONE}
        onValueChange={(next) => onChange(next === NONE ? null : next)}
      >
        <SelectTrigger className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>{noneLabel}</SelectItem>
          {textures.map((id) => (
            <SelectItem key={id} value={id}>
              {id[0].toUpperCase() + id.slice(1)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function Mapping({
  modulator,
  index,
  onChange,
  onRemove,
}: {
  modulator: Modulator
  index: number
  onChange(next: Modulator): void
  onRemove(): void
}) {
  // The engine's own limits for this target, so the control offers exactly
  // what the graph accepts — no value it would clamp away, and none withheld.
  const [low, high] = targetLimit(modulator.target)
  const step = (high - low) / 100
  return (
    <section
      className="space-y-3 border border-border/70 p-3"
      data-testid={`mapping-${index}`}
    >
      <div className="flex items-center gap-2">
        <Select
          value={modulator.source}
          onValueChange={(source) =>
            onChange({ ...modulator, source: source as DynamicsSource })
          }
        >
          <SelectTrigger
            className="flex-1"
            aria-label={`Mapping ${index + 1} input`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(SOURCE_LABELS).map(([source, label]) => (
              <SelectItem key={source} value={source}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">→</span>
        <Select
          value={modulator.target}
          onValueChange={(value) => {
            const target = value as DynamicsTarget
            // A target the current mix is invalid on takes the mix a new
            // mapping onto it would have had, rather than being rejected by
            // the engine the moment the artist chooses it.
            const mix = mixesFor(target).includes(modulator.mix)
              ? modulator.mix
              : newModulator(target).mix
            // The range is in the target's units, so it moves with it — onto
            // the neutral-to-full span, which is what a new mapping starts at.
            const limit = targetLimit(target)
            onChange({
              ...modulator,
              target,
              mix,
              range: [limit[0], Math.min(1, limit[1])],
            })
          }}
        >
          <SelectTrigger
            className="flex-1"
            aria-label={`Mapping ${index + 1} parameter`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.keys(TARGETS).map((target) => (
              <SelectItem key={target} value={target}>
                {targetLabel(target as DynamicsTarget)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove mapping ${index + 1}`}
          onClick={onRemove}
        >
          <TrashIcon />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select
          value={modulator.mix}
          onValueChange={(mix) =>
            onChange({ ...modulator, mix: mix as DynamicsMix })
          }
        >
          <SelectTrigger
            className="w-40"
            aria-label={`Mapping ${index + 1} mix`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mixesFor(modulator.target).map((mix) => (
              <SelectItem key={mix} value={mix}>
                {MIX_LABELS[mix]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground tabular-nums">
          {modulator.range[0].toFixed(2)} → {modulator.range[1].toFixed(2)}
        </span>
      </div>
      <Slider
        aria-label={`Mapping ${index + 1} range`}
        min={low}
        max={high}
        step={step}
        value={[modulator.range[0], modulator.range[1]]}
        onValueChange={([low, high]) =>
          onChange({ ...modulator, range: [low, high] })
        }
      />
      {/* The curve widget and the engine share `engine/brush/curve`, so the
          shape drawn here is the one evaluated per dab, not a redrawing. */}
      <PressureCurve
        size="lg"
        value={[...(modulator.curve ?? LINEAR_CURVE)]}
        onChange={(curve) => onChange({ ...modulator, curve })}
      />
    </section>
  )
}

export function BrushEditor({
  open,
  brush,
  textures,
  edited,
  problem,
  onOpenChange,
  onEdit,
  onImportTexture,
  onSave,
  onRevert,
}: {
  open: boolean
  /** The working brush: what the pen is painting with right now. */
  brush: Brush
  /** Texture ids the engine can resolve, so a brush cannot name a missing one. */
  textures: readonly string[]
  /** Whether the working brush has moved away from the saved one. */
  edited: boolean
  /** Why keeping the brush failed, if it did. A brush is an hour's work. */
  problem?: string | null
  onOpenChange(open: boolean): void
  onEdit(next: Brush): void
  /**
   * Brings a texture in from a file and resolves with the id it is stored
   * under, so the brush can name it. Absent in a host with nowhere to keep
   * one, and then no import is offered rather than one that loses the file.
   */
  onImportTexture?(file: File, name: string): Promise<string>
  onSave(): void
  onRevert(): void
}) {
  const apply = (edit: BrushEdit) => onEdit(editBrush(brush, edit))
  const dynamics = brush.dynamics
  const grain = brush.grain
  const [importProblem, setImportProblem] = useState<string | null>(null)

  /**
   * Imports a file and puts the result where it was asked for. The texture is
   * selected only once it is stored: a tip the brush named before the store
   * had it would be a brush pointing at nothing on the next machine.
   */
  const importTexture = (file: File, select: (id: string) => void) => {
    if (!onImportTexture) return
    setImportProblem(null)
    void onImportTexture(file, file.name.replace(/\.[^.]+$/, "")).then(
      select,
      (error: unknown) =>
        setImportProblem(
          error instanceof Error
            ? error.message
            : "That image could not be imported."
        )
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-3 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{brush.name}</DialogTitle>
        </DialogHeader>
        {/* The preview sits above the tabs rather than inside one: every tab
            changes what it shows, and an artist dialling a brush in by eye
            should never have to leave a control to see what it did. */}
        <BrushPreview
          brush={brush}
          className="h-24 w-full border border-border/70 bg-card text-foreground"
        />
        {(importProblem ?? problem) && (
          <p role="alert" className="text-xs text-destructive">
            {importProblem ?? problem}
          </p>
        )}
        <Tabs defaultValue="shape">
          <TabsList>
            <TabsTrigger value="shape">Shape</TabsTrigger>
            <TabsTrigger value="grain">Grain</TabsTrigger>
            <TabsTrigger value="rendering">Rendering</TabsTrigger>
            <TabsTrigger value="dynamics">Dynamics</TabsTrigger>
          </TabsList>

          <TabsContent value="shape" className="space-y-3">
            <TextureSelect
              label="Tip"
              value={brush.shape.tipTextureId ?? null}
              textures={textures}
              noneLabel="Round (procedural)"
              onChange={(tipTextureId) => apply({ shape: { tipTextureId } })}
              onImport={
                onImportTexture &&
                ((file) =>
                  importTexture(file, (tipTextureId) =>
                    apply({ shape: { tipTextureId } })
                  ))
              }
            />
            <SliderSetting
              label="Size"
              value={brush.shape.radius}
              min={0.5}
              max={200}
              step={0.5}
              scale={2}
              decimals={1}
              unit="px"
              onChange={(radius) => apply({ shape: { radius } })}
            />
            <SliderSetting
              label="Hardness"
              value={hardnessOf(brush.shape.feather)}
              min={0}
              max={1}
              step={0.01}
              scale={100}
              unit="%"
              onChange={(hardness) =>
                apply({ shape: { feather: featherOf(hardness) } })
              }
            />
            <SliderSetting
              label="Roundness"
              value={brush.shape.roundness}
              min={0.05}
              max={1}
              step={0.01}
              scale={100}
              unit="%"
              onChange={(roundness) => apply({ shape: { roundness } })}
            />
            <SliderSetting
              label="Angle"
              value={brush.shape.angle}
              min={0}
              max={1}
              step={1 / 360}
              scale={360}
              unit="°"
              onChange={(angle) => apply({ shape: { angle } })}
            />
            <SliderSetting
              label="Spacing"
              value={brush.shape.spacing}
              min={0.02}
              max={2}
              step={0.01}
              scale={100}
              unit="% of tip"
              onChange={(spacing) => apply({ shape: { spacing } })}
            />
          </TabsContent>

          <TabsContent value="grain" className="space-y-3">
            <TextureSelect
              label="Paper"
              value={grain?.textureId ?? null}
              textures={textures}
              noneLabel="Smooth (no grain)"
              onImport={
                onImportTexture &&
                ((file) =>
                  importTexture(file, (textureId) =>
                    apply({
                      grain: {
                        scale: grain?.scale ?? 1,
                        depth: grain?.depth ?? 0.6,
                        movement: grain?.movement ?? 0,
                        textureId,
                      },
                    })
                  ))
              }
              onChange={(textureId) =>
                apply({
                  grain: textureId
                    ? {
                        scale: grain?.scale ?? 1,
                        depth: grain?.depth ?? 0.6,
                        movement: grain?.movement ?? 0,
                        textureId,
                      }
                    : null,
                })
              }
            />
            {grain ? (
              <>
                <SliderSetting
                  label="Grain scale"
                  value={grain.scale}
                  min={0.25}
                  max={8}
                  step={0.05}
                  decimals={2}
                  unit="×"
                  onChange={(scale) => apply({ grain: { ...grain, scale } })}
                />
                <SliderSetting
                  label="Grain depth"
                  value={grain.depth}
                  min={0}
                  max={1}
                  step={0.01}
                  scale={100}
                  unit="%"
                  onChange={(depth) => apply({ grain: { ...grain, depth } })}
                />
                <SliderSetting
                  label="Grain movement"
                  value={grain.movement}
                  min={0}
                  max={1}
                  step={0.01}
                  scale={100}
                  unit="%"
                  onChange={(movement) =>
                    apply({ grain: { ...grain, movement } })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Grain sits on the canvas, so the paper stays where it is as
                  the brush passes over it. Movement is how much of it travels
                  with the brush instead.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                This brush lays ink on a perfectly smooth surface.
              </p>
            )}
          </TabsContent>

          <TabsContent value="rendering" className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Dabs within a stroke</Label>
              <Select
                value={brush.rendering.accumulation}
                onValueChange={(accumulation) =>
                  apply({
                    rendering: {
                      accumulation: accumulation as "coverage" | "buildup",
                    },
                  })
                }
              >
                <SelectTrigger className="w-full" aria-label="Accumulation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="coverage">
                    Coverage — a crossing stays flat
                  </SelectItem>
                  <SelectItem value="buildup">
                    Buildup — a crossing darkens
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <SliderSetting
              label="Opacity"
              value={brush.rendering.opacity}
              min={0}
              max={1}
              step={0.01}
              scale={100}
              unit="%"
              onChange={(opacity) => apply({ rendering: { opacity } })}
            />
            <SliderSetting
              label="Flow"
              value={brush.rendering.flow}
              min={0}
              max={1}
              step={0.01}
              scale={100}
              unit="%"
              onChange={(flow) => apply({ rendering: { flow } })}
            />
          </TabsContent>

          <TabsContent value="dynamics" className="space-y-3">
            {dynamics.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Nothing the artist does with the pen reaches this brush yet. Add
                a mapping to drive a parameter from pressure, tilt, speed or
                randomness.
              </p>
            )}
            {dynamics.map((modulator, index) => (
              <Mapping
                key={index}
                index={index}
                modulator={modulator}
                onChange={(next) =>
                  apply({
                    dynamics: dynamics.map((existing, at) =>
                      at === index ? next : existing
                    ),
                  })
                }
                onRemove={() =>
                  apply({
                    dynamics: dynamics.filter((_, at) => at !== index),
                  })
                }
              />
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                apply({ dynamics: [...dynamics, newModulator("size")] })
              }
            >
              <PlusIcon />
              Add mapping
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          {/* Edits are already on the brush in the hand; what Save changes is
              the brush they are measured against, and Revert is the way back
              to it. Both are dead until the working brush has actually moved. */}
          <span className="mr-auto text-xs text-muted-foreground">
            {edited ? "Unsaved changes" : "No changes"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={!edited}
            onClick={onRevert}
          >
            Revert
          </Button>
          <Button size="sm" disabled={!edited} onClick={onSave}>
            Save brush
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
