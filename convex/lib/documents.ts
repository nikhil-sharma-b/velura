/**
 * Document rules that hold with or without a database: size limits, presets,
 * and naming. Kept free of `ctx` so the studio can validate a create form
 * before a round trip and the mutation can enforce the same rule on arrival.
 */

/**
 * The engine allocates a layer texture per document, and `maxTextureDimension2D`
 * is 8192 on the WebGPU baseline (engine/index.ts falls back to the same number
 * when no device reports one). A document larger than that cannot be opened, so
 * it must not be creatable.
 */
export const MAX_CANVAS_SIZE = 8192
// A canvas with no pixels in it is not a document; the spec bounds size from
// above, and this is only the floor below which there is nothing to paint on.
export const MIN_CANVAS_SIZE = 1

export const DEFAULT_DOCUMENT_NAME = "Untitled"
export const MAX_DOCUMENT_NAME_LENGTH = 120

export type DocumentPreset = {
  readonly id: string
  readonly label: string
  readonly width: number
  readonly height: number
}

export const DOCUMENT_PRESETS: readonly DocumentPreset[] = [
  { id: "square-2048", label: "Square", width: 2048, height: 2048 },
  {
    id: "portrait-a4",
    label: "A4 portrait at 300 dpi",
    width: 2480,
    height: 3508,
  },
  {
    id: "landscape-a4",
    label: "A4 landscape at 300 dpi",
    width: 3508,
    height: 2480,
  },
  { id: "hd", label: "HD", width: 1920, height: 1080 },
  { id: "postcard", label: "Postcard at 300 dpi", width: 1748, height: 1181 },
]

export const DEFAULT_PRESET = DOCUMENT_PRESETS[0]

/** Returns null when the size is usable, or the reason it is not. */
export function canvasSizeProblem(
  width: number,
  height: number
): string | null {
  for (const [axis, value] of [
    ["Width", width],
    ["Height", height],
  ] as const) {
    if (!Number.isInteger(value))
      return `${axis} must be a whole number of pixels.`
    if (value < MIN_CANVAS_SIZE)
      return `${axis} must be at least ${MIN_CANVAS_SIZE} pixels.`
    if (value > MAX_CANVAS_SIZE)
      return `${axis} must be at most ${MAX_CANVAS_SIZE} pixels.`
  }
  return null
}

/**
 * Trims a user-supplied name, falling back to the default rather than allowing
 * a blank row that reads as a bug in the library list.
 */
export function normaliseDocumentName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ")
  if (trimmed.length === 0) return DEFAULT_DOCUMENT_NAME
  return trimmed.slice(0, MAX_DOCUMENT_NAME_LENGTH)
}

/**
 * Names a duplicate so repeated duplication does not produce
 * "a copy copy copy": the numeric suffix grows instead.
 */
export function duplicateName(
  name: string,
  existingNames: readonly string[]
): string {
  const base = name.replace(/ copy( \d+)?$/, "")
  const taken = new Set(existingNames)
  let candidate = `${base} copy`
  let counter = 2
  while (taken.has(candidate)) {
    candidate = `${base} copy ${counter}`
    counter += 1
  }
  return normaliseDocumentName(candidate)
}
