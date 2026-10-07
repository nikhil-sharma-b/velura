import type { Brush } from "@/engine/brush/brush"
import {
  type KritaTip,
  kritaTextureId,
  parseKritaPreset,
  readKpp,
  translateKritaPreset,
} from "@/engine/brush/krita-preset"
import {
  grainFromImage,
  type SourceImage,
  shrinkToFit,
  tipFromImage,
} from "@/engine/brush/source-image"
import type { GrayscaleTexture } from "@/engine/brush/texture"
import {
  type ImportedTip,
  kritaEmbeddedPattern,
  kritaTipFile,
  readGimpTip,
  STORED_SIDE,
  tipBrush,
  tipSet,
} from "@/engine/brush/tip-import"

/**
 * "Import brush…" (brush library 07): files from Krita or GIMP, made into
 * brushes in the artist's own library.
 *
 * A `.kpp` goes through the same translator the shipped brushes were ported
 * with, and what it could not carry is handed back to be shown. Its paper
 * comes out of the preset itself; its tip is only named there, so it is found
 * among the files brought with it, or among the shipped tips. A `.gbr`, a
 * `.gih` or a handful of PNGs on their own become a brush that stamps them.
 *
 * Everything that touches the browser or the store is passed in, so the whole
 * of what an import decides runs in a unit test.
 */

export type ImportFile = Readonly<{ name: string; bytes: Uint8Array }>

export type ImportDeps = {
  /** Any image the browser can read, as interleaved pixels. */
  decodeImage(bytes: Uint8Array): Promise<SourceImage>
  saveTexture(name: string, texture: GrayscaleTexture): Promise<string>
  save(name: string, set: string, brush: Brush): Promise<string>
  /** A shipped tip's size, so a preset naming one keeps it without the file. */
  shippedTip(id: string): Promise<KritaTip | undefined>
  shippedGrain(id: string): boolean
}

export type ImportedBrush = Readonly<{
  /** As saved, under the id the store gave it. */
  brush: Brush
  /** What the source had that the brush does not; empty for a plain tip. */
  dropped: readonly string[]
}>

export type ImportOutcome = Readonly<{
  imported: readonly ImportedBrush[]
  failed: readonly { file: string; reason: string }[]
}>

/** The set imported brushes are shelved in. */
export const IMPORT_SET = "Imported"

const TIP_EXTENSIONS = ["gbr", "gih", "png"] as const
type TipExtension = (typeof TIP_EXTENSIONS)[number]

function extension(name: string): string {
  return /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase() ?? ""
}

const baseName = (name: string) => name.split(/[\\/]/).pop()!.toLowerCase()

/** A file name as a person would say it: `03_rough_paper.png` is Rough paper. */
export function fileTitle(name: string): string {
  const words = (name.split(/[\\/]/).pop() ?? name)
    .replace(/\.[^.]+$/, "")
    .replace(/^\d+[a-z]?[_-]/i, "")
    .replace(/[_-]+/g, " ")
    .trim()
  return words ? words[0].toUpperCase() + words.slice(1) : "Imported"
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : "It could not be read."
}

/**
 * A tip from files: one `.gbr` or `.gih`, or PNGs taken as frames in name
 * order. Exported for the editor, whose tip import takes the same files.
 */
export async function readTipFiles(
  files: readonly ImportFile[],
  decodeImage: ImportDeps["decodeImage"]
): Promise<ImportedTip> {
  const kind = extension(files[0]?.name ?? "")
  if (files.length === 1 && (kind === "gbr" || kind === "gih"))
    return readGimpTip(files[0].bytes, kind)
  if (files.some((file) => extension(file.name) !== "png"))
    throw new Error(
      "A tip is one .gbr or .gih, or PNGs taken together as its frames."
    )
  const ordered = [...files].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  )
  const images = await Promise.all(
    ordered.map((file) => decodeImage(file.bytes))
  )
  return {
    // `splat-1.png` and `splat-2.png` are frames of Splat.
    name: fileTitle(ordered[0].name.replace(/[-_ ]*\d+(\.[^.]+)$/, "$1")),
    width: Math.max(...images.map((image) => image.width)),
    height: Math.max(...images.map((image) => image.height)),
    texture: tipSet(images.map(tipFromImage)),
  }
}

