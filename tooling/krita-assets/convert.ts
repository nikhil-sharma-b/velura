// The pixel rules live with the engine, which imports them too (brush library 07).
export {
  grainFromImage,
  shrinkToFit,
  type SourceImage,
  tipFromImage,
} from "../../engine/brush/source-image"

function stem(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.[^.]+$/, "")
}

/** The name a menu shows: Krita's `03_` ordering prefix gone, words spaced. */
export function assetName(file: string): string {
  const words = stem(file)
    .replace(/^\d+[a-z]?[_-]/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
  return words[0].toUpperCase() + words.slice(1)
}

/** The id under `krita:`, which brushes store: it must never change. */
export function assetSlug(file: string): string {
  return stem(file)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}
