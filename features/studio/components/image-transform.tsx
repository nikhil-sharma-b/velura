"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowsCounterClockwiseIcon,
  CheckIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  XIcon,
} from "@phosphor-icons/react"

import type {
  Engine,
  EngineSnapshot,
  ImagePlacement,
  Snap,
  SnapTargets,
} from "@/engine"
import {
  docToScreen,
  handlesShown,
  canBreak,
  canJoin,
  selectedSegments,
  placementExtent,
  resolveSnap,
  flippedPlacement,
  handlePoints,
  movedPlacement,
  nudgedPlacement,
  placementCorners,
  rotatedPlacement,
  invertMatrix,
  scaledPlacement,
  type NodeType,
  type PlacementHandle,
  type SegmentShape,
  type ViewMatrix,
} from "@/engine"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { IconButton } from "./icon-button"

/**
 * The box an artist moves a placed image by (06).
 *
 * Every drag here is a placement — a position, a size, an angle — handed to
 * the engine, which renders the picture from the original each time. Nothing
 * in this file touches a pixel, which is exactly why a photograph can be
 * nudged all afternoon and stay as sharp as the file that was dropped.
 *
 * The box lives in document space and is drawn through the same view matrix
 * the canvas is presented with, so it stays on the picture through a zoom, a
 * pan, a canvas rotation and a flip without knowing anything about them.
 */

/** Fine nudges; the same step a selection has anywhere else. */
const NUDGE = 1
const COARSE_NUDGE = 10
/** How near a right angle a turn snaps, with the modifier held. */
const SNAP_STEP = Math.PI / 12
/** How near an edge or centre a drag is pulled onto it, in CSS pixels (15). */
const SNAP_REACH = 6

/**
 * Snapping is suspended while Ctrl or Cmd is held (15): Shift already means
 * "keep the shape" or "step the angle", and Alt is the eyedropper.
 */
const snapSuspended = (event: { ctrlKey: boolean; metaKey: boolean }) =>
  event.ctrlKey || event.metaKey

type Point = { x: number; y: number }