async function importPreset(
  file: ImportFile,
  tips: Map<string, ImportFile>,
  deps: ImportDeps
): Promise<ImportedBrush> {
  const preset = parseKritaPreset(await readKpp(file.bytes))
  const tipFile = kritaTipFile(preset)
  const companion = tipFile ? tips.get(baseName(tipFile)) : undefined
  if (preset.engine !== "paintbrush")
    // The translator's refusal, before any tip is read and can fail first.
    translateKritaPreset(preset)
  // A tip that will not read leaves the brush round, as a missing one does.
  let tipProblem: string | undefined
  const own = companion
    ? await readTipFiles([companion], deps.decodeImage).catch((error) => {
        tipProblem = `tip image ${companion.name}: ${reason(error)}, drawn round`
        return undefined
      })
    : undefined
  const shipped =
    tipFile && !own ? await deps.shippedTip(kritaTextureId(tipFile)) : undefined
  const pattern = kritaEmbeddedPattern(preset)

  const { brush, dropped } = translateKritaPreset(preset, {
    tip: () =>
      own
        ? { width: own.width, height: own.height, selection: undefined }
        : shipped,
    grain: (id) => deps.shippedGrain(id) || pattern !== undefined,
  })
  // Claimed only if the brush stamps it; otherwise it is a brush of its own.
  if (companion && own && brush.shape.tipTextureId)
    tips.delete(baseName(companion.name))
  const report = tipProblem
    ? [tipProblem, ...dropped.filter((line) => !line.startsWith("tip image "))]
    : dropped.map((line) =>
        line.replace(
          /: not shipped, drawn round$/,
          ": not included, drawn round"
        )
      )

  if (own && brush.shape.tipTextureId) {
    brush.shape.tipTextureId = await deps.saveTexture(own.name, own.texture)
    if (own.selection) brush.shape.tipSelection = own.selection
    else delete brush.shape.tipSelection
  }
  if (brush.grain && !deps.shippedGrain(brush.grain.textureId) && pattern) {
    const name = fileTitle(
      preset.params.get("Texture/Pattern/Name") || "Pattern"
    )
    try {
      const paper = shrinkToFit(
        grainFromImage(await deps.decodeImage(pattern)),
        STORED_SIDE
      )
      brush.grain.textureId = await deps.saveTexture(name, paper)
    } catch (error) {
      delete brush.grain
      report.push(`paper ${name}: ${reason(error)}`)
    }
  }

  const id = await deps.save(brush.name, IMPORT_SET, brush)
  return { brush: { ...brush, id }, dropped: report }
}

async function importTip(
  files: readonly ImportFile[],
  deps: ImportDeps
): Promise<ImportedBrush> {
  const tip = await readTipFiles(files, deps.decodeImage)
  const textureId = await deps.saveTexture(tip.name, tip.texture)
  const brush = tipBrush(tip.name, textureId, tip)
  const id = await deps.save(brush.name, IMPORT_SET, brush)
  return { brush: { ...brush, id }, dropped: [] }
}

/**
 * Imports what the artist chose, file by file: one that fails is reported and
 * the rest still arrive.
 */
export async function importBrushFiles(
  files: readonly ImportFile[],
  deps: ImportDeps
): Promise<ImportOutcome> {
  const imported: ImportedBrush[] = []
  const failed: { file: string; reason: string }[] = []
  const tips = new Map<string, ImportFile>()
  const presets: ImportFile[] = []
  for (const file of files) {
    const kind = extension(file.name)
    if (kind === "kpp") presets.push(file)
    else if (TIP_EXTENSIONS.includes(kind as TipExtension))
      tips.set(baseName(file.name), file)
    else
      failed.push({
        file: file.name,
        reason: "Only .kpp, .gbr, .gih or .png files can be imported.",
      })
  }

  for (const file of presets)
    try {
      imported.push(await importPreset(file, tips, deps))
    } catch (error) {
      failed.push({ file: file.name, reason: reason(error) })
    }

  // What no preset claimed: each GIMP file a brush, and the PNGs one set.
  const left = [...tips.values()]
  const pngs = left.filter((file) => extension(file.name) === "png")
  const groups = [
    ...left.filter((file) => extension(file.name) !== "png").map((f) => [f]),
    ...(pngs.length ? [pngs] : []),
  ]
  for (const group of groups)
    try {
      imported.push(await importTip(group, deps))
    } catch (error) {
      failed.push({
        file: group.map((file) => file.name).join(", "),
        reason: reason(error),
      })
    }

  return { imported, failed }
}
