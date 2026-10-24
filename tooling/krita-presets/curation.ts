import type { Brush } from "../../engine/brush/brush"

/** The sets, in shelf order, as Krita's tags name them. */
export const SETS = [
  "Sketch",
  "Ink",
  "Paint",
  "Digital",
  "Textures",
  "FX",
] as const

export type CuratedPreset = {
  /** The `.kpp` in the bundle's `paintoppresets/`. */
  file: string
  /** Must be one of the preset's own Krita tags. */
  set: (typeof SETS)[number]
  /** A shelf name, when the preset's own reads poorly. */
  name?: string
  /** Hand tuning applied to the translated draft. */
  tune?: (brush: Brush) => Brush
}

/**
 * The paper a preset's own was standing in for, when Krita embedded that
 * paper in the preset rather than shipping it in the bundle.
 */
const substitutePaper =
  (textureId: string, scale: number, depth: number) => (brush: Brush) => ({
    ...brush,
    grain: { textureId, scale, depth, movement: 0 },
  })

/**
 * Krita inverts these papers, which Velura's grain cannot: at the preset's
 * full strength the uninverted paper bites away most of the mark.
 */
const softenInvertedPaper = (brush: Brush) => ({
  ...brush,
  grain: brush.grain && { ...brush.grain, depth: 0.45 },
})

/**
 * Krita's watercolours stay translucent where strokes pile up; a stroke-wide
 * opacity is how Velura keeps one pass from reaching full ink.
 */
const translucent = (brush: Brush) => ({
  ...brush,
  rendering: { ...brush.rendering, opacity: 0.6 },
})

export const CURATION: readonly CuratedPreset[] = [
  // Sketch
  { file: "c)_Pencil-1_Hard.kpp", set: "Sketch" },
  { file: "c)_Pencil-2.kpp", set: "Sketch" },
  {
    file: "c)_Pencil-3_Large_4B.kpp",
    set: "Sketch",
    tune: (brush) => ({
      ...brush,
      // At Krita's tenth scale the paper's tooth is finer than a pixel and
      // bites the whole mark away.
      grain: brush.grain && { ...brush.grain, scale: 0.45, depth: 0.7 },
      // A 4B lays down more graphite than its constant opacity leaves.
      rendering: { ...brush.rendering, flow: 0.2 },
    }),
  },
  { file: "c)_Pencil-4_Soft.kpp", set: "Sketch" },
  { file: "c)_Pencil-5_Tilted.kpp", set: "Sketch" },
  { file: "c)_Pencil-6_Quick_Shade.kpp", set: "Sketch" },
  {
    file: "h)_Charcoal_Pencil_Thin.kpp",
    set: "Sketch",
    tune: softenInvertedPaper,
  },
  {
    file: "h)_Charcoal_Pencil_Medium.kpp",
    set: "Sketch",
    tune: softenInvertedPaper,
  },
  {
    file: "h)_Charcoal_pencil_large.kpp",
    set: "Sketch",
    tune: softenInvertedPaper,
  },
  { file: "f)_Charcoal_Rock_Soft.kpp", set: "Sketch" },
  {
    file: "h)_Chalk_Details.kpp",
    set: "Sketch",
    tune: substitutePaper("krita:04-paper-c-grain", 0.8, 0.8),
  },
  { file: "h)_Chalk_Grainy.kpp", set: "Sketch" },
  { file: "h)_Chalk_Soft.kpp", set: "Sketch" },
  // Ink
  { file: "d)_Ink-1_Precision.kpp", set: "Ink" },
  { file: "d)_Ink-2_Fineliner.kpp", set: "Ink" },
  { file: "d)_Ink-3_Gpen.kpp", set: "Ink" },
  { file: "d)_Ink-4_Pen_Rough.kpp", set: "Ink" },
  { file: "d)_Ink-7_Brush_Rough.kpp", set: "Ink" },
  { file: "y)_Screentone_Pressure.kpp", set: "Ink" },
  { file: "y)_Screentones_Regular.kpp", set: "Ink" },
  // Paint
  { file: "f)_Bristles-1_Details.kpp", set: "Paint" },
  { file: "f)_Bristles-2_Flat_Rough.kpp", set: "Paint" },
  { file: "f)_Bristles-3_Large_Smooth.kpp", set: "Paint" },
  { file: "f)_Bristles-4_Glaze.kpp", set: "Paint" },
  { file: "f)_Bristles-5_Flat.kpp", set: "Paint" },
  { file: "g)_Dry_Bristles.kpp", set: "Paint" },
  { file: "g)_Dry_Bristles_Eroded.kpp", set: "Paint" },
  {
    file: "g)_Dry_Brushing.kpp",
    set: "Paint",
    tune: substitutePaper("krita:rough-paper", 0.8, 0.85),
  },
  { file: "j)_Watercolor_Texture.kpp", set: "Paint", tune: translucent },
  { file: "j)_Waterpaint_Hard_Edges.kpp", set: "Paint", tune: translucent },
  { file: "j)_Waterpaint_Soft_Edges.kpp", set: "Paint", tune: translucent },
  { file: "v)_Texture_Impressionism.kpp", set: "Paint" },
  // Digital
  { file: "b)_Basic-2_Opacity.kpp", set: "Digital" },
  { file: "b)_Basic-4_Flow_Opacity.kpp", set: "Digital" },
  { file: "b)_Basic-5_Size_Opacity.kpp", set: "Digital" },
  { file: "b)_Basic-6_Details.kpp", set: "Digital" },
  {
    file: "b)_Airbrush_Soft.kpp",
    set: "Digital",
    tune: (brush) => ({
      ...brush,
      // Krita's airbrush is 600 px across; this is the same soft cone at a
      // size picked up to shade with.
      shape: { ...brush.shape, radius: 60, feather: 60 },
    }),
  },
  { file: "e)_Marker_Chisel_Smooth.kpp", set: "Digital" },
  { file: "e)_Marker_Details.kpp", set: "Digital" },
  { file: "e)_Marker_Dry.kpp", set: "Digital" },
  { file: "t)_Shapes_Rounded.kpp", set: "Digital" },
  { file: "t)_Shapes_Spikes.kpp", set: "Digital" },
  // Textures
  { file: "y)_Texture_Crackles.kpp", set: "Textures" },
  { file: "y)_Texture_Hair.kpp", set: "Textures" },
  { file: "y)_Texture_Noise.kpp", set: "Textures" },
  { file: "y)_Texture_Random_Particles.kpp", set: "Textures" },
  { file: "y)_Texture_Reptile.kpp", set: "Textures" },
  { file: "y)_Texture_Spines.kpp", set: "Textures" },
  { file: "y)_Texture_Splat.kpp", set: "Textures" },
  { file: "y)_Texture_Spray.kpp", set: "Textures" },
  { file: "z)_Stamp_Grass.kpp", set: "Textures" },
  { file: "z)_Stamp_Herbals.kpp", set: "Textures" },
  { file: "z)_Stamp_Stylised_Tree.kpp", set: "Textures" },
  { file: "z)_Stamp_Vegetal.kpp", set: "Textures" },
  // FX
  { file: "z)_Stamp_Bokeh.kpp", set: "FX" },
]