/** Document pixels to CSS pixels of the canvas element. */
export function useDocumentToCss(
  canvas: HTMLCanvasElement | null,
  snapshot: EngineSnapshot
) {
  // The view matrix is in backing-store pixels; the overlay is laid out in
  // CSS pixels, so the two differ by whatever the display's density is.
  const [density, setDensity] = useState(1)
  useEffect(() => {
    if (!canvas) return
    const measure = () => {
      const bounds = canvas.getBoundingClientRect()
      setDensity(bounds.width > 0 ? canvas.width / bounds.width : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [canvas])

  return useMemo(() => {
    const matrix = docToScreen(
      snapshot.view,
      { width: snapshot.width, height: snapshot.height },
      { width: canvas?.width ?? 1, height: canvas?.height ?? 1 }
    )
    const [a, b, c, d, e, f] = matrix
    // The view matrix is in backing pixels; one divide puts the whole affine
    // into the CSS pixels this overlay is laid out in.
    const scaled: ViewMatrix = [
      a / density,
      b / density,
      c / density,
      d / density,
      e / density,
      f / density,
    ]
    const inverse = invertMatrix(scaled)
    return {
      toCss: (point: Point) => ({
        x: scaled[0] * point.x + scaled[2] * point.y + scaled[4],
        y: scaled[1] * point.x + scaled[3] * point.y + scaled[5],
      }),
      toDoc: (point: Point) => ({
        x: inverse[0] * point.x + inverse[2] * point.y + inverse[4],
        y: inverse[1] * point.x + inverse[3] * point.y + inverse[5],
      }),
    }
  }, [snapshot.view, snapshot.width, snapshot.height, canvas, density])
}

type Drag =
  | { kind: "move"; from: Point; start: ImagePlacement }
  | { kind: "scale"; handle: Exclude<PlacementHandle, "rotate"> }
  | { kind: "rotate"; start: ImagePlacement; fromAngle: number }

/** A placed image's box: previews re-rendered from the original file (06). */
export function ImageTransform({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const transform = snapshot.imageTransform
  if (!transform) return null
  return (
    <TransformBox
      engine={engine}
      snapshot={snapshot}
      canvas={canvas}
      placement={transform.placement}
      snapTargets={transform.snapTargets}
      subject="image"
      commands={{
        adjust: "adjustImageTransform",
        commit: "commitImageTransform",
        cancel: "cancelImageTransform",
      }}
      status={
        // The honest number. Above the picture's own resolution the extra
        // pixels are the resampler's invention, and saying so is the
        // difference between a tool and a stretch.
        transform.resolution > 1.005
          ? `${Math.round(transform.resolution * 100)}% — larger than the picture’s own detail`
          : `${Math.round(transform.resolution * 100)}% of the picture’s own detail`
      }
    />
  )
}

/**
 * A painted layer's box (13): the same handles, drawn from a snapshot of the
 * layer taken as it was picked up rather than from a file. With a selection,
 * the box is the selection's and only its pixels move (14).
 */
export function LayerTransform({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const transform = snapshot.layerTransform
  if (!transform) return null
  return (
    <TransformBox
      engine={engine}
      snapshot={snapshot}
      canvas={canvas}
      placement={transform.placement}
      snapTargets={transform.snapTargets}
      subject={transform.lifted ? "selection" : "layer"}
      commands={{
        adjust: "adjustLayerTransform",
        commit: "commitLayerTransform",
        cancel: "cancelLayerTransform",
      }}
    />
  )
}

/** The selected objects stay visible before their transform is opened. */
export function VectorSelection({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const { toCss } = useDocumentToCss(canvas, snapshot)
  const box = snapshot.vectorSelectionBounds
  if (!box || snapshot.vectorTransform || snapshot.tool !== "objectSelect")
    return null
  const points = [
    toCss({ x: box.x, y: box.y }),
    toCss({ x: box.x + box.width, y: box.y }),
    toCss({ x: box.x + box.width, y: box.y + box.height }),
    toCss({ x: box.x, y: box.y + box.height }),
  ]
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
      aria-label="Selected vector objects"
    >
      <polygon
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <circle
        cx={points[0].x}
        cy={points[0].y}
        r={5}
        fill="var(--primary)"
        className="pointer-events-auto cursor-move"
        aria-label="Transform selected objects"
        onPointerDown={() =>
          void engine.dispatch({ type: "beginVectorTransform" })
        }
      />
    </svg>
  )
}

export function VectorTransform(props: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const transform = props.snapshot.vectorTransform
  if (!transform) return null
  return (
    <TransformBox
      {...props}
      placement={transform.placement}
      snapTargets={transform.snapTargets}
      subject="objects"
      commands={{
        adjust: "adjustVectorPlacement",
        commit: "commitVectorTransform",
        cancel: "cancelVectorTransform",
      }}
    />
  )
}

function TransformBox({
  engine,
  snapshot,
  canvas,
  placement,
  snapTargets,
  subject,
  commands,
  status,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
  placement: ImagePlacement
  snapTargets: SnapTargets
  subject: "image" | "layer" | "selection" | "objects"
  commands: {
    adjust:
      | "adjustImageTransform"
      | "adjustLayerTransform"
      | "adjustVectorPlacement"
    commit:
      | "commitImageTransform"
      | "commitLayerTransform"
      | "commitVectorTransform"
    cancel:
      | "cancelImageTransform"
      | "cancelLayerTransform"
      | "cancelVectorTransform"
  }
  status?: string
}) {
  const { toCss, toDoc } = useDocumentToCss(canvas, snapshot)
  const drag = useRef<Drag | null>(null)
  const box = useRef<HTMLDivElement>(null)
  /** The lines a drag is snapped onto right now, drawn as guides. */
  const [guides, setGuides] = useState<Snap["guides"] | null>(null)

  const adjust = useCallback(
    (next: ImagePlacement) => {
      void engine
        .dispatch({ type: commands.adjust, placement: next })
        .catch(() => {
          // A placement the engine will not take — dragged to nothing, or
          // past what it will render — simply does not move the box.
        })
    },
    [engine, commands.adjust]
  )

  // The box takes the keyboard as soon as it appears: the arrow keys are how
  // a placement is put exactly where it belongs, and hunting for something to
  // click first would be in the way of that.
  useEffect(() => {
    box.current?.focus()
  }, [])

  const corners = placementCorners(placement).map(toCss)
  const handles = handlePoints(placement)

  const pointerIn = (event: { clientX: number; clientY: number }): Point => {
    const bounds = canvas?.getBoundingClientRect()
    return toDoc({
      x: event.clientX - (bounds?.left ?? 0),
      y: event.clientY - (bounds?.top ?? 0),
    })
  }

  const angleTo = (point: Point) =>
    Math.atan2(point.y - placement.y, point.x - placement.x)

  /** The snap reach in document pixels, at the zoom the artist is at. */
  const reach = () => {
    const origin = toDoc({ x: 0, y: 0 })
    const along = toDoc({ x: SNAP_REACH, y: 0 })
    return Math.hypot(along.x - origin.x, along.y - origin.y)
  }

  const onPointerMove = (event: React.PointerEvent) => {
    const active = drag.current
    if (!active) return
    const point = pointerIn(event)
    const snapping = snapshot.snapping && !snapSuspended(event)
    if (active.kind === "move") {
      const moved = movedPlacement(active.start, {
        dx: point.x - active.from.x,
        dy: point.y - active.from.y,
      })
      const snap = snapping
        ? resolveSnap(placementExtent(moved), snapTargets, reach())
        : null
      setGuides(snap?.guides ?? null)
      adjust(snap ? movedPlacement(moved, snap) : moved)
    } else if (active.kind === "scale") {
      // The handle itself is what snaps, along the axes it moves, so the
      // edge it drags lands on a line. Only an upright box's edges are
      // upright, and a corner that keeps the shape moves both edges from one
      // axis's demand, so those are left to the hand.
      const horizontal = active.handle !== "top" && active.handle !== "bottom"
      const vertical = active.handle !== "left" && active.handle !== "right"
      const keepsShape = !event.shiftKey && horizontal && vertical
      const snap =
        snapping && placement.rotation === 0 && !keepsShape
          ? resolveSnap(
              { ...point, width: 0, height: 0 },
              {
                x: horizontal ? snapTargets.x : [],
                y: vertical ? snapTargets.y : [],
              },
              reach()
            )
          : null
      setGuides(snap?.guides ?? null)
      const to = snap ? { x: point.x + snap.dx, y: point.y + snap.dy } : point
      adjust(
        scaledPlacement(placement, active.handle, to, {
          // A corner keeps the picture's shape, because a stretched
          // photograph is nearly always a mistake; Shift is how stretching is
          // asked for on purpose, and an edge handle is one axis anyway.
          preserveAspect: !event.shiftKey && active.handle.includes("-"),
        })
      )
    } else {
      const turned = active.start.rotation + (angleTo(point) - active.fromAngle)
      adjust(
        rotatedPlacement(
          placement,
          event.shiftKey ? Math.round(turned / SNAP_STEP) * SNAP_STEP : turned
        )
      )
    }
  }

  const begin = (event: React.PointerEvent<SVGElement>, next: Drag) => {
    event.preventDefault()
    event.stopPropagation()
    ;(event.target as Element).setPointerCapture(event.pointerId)
    drag.current = next
  }

  const end = (event: React.PointerEvent) => {
    if (!drag.current) return
    drag.current = null
    setGuides(null)
    ;(event.target as Element).releasePointerCapture?.(event.pointerId)
  }

  const commit = () => void engine.dispatch({ type: commands.commit })
  const cancel = () => void engine.dispatch({ type: commands.cancel })

  const outline = corners.map((point) => `${point.x},${point.y}`).join(" ")
  const handleAt = (name: PlacementHandle) => toCss(handles[name])
  const scaleHandles: Exclude<PlacementHandle, "rotate">[] = [
    "top-left",
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
  ]

  return (
    <div
      ref={box}
      role="group"
      tabIndex={-1}
      aria-label={
        subject === "image"
          ? "Move, scale or rotate the placed image"
          : `Move, scale or rotate the ${subject}`
      }
      data-testid={`${subject}-transform`}
      className="absolute inset-0 outline-none"
      onKeyUp={(event) => {
        // Letting go of the suspend key shows nothing stale; the next move
        // snaps again.
        if (event.key === "Control" || event.key === "Meta") setGuides(null)
      }}
      onKeyDown={(event) => {
        if (event.key === "Control" || event.key === "Meta") setGuides(null)
        const step = event.shiftKey ? COARSE_NUDGE : NUDGE
        const nudge = (dx: number, dy: number) => {
          event.preventDefault()
          adjust(nudgedPlacement(placement, { dx: dx * step, dy: dy * step }))
        }
        // Typing a number is not a nudge or a commit; Escape still cancels.
        if (event.target instanceof HTMLInputElement && event.key !== "Escape")
          return
        if (event.key === "ArrowLeft") nudge(-1, 0)
        else if (event.key === "ArrowRight") nudge(1, 0)
        else if (event.key === "ArrowUp") nudge(0, -1)
        else if (event.key === "ArrowDown") nudge(0, 1)
        else if (event.key === "Enter") commit()
        else if (event.key === "Escape") cancel()
      }}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        // The box is the only thing on this layer that takes a pointer: the
        // rest of the canvas is still the canvas.
        style={{ pointerEvents: "none" }}
      >
        {guides?.x != null && (
          <line
            data-testid="snap-guide-x"
            x1={toCss({ x: guides.x, y: 0 }).x}
            y1={toCss({ x: guides.x, y: 0 }).y}
            x2={toCss({ x: guides.x, y: snapshot.height }).x}
            y2={toCss({ x: guides.x, y: snapshot.height }).y}
            className="stroke-brand-coral"
            strokeWidth={1}
          />
        )}
        {guides?.y != null && (
          <line
            data-testid="snap-guide-y"
            x1={toCss({ x: 0, y: guides.y }).x}
            y1={toCss({ x: 0, y: guides.y }).y}
            x2={toCss({ x: snapshot.width, y: guides.y }).x}
            y2={toCss({ x: snapshot.width, y: guides.y }).y}
            className="stroke-brand-coral"
            strokeWidth={1}
          />
        )}
        <polygon
          points={outline}
          className="fill-brand-gold/5 stroke-brand-gold"
          strokeWidth={1.5}
          style={{ pointerEvents: "fill", cursor: "move" }}
          onPointerDown={(event) =>
            begin(event, {
              kind: "move",
              from: pointerIn(event),
              start: placement,
            })
          }
        />
        <line
          x1={handleAt("top").x}
          y1={handleAt("top").y}
          x2={handleAt("rotate").x}
          y2={handleAt("rotate").y}
          className="stroke-brand-gold"
          strokeWidth={1.5}
        />
        {scaleHandles.map((name) => {
          const point = handleAt(name)
          return (
            <rect
              key={name}
              data-testid={`transform-handle-${name}`}
              x={point.x - 5}
              y={point.y - 5}
              width={10}
              height={10}
              className="fill-studio-surface stroke-brand-gold"
              strokeWidth={1.5}
              style={{ pointerEvents: "all", cursor: "pointer" }}
              onPointerDown={(event) =>
                begin(event, {
                  kind: "scale",
                  handle: name,
                })
              }
            />
          )
        })}
        <circle
          data-testid="transform-handle-rotate"
          cx={handleAt("rotate").x}
          cy={handleAt("rotate").y}
          r={6}
          className="fill-studio-surface stroke-brand-gold"
          strokeWidth={1.5}
          style={{ pointerEvents: "all", cursor: "grab" }}
          onPointerDown={(event) =>
            begin(event, {
              kind: "rotate",
              start: placement,
              fromAngle: angleTo(pointerIn(event)),
            })
          }
        />
      </svg>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-studio-edge bg-studio-surface/95 px-3 py-1.5 text-xs shadow-lg">
        {status && <span data-testid="transform-resolution">{status}</span>}
        <PlacementFields placement={placement} onChange={adjust} />
        <IconButton
          label="Flip horizontally"
          variant="ghost"
          size="sm"
          aria-label={`Flip the ${subject} horizontally`}
          onClick={() => adjust(flippedPlacement(placement, "horizontal"))}
        >
          <FlipHorizontalIcon />
        </IconButton>
        <IconButton
          label="Flip vertically"
          variant="ghost"
          size="sm"
          aria-label={`Flip the ${subject} vertically`}
          onClick={() => adjust(flippedPlacement(placement, "vertical"))}
        >
          <FlipVerticalIcon />
        </IconButton>
        <IconButton
          label="Rotate 90°"
          variant="ghost"
          size="sm"
          aria-label={`Turn the ${subject} a quarter turn`}
          onClick={() =>
            adjust(
              rotatedPlacement(placement, placement.rotation + Math.PI / 2)
            )
          }
        >
          <ArrowsCounterClockwiseIcon />
        </IconButton>
        <IconButton label="Cancel" variant="ghost" size="sm" onClick={cancel}>
          <XIcon />
        </IconButton>
        <IconButton label="Done" variant="default" size="sm" onClick={commit}>
          <CheckIcon />
        </IconButton>
      </div>
    </div>
  )
}

function resized(
  placement: ImagePlacement,
  width: number | null,
  height: number | null
): ImagePlacement {
  const dx = ((width ?? placement.width) - placement.width) / 2
  const dy = ((height ?? placement.height) - placement.height) / 2
  const cos = Math.cos(placement.rotation)
  const sin = Math.sin(placement.rotation)
  return {
    ...placement,
    x: placement.x + dx * cos - dy * sin,
    y: placement.y + dx * sin + dy * cos,
    width: width ?? placement.width,
    height: height ?? placement.height,
  }
}

/**
 * Numeric entry (13): the box's top-left corner as it stands unturned, its
 * size, and its angle in degrees. Committed on Enter or blur, so a
 * half-typed number is never sent.
 */
function PlacementFields({
  placement,
  onChange,
}: {
  placement: ImagePlacement
  onChange: (placement: ImagePlacement) => void
}) {
  const fields: {
    key: string
    label: string
    value: number
    apply: (value: number) => ImagePlacement | null
  }[] = [
    {
      key: "x",
      label: "X",
      value: placement.x - placement.width / 2,
      apply: (value) => ({ ...placement, x: value + placement.width / 2 }),
    },
    {
      key: "y",
      label: "Y",
      value: placement.y - placement.height / 2,
      apply: (value) => ({ ...placement, y: value + placement.height / 2 }),
    },
    {
      key: "w",
      label: "W",
      value: placement.width,
      // Resized about the box's own top-left corner, along its own edges,
      // so a turned box grows the way its handles would drag it.
      apply: (value) => (value > 0 ? resized(placement, value, null) : null),
    },
    {
      key: "h",
      label: "H",
      value: placement.height,
      apply: (value) => (value > 0 ? resized(placement, null, value) : null),
    },
    {
      key: "angle",
      label: "°",
      value: (placement.rotation * 180) / Math.PI,
      apply: (value) => ({ ...placement, rotation: (value * Math.PI) / 180 }),
    },
  ]
  return (
    <div className="flex items-center gap-1">
      {fields.map((field) => (
        <label key={field.key} className="flex items-center gap-0.5">
          <span className="text-muted-foreground">{field.label}</span>
          <input
            // Re-keyed on the value, so a drag shows through and an entry
            // the engine refused snaps back.
            key={Math.round(field.value * 100)}
            data-testid={`transform-field-${field.key}`}
            aria-label={field.label === "°" ? "Angle" : field.label}
            type="number"
            defaultValue={Math.round(field.value * 100) / 100}
            className="w-14 rounded border border-studio-edge bg-transparent px-1 py-0.5 tabular-nums"
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur()
            }}
            onBlur={(event) => {
              const value = Number(event.currentTarget.value)
              if (!Number.isFinite(value) || event.currentTarget.value === "")
                return
              if (Math.abs(value - field.value) < 0.005) return
              const next = field.apply(value)
              if (next) onChange(next)
            }}
          />
        </label>
      ))}
    </div>
  )
}

/** What the hint bar can make of the selected segments. */
const SEGMENT_BUTTONS: readonly {
  shape: SegmentShape
  label: string
  keys: string
}[] = [
  { shape: "line", label: "Line", keys: "Shift+L" },
  { shape: "curve", label: "Curve", keys: "Shift+U" },
]

/** The node types the hint bar offers, in Inkscape's order. */
const NODE_TYPE_BUTTONS: readonly {
  nodeType: NodeType
  label: string
  keys: string
}[] = [
  { nodeType: "cusp", label: "Cusp", keys: "Shift+C" },
  { nodeType: "smooth", label: "Smooth", keys: "Shift+S" },
  { nodeType: "symmetric", label: "Symmetric", keys: "Shift+Y" },
  { nodeType: "auto", label: "Auto-smooth", keys: "Shift+A" },
]

/** The engine owns pointer input; this overlay only displays editable nodes. */
export function VectorNodes({
  engine,
  snapshot,
  canvas,
}: {
  engine: Engine
  snapshot: EngineSnapshot
  canvas: HTMLCanvasElement | null
}) {
  const { toCss } = useDocumentToCss(canvas, snapshot)
  const overlay = useRef<SVGSVGElement>(null)
  useEffect(() => {
    return engine.observeVectorControls((objects, penNodes) => {
      const svg = overlay.current
      if (!svg) return
      const paths =
        snapshot.tool === "pen"
          ? [
              {
                id: "draft",
                transform: [1, 0, 0, 1, 0, 0] as const,
                nodes: penNodes,
                object: null,
              },
            ]
          : objects.flatMap((o) =>
              o.geometry.kind === "path"
                ? [
                    {
                      id: o.id,
                      transform: o.transform,
                      nodes: o.geometry.nodes,
                      object: o,
                    },
                  ]
                : []
            )
      const fragment = document.createDocumentFragment()
      const element = (
        tag: "line" | "circle" | "rect" | "polygon",
        attributes: Record<string, string | number>
      ) => {
        const node = document.createElementNS("http://www.w3.org/2000/svg", tag)
        for (const [key, value] of Object.entries(attributes))
          node.setAttribute(key, String(value))
        fragment.appendChild(node)
      }
      for (const path of paths) {
        const [a, b, c, d, e, f] = path.transform
        const screen = (p: { x: number; y: number }) =>
          toCss({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f })
        path.nodes.forEach((node, index) => {
          const anchor = screen(node)
          // The pen shows every handle it is drawing; the node tool only
          // those of the selected nodes and their neighbours, as Inkscape.
          const handles =
            !path.object ||
            handlesShown(path.object, index, snapshot.vectorNodes)
          for (const handle of handles ? [node.in, node.out] : []) {
            if (!handle) continue
            const point = screen(handle)
            element("line", {
              x1: anchor.x,
              y1: anchor.y,
              x2: point.x,
              y2: point.y,
              stroke: "var(--primary)",
              "stroke-width": 1,
            })
            element("circle", {
              cx: point.x,
              cy: point.y,
              r: 3,
              fill: "var(--background)",
              stroke: "var(--primary)",
            })
          }
          const selected = snapshot.vectorNodes.some(
            (n) => n.objectId === path.id && n.index === index
          )
          // Each type its own marker, as Inkscape: a cusp a diamond, a
          // smooth node a square, a symmetric one a square with a dot, an
          // auto node a circle.
          const paint = {
            fill: selected ? "var(--primary)" : "var(--background)",
            stroke: "var(--primary)",
          }
          const { x, y } = anchor
          if (node.type === "cusp")
            element("polygon", {
              points: `${x},${y - 5} ${x + 5},${y} ${x},${y + 5} ${x - 5},${y}`,
              ...paint,
            })
          else if (node.type === "auto")
            element("circle", { cx: x, cy: y, r: 4, ...paint })
          else
            element("rect", {
              x: x - 4,
              y: y - 4,
              width: 8,
              height: 8,
              ...paint,
            })
          if (node.type === "symmetric")
            element("circle", {
              cx: x,
              cy: y,
              r: 1.5,
              fill: selected ? "var(--background)" : "var(--primary)",
            })
        })
      }
      svg.replaceChildren(fragment)
    })
  }, [engine, snapshot.tool, snapshot.vectorNodes, toCss])
  if (snapshot.tool !== "node" && snapshot.tool !== "pen") return null
  const hasSegments =
    selectedSegments(snapshot.vectorPaths, snapshot.vectorNodes).length > 0
  return (
    <>
      <svg
        ref={overlay}
        className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
        aria-label="Path anchors and handles"
      />
      <ToolHint>
        {snapshot.tool === "pen" ? (
          <>
            <span>Click anchors · drag handles · click first to close</span>
            <Button
              size="sm"
              variant="outline"
              disabled={snapshot.penNodes.length < 2}
              onClick={() => void engine.dispatch({ type: "finishPenPath" })}
            >
              Finish open path
            </Button>
          </>
        ) : (
          <>
            <span>
              {snapshot.vectorHandleHeld
                ? "Ctrl snaps to 15° · Alt keeps the length · Shift mirrors a cusp · Ctrl+click retracts"
                : "Click or drag to select nodes · Shift adds · double-click a segment to add · Shift+drag a bare anchor pulls a handle"}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {nodeCount(snapshot)}
            </span>
            {SEGMENT_BUTTONS.map(({ shape, label, keys }) => (
              <Button
                key={shape}
                size="sm"
                variant="outline"
                title={`Make selected segments ${shape}s (${keys})`}
                disabled={!hasSegments}
                onClick={() =>
                  void engine.dispatch({ type: "setVectorSegmentShape", shape })
                }
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              title="Insert a node in each selected segment (Insert)"
              disabled={!hasSegments}
              onClick={() =>
                void engine.dispatch({ type: "insertVectorNodes" })
              }
            >
              Insert
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Break the path at the selected nodes (Shift+B)"
              disabled={!canBreak(snapshot.vectorPaths, snapshot.vectorNodes)}
              onClick={() => void engine.dispatch({ type: "breakVectorNodes" })}
            >
              Break
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Join the two selected end nodes (Shift+J)"
              disabled={
                !canJoin(snapshot.vectorPaths, snapshot.vectorNodes, "merge")
              }
              onClick={() => void engine.dispatch({ type: "joinVectorNodes" })}
            >
              Join
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Join the two selected end nodes with a segment (Alt+J)"
              disabled={
                !canJoin(snapshot.vectorPaths, snapshot.vectorNodes, "segment")
              }
              onClick={() =>
                void engine.dispatch({ type: "joinVectorNodes", segment: true })
              }
            >
              Join with segment
            </Button>
            <Button
              size="sm"
              variant="outline"
              title="Delete the selected segments (Alt+Delete)"
              disabled={!hasSegments}
              onClick={() =>
                void engine.dispatch({ type: "deleteVectorSegments" })
              }
            >
              Delete segment
            </Button>
            {(["horizontal", "vertical"] as const).map((axis) => (
              <Button
                key={axis}
                size="sm"
                variant="outline"
                title={`Flip the selected nodes ${axis}ly (${axis === "horizontal" ? "H" : "V"})`}
                disabled={!snapshot.vectorNodes.length}
                onClick={() =>
                  void engine.dispatch({
                    type: "transformVectorNodes",
                    transform: { kind: "flip", axis },
                  })
                }
              >
                {axis === "horizontal" ? "Flip H" : "Flip V"}
              </Button>
            ))}
            {NODE_TYPE_BUTTONS.map(({ nodeType, label, keys }) => (
              <Button
                key={nodeType}
                size="sm"
                variant="outline"
                title={`Make ${label.toLowerCase()} (${keys})`}
                disabled={!snapshot.vectorNodes.length}
                onClick={() =>
                  void engine.dispatch({ type: "setVectorNodeType", nodeType })
                }
              >
                {label}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              title="Delete nodes, keeping the shape (Delete) · without keeping it (Ctrl+Delete)"
              disabled={!snapshot.vectorNodes.length}
              onClick={() => void engine.dispatch({ type: "deleteVectorNode" })}
            >
              Delete
            </Button>
          </>
        )}
      </ToolHint>
    </>
  )
}

/** "3 of 12 nodes selected", over the paths being edited. */
function nodeCount(snapshot: EngineSnapshot) {
  const total = snapshot.vectorPaths.reduce(
    (sum, o) =>
      sum + (o.geometry.kind === "path" ? o.geometry.nodes.length : 0),
    0
  )
  return total
    ? `${snapshot.vectorNodes.length} of ${total} nodes selected`
    : "No path selected"
}

/** How a polygon is closed, shown while the tool is in the hand. */
export function PolygonHint({ snapshot }: { snapshot: EngineSnapshot }) {
  if (snapshot.tool !== "polygon") return null
  return (
    <ToolHint inert>
      Click corners · click the first, double-click or press Enter to close
    </ToolHint>
  )
}

/** The bar under the canvas that says how the tool in the hand is used. */
function ToolHint({
  children,
  inert = false,
}: {
  children: React.ReactNode
  /** Words only, so clicks pass through it to the canvas. */
  inert?: boolean
}) {
  return (
    <div
      className={cn(
        "absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-background/95 p-2 text-xs shadow-lg",
        inert && "pointer-events-none"
      )}
    >
      {children}
    </div>
  )
}
