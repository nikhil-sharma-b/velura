/**
 * The Krita bundle both tooling scripts read, at a pinned commit so a re-run
 * writes the same bytes.
 */
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Resvg } from "@resvg/resvg-js"
import { PNG } from "pngjs"

import type { SourceImage } from "./convert"

export const REPOSITORY = "https://invent.kde.org/graphics/krita"
export const COMMIT = "97f42ad6326a3cfc15d7f158678433608acf13ce"
export const BUNDLE_PATH = "krita/data/bundles/Krita_4_Default_Resources.bundle"

export async function bundleBytes(): Promise<Uint8Array> {
  const flag = process.argv.indexOf("--bundle")
  if (flag !== -1) {
    const path = process.argv[flag + 1]
    if (!path) throw new Error("--bundle needs the path to a .bundle file.")
    return new Uint8Array(readFileSync(path))
  }
  const url = `${REPOSITORY}/-/raw/${COMMIT}/${BUNDLE_PATH}`
  const response = await fetch(url)
  if (!response.ok)
    throw new Error(`Fetching ${url} failed: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

export function unzip(bytes: Uint8Array): string {
  const scratch = mkdtempSync(join(tmpdir(), "krita-bundle-"))
  const archive = join(scratch, "bundle.zip")
  writeFileSync(archive, bytes)
  const out = join(scratch, "files")
  const result = spawnSync("unzip", ["-q", "-o", archive, "-d", out])
  if (result.status !== 0)
    throw new Error(`unzip failed: ${result.stderr.toString()}`)
  return out
}

export function readPng(bytes: Uint8Array): SourceImage {
  const png = PNG.sync.read(Buffer.from(bytes))
  return {
    width: png.width,
    height: png.height,
    channels: 4,
    pixels: new Uint8Array(png.data),
  }
}

/**
 * Rasterises an SVG tip with its longest side at `size` pixels. Text is not
 * drawn, so no system font can change the bytes.
 */
export function rasteriseSvg(bytes: Uint8Array, size: number): SourceImage {
  const svg = Buffer.from(bytes)
  const font = { loadSystemFonts: false }
  const { width, height } = new Resvg(svg, { font })
  const image = new Resvg(svg, {
    font,
    fitTo: { mode: width >= height ? "width" : "height", value: size },
  }).render()
  return {
    width: image.width,
    height: image.height,
    channels: 4,
    pixels: new Uint8Array(image.pixels),
  }
}
