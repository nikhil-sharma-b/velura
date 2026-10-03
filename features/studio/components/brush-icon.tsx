import {
  PencilIcon,
  PencilSimpleIcon,
  PenNibIcon,
  PaintBrushIcon,
  SprayBottleIcon,
  MarkerCircleIcon,
  EraserIcon,
  WaveformIcon,
} from "@phosphor-icons/react"

/** Material silhouettes stay consistent in the tool rail, picker and active control. */
export function BrushIcon({
  id,
  className,
}: {
  id: string
  className?: string
}) {
  const Icon =
    {
      "builtin:pencil": PencilIcon,
      "builtin:charcoal": PencilSimpleIcon,
      "builtin:ink": PenNibIcon,
      "builtin:round": PaintBrushIcon,
      "builtin:airbrush": SprayBottleIcon,
      "builtin:marker": MarkerCircleIcon,
    }[id] ?? PaintBrushIcon
  return (
    <Icon
      className={className}
      weight={id === "builtin:charcoal" ? "fill" : "regular"}
    />
  )
}

/** The solid eraser is a fixed block; the waveform badge signals pressure. */
export function EraserToolIcon({
  kind,
  className,
}: {
  kind: "solid" | "pressure"
  className?: string
}) {
  if (kind === "solid")
    return <EraserIcon className={className} weight="fill" />

  return (
    <span className="relative inline-flex size-5 items-center justify-center">
      <EraserIcon className={className} weight="regular" />
      <WaveformIcon
        aria-hidden="true"
        className="absolute -right-1 -bottom-1 size-2.5 rounded-full bg-primary p-px text-primary-foreground"
        weight="bold"
      />
    </span>
  )
}

/** The vector brush, badged like the eraser when its width follows pressure. */
export function VectorBrushToolIcon({
  kind,
  className,
}: {
  kind: "solid" | "pressure"
  className?: string
}) {
  if (kind === "solid")
    return <PaintBrushIcon className={className} weight="fill" />

  return (
    <span className="relative inline-flex size-5 items-center justify-center">
      <PaintBrushIcon className={className} weight="regular" />
      <WaveformIcon
        aria-hidden="true"
        className="absolute -right-1 -bottom-1 size-2.5 rounded-full bg-primary p-px text-primary-foreground"
        weight="bold"
      />
    </span>
  )
}
