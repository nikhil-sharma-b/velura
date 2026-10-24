import type { Brush } from "./brush"
import { type GimpBrush, readGbr, readGih } from "./gimp-resources"
import type { KritaPreset } from "./krita-preset"
import { shrinkToFit, tipFromImage } from "./source-image"
import type { GrayscaleTexture } from "./texture"
import { gimpTipSelection, type TipSelectionMode } from "./tip-sets"

/**
 * Tips an artist brings from elsewhere (brush library 07): GIMP's `.gbr` and
 * `.gih`, a handful of PNGs taken as one tip set, and the pattern a Krita
 * preset carries inside itself.
 *
 * Pure, like the readers it sits on, so the library's import and its tests run
 * the same code. Decoding a PNG is the one step that needs the browser, and is
 * left to the caller.
 */

/** The largest side a stored texture may have (`MAX_TEXTURE_DIMENSION`). */
export const STORED_SIDE = 512

/** Past this a brush is larger than the editor's size control reaches. */
const MAX_RADIUS = 200

export type ImportedTip = {
  name: string
  /** The source's size in pixels, before any shrinking to fit the store. */
  width: number
  height: number
  texture: GrayscaleTexture
  /** Distance between dabs as a fraction of the tip, if the file says. */
  spacing?: number
  selection?: TipSelectionMode
}

/** A frame centred on a larger, empty one: a tip set's frames share a size. */
function centred(
  frame: GrayscaleTexture,
  width: number,
  height: number
): Uint8Array {
  const data = new Uint8Array(width * height)
  const left = (width - frame.width) >> 1
  const top = (height - frame.height) >> 1
  for (let y = 0; y < frame.height; y++)
    data.set(
      frame.data.subarray(y * frame.width, (y + 1) * frame.width),
      (top + y) * width + left
    )
  return data
}

/**
 * Frames as one tip, at a size the store keeps.
 *
 * Every frame of a set is uploaded as one layer of a texture array, so they
 * must be one size: smaller frames are centred on the largest, which is how a
 * hose of mixed cells stamps. The store caps a texture's bytes across all of
 * its frames at one square of `limit`, so a long set of big frames is halved
 * until it fits rather than refused.
 */
export function tipSet(
  frames: readonly GrayscaleTexture[],
  limit = STORED_SIDE
): GrayscaleTexture {
  if (frames.length === 0)
    throw new Error("A tip set needs at least one frame.")
  if (frames.length > 256)
    throw new Error("A tip set may have at most 256 frames.")
  const width = Math.max(...frames.map((frame) => frame.width))
  const height = Math.max(...frames.map((frame) => frame.height))
  // `shrinkToFit` halves, so count halvings rather than aiming at a size.
  let w = width
  let h = height
  while (
    (w > 1 || h > 1) &&
    (w > limit || h > limit || w * h * frames.length > limit * limit)
  ) {
    w = Math.max(1, w >> 1)
    h = Math.max(1, h >> 1)
  }
  const side = Math.max(w, h)
  const fitted = frames.map((frame) =>
    shrinkToFit({ width, height, data: centred(frame, width, height) }, side)
  )
  const first = fitted[0]
  if (fitted.length === 1)
    return { width: first.width, height: first.height, data: first.data }
  const data = new Uint8Array(first.data.length * fitted.length)
  fitted.forEach((frame, i) => data.set(frame.data, i * first.data.length))
  return {
    width: first.width,
    height: first.height,
    frameCount: fitted.length,
    data,
  }
}

/** A `.gbr` or a `.gih`, as a tip. */
export function readGimpTip(
  bytes: Uint8Array,
  kind: "gbr" | "gih"
): ImportedTip {
  let cells: GimpBrush[]
  let name: string
  let selection: TipSelectionMode | undefined
  if (kind === "gbr") {
    const brush = readGbr(bytes)
    cells = [brush]
    name = brush.name
  } else {
    const hose = readGih(bytes)
    cells = hose.cells
    name = hose.name
    if (hose.selection) selection = gimpTipSelection(hose.selection)
  }
  const tip: ImportedTip = {
    name,
    width: Math.max(...cells.map((cell) => cell.width)),
    height: Math.max(...cells.map((cell) => cell.height)),
    texture: tipSet(cells.map(tipFromImage)),
    // GIMP's spacing is a percentage of the brush's width.
    spacing: Math.max(0.01, cells[0].spacing / 100),
  }
  if (selection) tip.selection = selection
  return tip
}

/**
 * A brush that stamps an imported tip: the tip at its own size, hard, laid
 * down as Krita lays a tip down (buildup), with the spacing the file asked for.
 */
export function tipBrush(
  name: string,
  textureId: string,
  tip: ImportedTip
): Brush {
  const brush: Brush = {
    id: textureId,
    name,
    shape: {
      radius: Math.min(
        MAX_RADIUS,
        Math.max(0.5, Math.max(tip.width, tip.height) / 2)
      ),
      feather: 0,
      roundness: 1,
      angle: 0,
      spacing: tip.spacing ?? 0.25,
      tipTextureId: textureId,
    },
    rendering: { accumulation: "buildup", opacity: 1, flow: 1 },
    dynamics: [],
  }
  if (tip.selection) brush.shape.tipSelection = tip.selection
  return brush
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

function fromBase64(text: string): Uint8Array | undefined {
  try {
    const binary = atob(text.replace(/\s+/g, ""))
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
  } catch {
    return undefined
  }
}

const isPng = (bytes: Uint8Array) =>
  PNG_SIGNATURE.every((value, i) => bytes[i] === value)

/**
 * The pattern a preset carries, as PNG bytes.
 *
 * Krita writes the texture option's pattern into the preset itself, so a
 * brush shared on its own still has its paper. It is a PNG, base64-encoded
 * into a byte array that the XML then base64-encodes again; one layer is
 * accepted too, in case a writer is less thorough.
 */
export function kritaEmbeddedPattern(
  preset: KritaPreset
): Uint8Array | undefined {
  const value = preset.params.get("Texture/Pattern/Pattern")
  if (!value) return undefined
  const once = fromBase64(value)
  if (!once) return undefined
  if (isPng(once)) return once
  const twice = fromBase64(new TextDecoder("latin1").decode(once))
  return twice && isPng(twice) ? twice : undefined
}

/**
 * The tip image a preset names. Krita does not embed it, only names it, so an
 * import can find it among the files the artist brought or the ones shipped.
 */
export function kritaTipFile(preset: KritaPreset): string | undefined {
  const definition = preset.params.get("brush_definition") ?? ""
  const brush = /<Brush\b([^>]*)>?/.exec(definition)
  return /\bfilename="([^"]+)"/.exec(brush?.[1] ?? "")?.[1] || undefined
}
