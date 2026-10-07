# Velura Brush Library — Product Spec

**Status:** ready-for-agent
**Date:** 2026-10-07
**Predecessor:** `docs/design/prd-v2.md`. Companion: `docs/design/architecture.md` (D23–D27, D30, D32).
**Issues:** `.scratch/brush-library/issues/`

---

## Problem Statement

Velura's brush engine is a real one (D23: parameters plus a dynamics graph; D24: tip textures and canvas grain), but it ships six built-in raster brushes and two procedural tips. An artist opening the studio finds a pencil, charcoal, an ink pen, a round brush, an airbrush and a marker, and nothing for texture, foliage, chalk, bristle, rake, splatter or effects work. Parts of the engine model are also evaluated but never drawn: the dynamics graph produces `scatter` and `hue`, and no renderer reads them.

Vector layers have one brush: a centre-line stroke that is either solid or pressure-sized, with a taper. There is no way to choose between inking characters, no calligraphic nib, no brush that lays a shape along a path, and no way to save a vector brush of one's own.

## Solution

**Raster.** Finish the parts of the brush model that are evaluated but not drawn (scatter, colour dynamics), add multi-frame tips, and port a curated set of Krita's default brushes into Velura's own brush format, together with their tips and paper textures. Krita's Krita 4 default resource bundle is licensed CC0 (bundle `meta.xml`), so its tips, patterns and preset parameters can ship in Velura. Krita's source code is GPL and is not used; only assets and numbers cross over. The same translator lets an artist import a Krita brush (`.kpp`, paintbrush engine) or tip (`.gbr`, `.gih`, `.png`) into their own library.

**Vector.** Introduce a vector brush as data, parallel to the raster `Brush`, with four kinds, all exporting as real SVG paths:

- **Width profile:** today's stroke, generalised. Pressure and velocity thinning, taper, caps, tremor and wiggle, smoothing.
- **Calligraphy:** width set by the stroke's heading against a nib angle, fixed or driven by pen tilt.
- **Pattern (art):** a vector shape bent along the drawn path.
- **Scatter:** vector shapes stamped along the path with jitter.

Each kind has built-in presets and can be authored, saved and synced as a custom brush. Pattern and scatter brushes can be made from the current object selection.

## User Stories

### Raster library

1. As an artist, I want a large built-in library of textured brushes (sketching, inking, painting, chalk, bristle, foliage, effects), so that I can work in many media without building brushes myself.
2. As an artist, I want the library grouped into sets and searchable by name, so that I can find a brush among dozens.
3. As an artist, I want brushes that scatter their dabs around the stroke, so that I can paint foliage, sparkle, debris and spray.
4. As an artist, I want brushes whose colour drifts per dab (hue, saturation, lightness), so that a single stroke has natural variation.
5. As an artist, I want brushes whose tip changes from dab to dab (random, sequential, by direction, by pressure), so that grass, leaves and splatter don't look stamped.
6. As an artist, I want new paper and surface textures (canvas, rough paper, crosshatch, screentone, bark…) to use as grain, so that dry media read on different surfaces.
7. As an artist, I want to import a Krita brush preset or a GIMP/Krita brush tip into my library, so that brushes I already own work in Velura.
8. As an artist, I want the brush editor to expose scatter, colour dynamics and tip sets, so that I can build these brushes myself.
9. As an artist, I want to see who made the bundled brushes, so that credit is given.

### Vector brushes

10. As an artist, I want to choose a vector brush from a library (fineliner, dip pen, brush pen, marker, technical pen, wiggly…), so that line-art has character while staying vector.
11. As an artist, I want a calligraphy nib whose line thickens and thins with the direction of the stroke, so that lettering looks hand-cut.
12. As an artist, I want the nib angle to follow my pen's tilt if I choose, so that I can letter naturally with a tilted stylus.
13. As an artist, I want pattern brushes that bend a shape along my stroke (ribbon, rope, vine, tapered brushstroke), so that I can draw decorative lines.
14. As an artist, I want scatter brushes that stamp vector shapes along my stroke (dots, stars, confetti, leaves), so that I can decorate quickly.
15. As an artist, I want to turn selected vector objects into a pattern or scatter brush, so that I can make my own.
16. As an artist, I want to create, edit, rename, duplicate and delete my own vector brushes with a live preview, so that the library fits how I draw.
17. As an artist, I want my vector brushes to sync to my account like my raster brushes, so that they follow me between machines.
18. As an artist, I want strokes drawn with any vector brush to stay editable paths: moving a node re-flows the brush, so that vector work stays revisable.
19. As an artist, I want to apply a different vector brush to a selected stroke, so that I can try another look without redrawing.
20. As an artist, I want every vector brush to export to SVG as real paths, so that my work opens elsewhere.

## Implementation Decisions

**Licence and provenance.**
- Source: `krita/data/bundles/Krita_4_Default_Resources.bundle` from `invent.kde.org/graphics/krita` (licence `CC-0` in `meta.xml`). Pin the commit hash in the asset manifest.
- `krita/data/README` describes the older loose `gbr/gih` files as CC-BY 3.0 (David Revoy, Ramon Miranda, Blender Foundation). Ship an attribution file and an in-app credits section regardless, which satisfies either reading.
- No Krita code is ported. The `.gbr`/`.gih`/`.kpp` readers are written from the file formats, not from Krita's implementation.
- MyPaint brushes (CC0) are a possible later source. They are out of scope here because their engine differs from ours.

