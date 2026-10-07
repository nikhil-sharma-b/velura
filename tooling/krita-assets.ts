/**
 * Writes the shipped Krita textures (brush library 01).
 *
 *   bun run tooling/krita-assets.ts [--bundle path/to/Krita_4_Default_Resources.bundle]
 *
 * Reads Krita's Krita 4 default resource bundle — licensed CC0 in its own
 * `meta.xml` — and writes every tip and paper in it as a single-channel PNG
 * under `public/brushes/krita/`, with the manifest the studio lists them from
 * at `features/studio/lib/krita-textures.json`. Without `--bundle` it fetches
 * the bundle at the pinned commit below, so a re-run writes the same bytes.
 *
 * Only assets cross over. No Krita code is used: the files are read by
 * `engine/brush/gimp-resources.ts`, written from the formats themselves.
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { PNG } from "pngjs"

import { MAX_TEXTURE_DIMENSION } from "../convex/lib/brush"
import { readGbr, readGih, readPat } from "../engine/brush/gimp-resources"
import type { GrayscaleTexture } from "../engine/brush/texture"
import type {
  ShippedTexture,
  ShippedTextureManifest,
} from "../features/studio/lib/shipped-textures"
import {
  assetName,
  assetSlug,
  grainFromImage,
  shrinkToFit,
  tipFromImage,
} from "./krita-assets/convert"
import {
  BUNDLE_PATH,
  bundleBytes,
  COMMIT,
  readPng,
  REPOSITORY,
  unzip,
} from "./krita-assets/bundle"

const ROOT = resolve(import.meta.dir, "..")
const OUTPUT = join(ROOT, "public/brushes/krita")
const MANIFEST = join(ROOT, "features/studio/lib/krita-textures.json")

/**
 * Who made what the bundle holds. Its licence is CC0, which asks for nothing;
 * `krita/data/README` describes the brushes it grew from as CC-BY 3.0, which
 * asks for this. Crediting them satisfies either reading.
 */
const AUTHORS = [
  // As the bundle's own `dc:author` names them, plus the README's credit.
  "David Revoy (Deevad)",
  "Ramon Miranda",
  "Razvanc",
  "Radian",
  "Wolthera",
  "Storm",
  "Scottyp",
  "Blender Foundation",
]

function writeGrayPng(path: string, texture: GrayscaleTexture): number {
  const png = new PNG({ width: texture.width, height: texture.height })
  for (let i = 0; i < texture.data.length; i++) {
    const value = texture.data[i]
    png.data[i * 4] = png.data[i * 4 + 1] = png.data[i * 4 + 2] = value
    png.data[i * 4 + 3] = 255
  }
  const bytes = PNG.sync.write(png, {
    colorType: 0,
    inputColorType: 6,
    bitDepth: 8,
  })
  writeFileSync(path, bytes)
  return bytes.length
}

function write(files: string) {
  const meta = readFileSync(join(files, "meta.xml"), "utf8")
  if (!/meta:name="license" meta:value="CC-0"/.test(meta))
    throw new Error("The bundle no longer says it is CC0; stop and check.")

  rmSync(OUTPUT, { recursive: true, force: true })
  mkdirSync(join(OUTPUT, "tips"), { recursive: true })
  mkdirSync(join(OUTPUT, "grain"), { recursive: true })

  const textures: ShippedTexture[] = []
  const skipped: string[] = []
  let written = 0
  const fit = (texture: GrayscaleTexture) =>
    shrinkToFit(texture, MAX_TEXTURE_DIMENSION)

  const add = (
    source: string,
    kind: ShippedTexture["kind"],
    frames: GrayscaleTexture[],
    selection?: string
  ) => {
    const slug = assetSlug(source)
    const id = `krita:${slug}`
    if (textures.some((t) => t.id === id))
      throw new Error(`Two assets would both be ${id}.`)
    const folder = kind === "tip" ? "tips" : "grain"
    const names =
      frames.length === 1
        ? [`${folder}/${slug}.png`]
        : frames.map((_, i) => `${folder}/${slug}-${i}.png`)
    frames.forEach((frame, i) => {
      written += writeGrayPng(join(OUTPUT, names[i]), frame)
    })
    textures.push({
      id,
      name: assetName(source),
      kind,
      files: names,
      source: `${kind === "tip" ? "brushes" : "patterns"}/${source}`,
      ...(selection ? { selection } : {}),
    })
  }

  const read = (folder: string, file: string) =>
    new Uint8Array(readFileSync(join(files, folder, file)))

  for (const file of readdirSync(join(files, "brushes")).sort()) {
    try {
      if (file.endsWith(".gbr"))
        add(file, "tip", [fit(tipFromImage(readGbr(read("brushes", file))))])
      else if (file.endsWith(".gih")) {
        const hose = readGih(read("brushes", file))
        add(
          file,
          "tip",
          hose.cells.map((cell) => fit(tipFromImage(cell))),
          hose.selection
        )
      } else if (file.endsWith(".png"))
        add(file, "tip", [fit(tipFromImage(readPng(read("brushes", file))))])
      else skipped.push(`${file}: not a raster tip`)
    } catch (error) {
      skipped.push(`${file}: ${(error as Error).message}`)
    }
  }
  for (const file of readdirSync(join(files, "patterns")).sort()) {
    try {
      if (file.endsWith(".pat"))
        add(file, "grain", [
          fit(grainFromImage(readPat(read("patterns", file)))),
        ])
      else if (file.endsWith(".png"))
        add(file, "grain", [
          fit(grainFromImage(readPng(read("patterns", file)))),
        ])
      else skipped.push(`${file}: not a pattern`)
    } catch (error) {
      skipped.push(`${file}: ${(error as Error).message}`)
    }
  }

  const manifest: ShippedTextureManifest = {
    source: {
      name: "Krita 4 default resources",
      repository: REPOSITORY,
      commit: COMMIT,
      licence: "CC0 1.0",
      authors: AUTHORS,
    },
    textures,
  }
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(
    join(OUTPUT, "CREDITS.md"),
    [
      "# Krita textures",
      "",
      `Tips and papers from the Krita 4 default resource bundle (\`${BUNDLE_PATH}\`, ${REPOSITORY} at ${COMMIT}).`,
      "",
      "The bundle is released under CC0 1.0 (its `meta.xml`). The brushes it grew from are credited in `krita/data/README` under CC-BY 3.0 to David Revoy (www.davidrevoy.com) and the Blender Foundation (www.blender.org), with Ramon Miranda's GIMP Paint Studio.",
      "",
      `By: ${AUTHORS.join(", ")}.`,
      "",
      "Converted to single-channel PNGs by `tooling/krita-assets.ts`. No Krita source code is used.",
      "",
    ].join("\n")
  )

  const tips = textures.filter((t) => t.kind === "tip").length
  console.log(
    `${tips} tips and ${textures.length - tips} papers, ${(written / 1e6).toFixed(1)} MB`
  )
  for (const line of skipped) console.log(`skipped ${line}`)
}

const files = unzip(await bundleBytes())
try {
  write(files)
} finally {
  rmSync(dirname(files), { recursive: true, force: true })
}