**Asset pipeline (tooling, not runtime).** A `bun` script in `tooling/` reads the bundle and writes:
- Tips as single-channel PNGs. RGBA tips are reduced to coverage the way `texture-import.ts` already does. `.gih` frames become a tip set.
- Patterns as tileable grain PNGs.
- A JSON manifest with id, kind, frames, source file, licence and author.

Output goes under `public/brushes/krita/`. Ids are namespaced `krita:<name>`. The `TextureLibrary` resolves them lazily on first use, so built-ins don't add to the startup bundle. Procedural built-ins stay procedural, so existing golden images remain reproducible.

**Brush model additions (D23), all additive with defaults that reproduce today's output:**
- `scatter`: base amount in dab radii, count per spacing step, and which axes (across or along-and-across). The existing `scatter` dynamics target scales it.
- `color`: per-dab hue, saturation and lightness jitter bases. The existing `hue` target, plus new `saturation` and `lightness` targets, scale them. Per-dab colour means the stroke buffer carries colour per dab rather than coverage under one stroke colour. That changes the stamp pass, so it must keep D27 coverage/buildup semantics and the D30 budget.
- `shape.tip` becomes a tip reference that may name a tip set, plus a frame-selection mode: `random | sequential | direction | pressure`. A tip set uploads as a texture array.

**Krita preset translation.** A dev-time translator reads `.kpp` files: the PNG `tEXt`/`zTXt` chunk holds `<Preset paintopid="paintbrush">` XML. It emits a `Brush` draft with this mapping:

| Krita | Velura |
|---|---|
| diameter | radius |
| spacing | spacing |
| ratio | roundness |
| angle | angle |
| softness / auto-brush fade | feather |
| texture pattern, scale, strength | grain |
| size / opacity / flow / rotation / scatter / darken / hue sensors | modulators, with Krita's sensor curves converted to `Curve` |

Unmappable options (masked brushes, mirror, sharpness, smudge, etc.) are dropped and listed in the translator's report. Drafts are hand-tuned and committed as data next to `engine/brush/presets.ts`, grouped into sets taken from Krita's `.tag` files (Sketch, Ink, Paint, Digital, Textures, FX). Target: 40–60 curated presets, not the whole bundle. The same translator runs in the browser for the user-facing import.

**Vector brush model.**
- A `VectorBrush` is plain data `{ id, name, kind, ... }` with `kind ∈ { profile, calligraphy, pattern, scatter }`, stored and synced through a store seam mirroring `brush-store.ts` (Convex and local).
- Each stroke object keeps the brush *parameters* it was drawn with, not only an id, so editing or deleting a brush never changes existing artwork. It also keeps a deterministic seed for jitter.
- The object's spine stays an editable path (today's nodes and widths). Rendered geometry is derived from spine + brush + seed, like pressure widths are today, and re-derived on node edits.
- **Profile and calligraphy** both produce per-node widths, so they reuse the existing pressure-fit and tessellation. Calligraphy sets width from `|sin(heading − nibAngle)|` between a minimum and the brush width. Nib angle is fixed or comes from tilt direction, blended by a fixation amount.
- **Pattern brushes** store source paths plus a spine axis, and deform them along the fitted path (skeletal stroke) in `stretch` or `repeat` mode, with simple corner handling. Endcaps can be separate source pieces.
- **Scatter brushes** store source paths and place instances by arc length with spacing, size, rotation, offset jitter and an align-to-path flag. Pressure can drive size.
- **SVG export:** profile and calligraphy write their outline paths. Pattern and scatter write expanded paths in a `<g>`. The spine and brush parameters go in a `data-` attribute so a later import could round-trip them.
- The current Solid / Pressure toggle becomes two built-in profile presets.

**Editor (D32).** The raster brush editor gains Scatter and Colour sections and tip-set import. The vector brush editor is a new dialog with a section per kind and a live preview stroke rendered by the same tessellator.

## Testing Decisions

- Unit tests:
  - `.gbr`/`.gih`/`.kpp` readers against small committed fixtures.
  - Translator mapping table.
  - Scatter and colour evaluation determinism under a fixed seed.
  - Frame selection modes.
  - Calligraphy width function.
  - Pattern deformation (points stay within expected bounds, repeat count).
  - Scatter placement.
- Golden images (darwin + linux):
  - One stroke each for scatter, colour jitter and tip-set brushes, using generated test assets rather than Krita PNGs so goldens don't depend on the pipeline.
  - One stroke per vector kind.
- Browser specs:
  - Library search and sets.
  - Importing a `.kpp` and a `.gih`.
  - Making a pattern brush from selection and drawing with it.
  - Applying a brush to a selected stroke.
  - SVG export containing paths for each kind.
- Bench: scatter `count` multiplies dabs, so the vector workload bench gains a pattern/scatter stroke. Both must hold D30.

## Out of Scope

- Krita's other engines: colour smudge, hairy/bristle, spray, deform, particle, sketch, hatching, filter, duplicate. Smudge stays deferred per D29.
- Photoshop `.abr` import.
- MyPaint brush import.
- Textured vector strokes (raster texture inside a vector object). That would break pure-SVG export.
- Vector brush import from other apps.
