import {
  createPressureFit,
  MAX_TAPER,
  type Taper,
  nextNodeType,
  type NodeType,
  type BezierPath,
  type PathNode,
  type SegmentShape,
  type PressurePoint,
  type NodeEdit,
} from "./doc/vector-path"
import {
  dragNodes,
  editNode,
  lockAxis,
  moveNodes,
  breakNodes,
  deleteNodes,
  deleteSegments,
  insertNodes,
  joinNodes,
  joinableEnds,
  nodeCommand,
  segmentCommand,
  isHandle,
  pressNode,
  retractHandle,
  pruneNodes,
  boxNodes,
  allNodes,
  stepNode,
  transformNodes,
  type NodeTransform,
  type NodeClick,
  type NodeGrab,
  type VectorNode,
  DOUBLE_CLICK_MS,
} from "./doc/node-tool"
import {
  serializeSvg,
  type SvgExportOptions,
  type SvgExportResult,
} from "./store/export-svg"
import { svgPngImage } from "./store/svg-images"
import {
  objectEraser,
  selectionStyle,
  selectObjects,
  type ShapeStyle,
  objectsBounds,
  objectBounds as vectorObjectBounds,
  transformObjects,
} from "./doc/vector-objects"
import { eraserBrush, type EraserKind } from "./brush/eraser"
import {
  type Brush,
  type BrushGrain,
  brushSpacing,
  dabSpacing,
  cloneBrush,
  DEFAULT_BRUSH,
} from "./brush/brush"
import {
  dynamicsForDevice,
  evaluateDynamics,
  type Modulator,
  NEUTRAL_STAMP_PARAMS,
  type StampParams,
  validateDynamics,
} from "./brush/dynamics"
import {
  type Accumulation,
  BRUSH_COLOR,
  BRUSH_FEATHER,
} from "./brush/round-brush"
import { createStampContextTracker } from "./brush/stamp-context"
import {
  BUILTIN_TEXTURE_IDS,
  createTextureLibrary,
  type GrayscaleTexture,
} from "./brush/texture"
import {
  chooseOutputColorSpace,
  decodeTransfer,
  displayTransform,
  encodeTransfer,
  type OutputColorSpace,
  srgbToWorking,
} from "./color/display-transform"
import { hexToWorking, parseHex, workingToHex } from "./color/oklch"
import {
  activeLayer,
  addGroup,
  addLayer,
  addMask,
  addVectorLayer,
  createDocument,
  createBlankDocument,
  duplicateLayer,
  findLayer,
  findRasterLayer,
  type Layer,
  type LayerGroup,
  type LayerMask,
  type LayerNode,
  type LayerPatch,
  moveLayer,
  findNodeIn,
  groupContents,
  leafLayers,
  type LeafLayer,
  type VectorLayer,
  makeLayerPaintable,
  rasteriseLayer,
  type PaintDocument,
  planComposite,
  removeLayer,
  reserveIds,
  removeMask,
  selectLayer,
  selectMask,
  setLayer,
  setMaskEnabled,
  setPlacement,
} from "./doc/document"
import {
  createDocumentHistory,
  DEFAULT_HOT_BYTES,
  DEFAULT_WARM_BYTES,
  type DocumentHistory,
  type OperationPixels,
  type SurfaceTileIndex,
} from "./doc/history"
import { BACKGROUND, WORKSPACE_BACKGROUND } from "./doc/scene"
import {
  adoptStrandedSurfaces,
  captureStructure,
  parseSavedScenes,
  type DocumentStructure,
  type NodeStructure,
  restoreStructure,
  savedStructure,
  structureAssets,
  structureSurfaceIds,
} from "./doc/structure"
import {
  applySceneEdit,
  MAX_POLYGON_POINTS,
  type SceneChange,
  type SceneCommand,
  type VectorObject,
  type VectorScene,
  type VectorStyle,
} from "./doc/vector-scene"
import { tessellateObject, type Mesh } from "./geom/tessellate"
import { createLiveStrokeMesh } from "./geom/live-stroke"
import {
  centeredPlacement,
  flippedPlacement,
  type ImagePlacement,
  placementBounds,
  quadBounds,
  placementQuad,
  resolution,
  samePlacement,
  validPlacement,
} from "./doc/image-placement"
import { createCanvasImageCodec } from "./doc/image-codec"
import {
  assetId,
  type SourceImage,
  type ImageAsset,
  type ImageAssetRef,
  type ImageSourceCodec,
  type OpenImage,
} from "./doc/image-source"
import { createOpfsSpill, createTileStore } from "./doc/tile-store"
import {
  intersectRect,
  type PixelRect,
  type TileCoord,
  TILE_SIZE,
  tileBounds,
  tileIndexForPixel,
  tileKey,
  tilesCoveringRect,
  unionRect,
} from "./doc/tile-grid"
import { decodeFloat16 } from "./doc/float16"
import {
  defaultFilter,
  FILTER_LABELS,
  isIdentityFilter,
  normalizeFilter,
  type Filter,
  type FilterKind,
} from "./filters/filter"
import type { SurfaceTiles, TileRef } from "./store/document-store"
import { type BlobStore, createLocalBlobStore } from "./store/blob-store"
import { createDocumentStore, type DocumentStore } from "./store/document-store"
import {
  createDocumentPersistence,
  type DocumentPersistence,
} from "./store/local-persistence"
import {
  createCloudSync,
  hydrateFromRemote,
  loadVersionTiles,
  type CloudSync,
  type RemoteIndex,
  type RestorePoint,
  type SyncMetrics,
  type SyncStatus,
} from "./store/cloud-sync"
import {
  createFlushScheduler,
  type FlushScheduler,
} from "./store/flush-scheduler"
import { encodePreview } from "./store/preview"
import { decodeVeluraFile, encodeVeluraFile } from "./store/velura-file"
import {
  affineFromPlacement,
  affineQuad,
  beginTransform,
  type Affine,
  type TransformSession,
} from "./doc/transform-session"
import {
  layerStartPlacement,
  coveredBounds,
  liftsAnything,
  type TileTexels,
} from "./doc/layer-transform"
import {
  resolveSnap,
  alignedPlacement,
  placementExtent,
  snapTargets,
  type AlignAnchor,
  type Extent,
  type SnapTargets,
} from "./doc/snap"
import {
  addGuide,
  guideSnapTargets,
  moveGuide,
  removeGuide,
  type Guide,
  type GuideAxis,
} from "./doc/guides"
import { createStrokeResampler } from "./geom/path"
import { createStabilizer } from "./geom/stabilizer"
import {
  assistLine,
  createStrokeAssist,
  type StraightEdge,
} from "./geom/stroke-assist"
import {
  createRenderer,
  MAX_STAMPS_PER_DRAW,
  type Renderer,
  type ThumbnailSubject,
  type VectorDraw,
} from "./gpu/renderer"
import { createThumbnailScheduler, thumbnailOwners } from "./view/thumbnails"
import {
  createContentBounds,
  frameContent,
  tileBox,
} from "./view/content-bounds"
import { STAMP, STAMP_STRIDE } from "./gpu/stamp-instance"
import { attachPointerSampler } from "./input/pointer-sampler"
import {
  dragRect,
  combineSelections,
  ellipseSelection,
  invertSelection,
  featherSelection,
  transformSelection,
  lassoSelection,
  translateSelection,
  wandSelection,
  type WandPixels,
  type Point,
  rectSelection,
  sameSelection,
  type SelectionMode,
  selectAll,
  type SelectionMask,
} from "./doc/selection"
import {
  DEFAULT_PRESSURE_CURVE,
  validatePressureCurve,
} from "./input/pressure-curve"
import type { Curve } from "./brush/curve"
import { createSampleBuffer } from "./input/sample-buffer"
import { attachViewGestures } from "./input/view-gestures"
import { explainFailure, type ExplainedFailure } from "./errors"

import {
  type CanvasView,
  DEFAULT_VIEW,
  docToScreen,
  fitView as fitCanvasView,
  flipView,
  IDENTITY_MATRIX,
  panView,
  rotateView,
  applyMatrix as applyViewMatrix,
  invertMatrix as invertViewMatrix,
  screenToDoc,
  type ViewMatrix,
  zoomView,
} from "./view/view-transform"
import {
  DEFAULT_RASTER_MAGNIFICATION,
  RASTER_MAGNIFICATIONS,
  type RasterMagnification,
} from "./view/magnification"

/** What a node edit's key says when there is nothing for it to do. */
const CANNOT_INSERT = "Select both ends of a segment to insert a node in it."
const CANNOT_BREAK =
  "An open path's end node has nothing to break. Select a node inside the path."

export {
  docToScreen,
  invertMatrix,
  MAX_ZOOM,
  MIN_ZOOM,
  type ViewMatrix,
} from "./view/view-transform"
export {
  DEFAULT_RASTER_MAGNIFICATION,
  RASTER_MAGNIFICATIONS,
  type RasterMagnification,
} from "./view/magnification"
export { blendModes, type BlendMode } from "./shaders/blend-modes"
export {
  defaultFilter,
  FILTER_LABELS,
  MAX_BLUR_RADIUS,
  type Filter,
  type FilterKind,
} from "./filters/filter"

/**
 * What may be sent with a filter open without closing it (18): the filter's
 * own commands, and moving the view to look at the preview.
 */
const FILTER_PASSTHROUGH: ReadonlySet<EngineCommand["type"]> = new Set([
  "previewFilter",
  "applyFilter",
  "cancelFilter",
  "resize",
  "panView",
  "zoomView",
  "rotateView",
  "flipView",
  "fitView",
  "resetView",
])
export {
  encodeExportImage,
  type ImageExportOptions,
} from "./store/export-image"
export type {
  Brush,
  BrushGrain,
  BrushShape,
  BrushRendering,
} from "./brush/brush"
export {
  BUILTIN_BRUSHES,
  BUILTIN_BRUSH_PREFIX,
  builtinBrush,
  DEFAULT_LIBRARY_BRUSH_ID,
  isBuiltinBrush,
} from "./brush/presets"
export type { Curve, CurvePoint } from "./brush/curve"
export {
  canBreak,
  canJoin,
  handlesShown,
  selectedSegments,
  type NodeTransform,
  type VectorNode,
} from "./doc/node-tool"
export type { JoinMode, NodeType, SegmentShape } from "./doc/vector-path"
export { MAX_TAPER, type Taper } from "./doc/vector-path"
export {
  DEFAULT_PRESSURE_CURVE,
  DEFAULT_PRESSURE_PRESET,
  PRESSURE_PRESET_COUNT,
  pressureCurvePreset,
} from "./input/pressure-curve"
export type { GrayscaleTexture } from "./brush/texture"
export type {
  RemoteIndex,
  RestorePoint,
  SyncMetrics,
  SyncStatus,
  VersionSnapshot,
} from "./store/cloud-sync"

/** §9.2's flush trigger: how long a document sits idle before an unforced upload. */
const DEFAULT_CLOUD_IDLE_MS = 30_000
/**
 * How long a document must go unchanged before its layer thumbnails catch up.
 * Long enough that a run of quick strokes redraws once, after the last; short
 * enough that the artist, looking over at the list, finds it already true.
 */
const THUMBNAIL_QUIET_MS = 300
/** Product canvas ceiling; a device may impose a lower texture limit. */
const MAX_DOCUMENT_EDGE = 8192

export type { ImagePlacement, PlacementHandle } from "./doc/image-placement"
export {
  centeredPlacement,
  flippedPlacement,
  handlePoints,
  movedPlacement,
  nudgedPlacement,
  placementCorners,
  placementRect,
  resolution,
  rotatedPlacement,
  scaledPlacement,
} from "./doc/image-placement"
export type { ImageAsset, ImageAssetRef, PlacedImage } from "./doc/image-source"
export type { AlignAnchor, Extent, Snap, SnapTargets } from "./doc/snap"
export { placementExtent, resolveSnap } from "./doc/snap"
export type { Guide, GuideAxis } from "./doc/guides"
export type { StraightEdge } from "./geom/stroke-assist"
export type {
  FillRule,
  LineCap,
  LineJoin,
  SceneCommand,
  VectorFill,
  VectorGeometry,
  VectorObject,
  VectorScene,
  VectorStroke,
  VectorStyle,
} from "./doc/vector-scene"

export type PaintTool = "brush" | "eraser"

/** What the eraser takes on a vector layer: pixels, or objects whole. */
export type VectorEraserMode = "pixel" | "object"
/** Tools that draw out a selection (07) instead of making a mark. */
const SELECTION_TOOLS = [
  "rectSelect",
  "ellipseSelect",
  "lasso",
  "polygonLasso",
  "magicWand",
  "moveSelection",
] as const
export type SelectionTool = (typeof SELECTION_TOOLS)[number]

export type { SelectionMode }

/**
 * What the magic wand reads (10): the active layer's own pixels, or the
 * picture as it is composited.
 */
export type WandSample = "layer" | "composite"
export type WandOptions = Readonly<{
  /** Levels, 0–255, a pixel may differ from the clicked one per channel. */
  tolerance: number
  sample: WandSample
}>
export const DEFAULT_WAND: WandOptions = Object.freeze({
  tolerance: 32,
  sample: "layer",
})

export const isSelectionTool = (tool: Tool): tool is SelectionTool =>
  (SELECTION_TOOLS as readonly Tool[]).includes(tool)

/** Tools that draw shapes onto a vector layer (19) instead of paint. */
const VECTOR_TOOLS = [
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "objectSelect",
  "pen",
  "node",
  "pressure",
] as const
export type VectorTool = (typeof VECTOR_TOOLS)[number]
export const isVectorTool = (tool: Tool): tool is VectorTool =>
  (VECTOR_TOOLS as readonly Tool[]).includes(tool)

export type Tool = PaintTool | SelectionTool | VectorTool

export type { ShapeStyle }

/** The tools whose marks are lines: outlined whatever the style, never filled. */
export const drawsOutlineOnly = (tool: Tool) =>
  tool === "line" || tool === "pressure"

/** What a new shape from this tool is given: the style, as the tool can take it. */
export function toolShapeStyle(tool: Tool, style: ShapeStyle): ShapeStyle {
  if (!drawsOutlineOnly(tool) || (style.stroke && !style.fill)) return style
  return Object.freeze({ ...style, fill: false, stroke: true })
}

const sameShapeStyle = (a: ShapeStyle, b: ShapeStyle) =>
  (Object.keys(a) as (keyof ShapeStyle)[]).every((key) => a[key] === b[key])

export const DEFAULT_SHAPE_STYLE: ShapeStyle = Object.freeze({
  fill: true,
  stroke: false,
  strokeWidth: 4,
  strokeCap: "butt",
  strokeJoin: "miter",
  fillColor: null,
  strokeColor: null,
})

/** Display-encoded colour sampled from the composited canvas. */
export type EngineColor = Readonly<{
  red: number
  green: number
  blue: number
  alpha: number
  colorSpace: OutputColorSpace
  /**
   * The same colour as sRGB hex. Carried here rather than derived by the
   * picker so that the hex an artist sees is the engine's own answer, in the
   * one place the working-space conversion lives — a colour eyedropped from a
   * P3 canvas has no other honest way back to a hex field.
   */
  hex: string
}>

/**
 * Two frames of the fastest plausible pen (240 Hz) plus slack. Overrunning
 * drops the oldest samples, which is the right loss: the stroke's head matters
 * more than a position two frames stale.
 */
const SAMPLE_CAPACITY = 512

/** Fresh strokes follow the hand directly until the artist asks for smoothing. */
export const DEFAULT_STABILIZATION = 0

/**
 * The finest a vector's curves are cut, in pieces per document pixel's
 * tolerance: the most zoom and a dense display ask of them.
 */
const MAX_VECTOR_DETAIL = 256

/** How near a guide, in CSS pixels, a stroke opens to be held to it (17). */
const GUIDE_STROKE_REACH = 8
/** How far, in CSS pixels on screen, a freehand stroke's fit may stray from the hand. */
const FIT_SCREEN_TOLERANCE = 2
/**
 * The vector brush's stroke while the pen is down: a thin line along the
 * samples, as Inkscape's pencil sketches, the stroke itself put down as the
 * pen lifts — so it appears once, as fitted, rather than shifting into place.
 */
const SKETCH_COLOR = "#2f7cf6"
/** How wide, in CSS pixels on screen, the sketch line is. */
const SKETCH_WIDTH = 1.5

export type EngineCommand =
  | { type: "initialize" }
  | { type: "resize"; width: number; height: number; devicePixelRatio: number }
  /** Stabilizer strength in [0, 1]; zero restores the raw unfiltered path. */
  | { type: "setStabilization"; strength: number }
  | { type: "setTool"; tool: Tool }
  /**
   * The artist's pen response curve, applied to every force reading before a
   * brush sees it. Null restores the default. See `engine/input/pressure-curve`
   * for why this is a property of the hand rather than of the brush.
   */
  | { type: "setPressureCurve"; curve: Curve | null }
  /**
   * Whether pen tilt reaches the dynamics graph at all. Switched off, every
   * sample reads as an upright pen, so a brush that shades with tilt draws at
   * its own size instead — which is what a device with a noisy or absent tilt
   * sensor needs, and what an artist who rests their hand at an angle wants.
   */
  | { type: "setTiltEnabled"; enabled: boolean }
  | { type: "setEraser"; kind?: EraserKind; radius?: number; opacity?: number }
  /**
   * The ink, as authored sRGB hex. Hex rather than the working space because
   * that is the one colour notation the artist can also type, and the picker
   * (`features/color`) already owns the perceptual space above it — the engine
   * only needs the one conversion into linear light.
   */
  | { type: "setColor"; hex: string }
  /**
   * The brush. Every field is optional and unnamed ones are left alone, so a
   * control that owns one property need not know the rest of the brush.
   */
  | {
      type: "setBrush"
      /**
       * Which brush this is, when the whole of one is being put in the hand
       * (D25). A slider that owns one parameter names neither, so an edit
       * leaves the brush's identity where it was.
       */
      id?: string
      name?: string
      accumulation?: Accumulation
      opacity?: number
      flow?: number
      radius?: number
      /** Softness of the dab edge, in pixels of falloff inside the rim. */
      feather?: number
      /** Stamp spacing as a fraction of the dab diameter. */
      spacing?: number
      /** Width of the tip against its length, in (0, 1]. */
      roundness?: number
      /** Rotation of the tip, as a turn clockwise. */
      angle?: number
      /**
       * Greyscale tip texture, by id (D24). Null restores the procedural disc,
       * which is what makes the round brush reachable again from a textured one.
       */
      tipTextureId?: string | null
      /** The paper, by texture id, with its scale and depth. Null is smooth. */
      grain?: BrushGrain | null
      /** Replaces the dynamics graph outright; see `evaluateDynamics`. */
      dynamics?: Modulator[]
    }
  /**
   * Makes a greyscale texture resolvable by id (24), so a brush that names
   * it can be painted with. This is the seam an imported or synced texture
   * arrives through: the pixels are an asset, and the brush stays data.
   */
  | { type: "registerTexture"; id: string; texture: GrayscaleTexture }
  /** Adds an empty layer above the active one and selects it. */
  | { type: "addLayer" }
  /**
   * Adds an empty vector layer above the active one and selects it (19): a
   * layer of shapes that stay editable and are drawn from their geometry
   * every time they change, composited like any other layer.
   */
  | { type: "addVectorLayer" }
  /**
   * Edits a vector layer's objects (19): the commands in order, as one undo
   * step. What the shape tools send when a drag ends, and the seam everything
   * that edits objects later goes through.
   */
  | { type: "selectVectorObjects"; ids: readonly string[] }
  | { type: "selectVectorRegion"; region: Point | Extent; additive?: boolean }
  | { type: "deleteVectorObjects" }
  | { type: "duplicateVectorObjects" }
  | { type: "reorderVectorObjects"; to: "front" | "back" }
  | { type: "beginVectorTransform" }
  | { type: "adjustVectorTransform"; matrix: Affine; snap?: boolean }
  | { type: "adjustVectorPlacement"; placement: ImagePlacement }
  | { type: "commitVectorTransform" }
  | { type: "cancelVectorTransform" }
  | {
      type: "alignVectorObjects"
      anchor: AlignAnchor
      to: "canvas" | "selection"
    }
  | { type: "finishPenPath" }
  /** Closes the polygon being clicked out, if it has three corners yet. */
  | { type: "closePolygon" }
  | { type: "editVectorNode"; objectId: string; edit: NodeEdit }
  /**
   * Deletes the selected nodes, refitting the curve around them to keep its
   * shape unless `refit` is false (Delete, Ctrl+Delete). A path left with
   * fewer than two nodes goes.
   */
  | { type: "deleteVectorNode"; refit?: boolean }
  /** Adds a node at the middle of every selected segment (Insert). */
  | { type: "insertVectorNodes" }
  /**
   * Breaks every path at its selected nodes (Shift+B): a closed path opens,
   * an open one parts into paths of its own.
   */
  | { type: "breakVectorNodes" }
  /**
   * Joins the two selected ends of open paths (Shift+J), merged into one
   * node or, with `segment`, linked by a straight segment (Alt+J).
   */
  | { type: "joinVectorNodes"; segment?: boolean }
  /** Deletes every selected segment, opening or parting its path (Alt+Delete). */
  | { type: "deleteVectorSegments" }
  /** Makes every selected segment straight, or bendable (Shift+L, Shift+U). */
  | { type: "setVectorSegmentShape"; shape: SegmentShape }
  /** Makes every selected node cusp, smooth, symmetric or auto-smooth. */
  | { type: "setVectorNodeType"; nodeType: NodeType }
  /** Selects the one node after or before the last selected (Tab). */
  | { type: "stepVectorNode"; direction: 1 | -1 }
  /**
   * Moves the selected nodes by a document offset (arrow keys). A `repeat`
   * — the key held — joins the nudge before it as one undo step.
   */
  | { type: "nudgeVectorNodes"; dx: number; dy: number; repeat?: boolean }
  /**
   * Scales, turns or flips the selected nodes about their centre, or one
   * node's handles about it (`<` `>` `[` `]` `H` `V`). A `repeat` joins the
   * step before it as one undo step.
   */
  | {
      type: "transformVectorNodes"
      transform: NodeTransform
      repeat?: boolean
    }
  | { type: "editVectorLayer"; id: string; commands: readonly SceneCommand[] }
  /**
   * Turns a vector layer into a paint layer holding exactly what it showed
   * (20), as one undo step. The shapes stop being shapes: undo is the way
   * back to them.
   */
  | { type: "rasteriseLayer"; id: string }
  /** Whether the vector brush follows the pen's pressure or keeps full width. */
  | { type: "setVectorBrushPressure"; pressure: boolean }
  /** Whether the eraser on a vector layer takes pixels or whole objects. */
  | { type: "setVectorEraser"; mode: VectorEraserMode }
  /** How much of a solid vector brush stroke narrows to each tip; unnamed ends are kept. */
  | { type: "setVectorBrushTaper"; start?: number; end?: number }
  /** How the shape tools draw what comes next; unnamed fields are kept. */
  | {
      type: "setShapeStyle"
      fill?: boolean
      stroke?: boolean
      strokeWidth?: number
      strokeCap?: ShapeStyle["strokeCap"]
      strokeJoin?: ShapeStyle["strokeJoin"]
      fillColor?: string
      strokeColor?: string
    }
  /**
   * Brings an image in on a layer of its own, above the active one, and
   * selects it (D3): a photographed reference, a scan to trace, a plate to
   * paint over. A layer rather than a stamp into the current one, so the
   * artist can move it down the stack, dim it, mask it or throw it away
   * without touching the paint.
   *
   * The pixels arrive already at the size they are to be drawn at — resampling
   * belongs to whoever decoded the file, which is where the browser's own
   * scaler is — and are placed centred unless an origin says otherwise.
   */
  | {
      type: "placeImage"
      /**
       * The file as it was dropped. Kept with the layer, so every later
       * adjustment is rendered from it rather than from the last render of
       * it (06) — and so the document holds a photograph's own compressed
       * bytes rather than the rgba16float tiles it expands into.
       */
      file?: { bytes: Uint8Array; mime: string }
      /**
       * Pixels, for a picture that never was a file: the test harness, and a
       * host with an already-decoded image in hand. They become the layer's
       * original, encoded once here, so such an image transforms like any
       * other rather than being the one kind that cannot.
       */
      image?: SourceImage
      /** The layer's name; the file's, usually. */
      name?: string
      /** Top-left in document pixels. Centred when absent. */
      origin?: { x: number; y: number }
      /** Where the picture sits outright. Overrides `origin`. */
      placement?: ImagePlacement
    }
  | { type: "addGroup"; ids?: string[] }
  /** Copies a layer's pixels and settings above it, then selects the copy. */
  | { type: "duplicateLayer"; id: string }
  /** Removes a layer. The document always keeps at least one. */
  | { type: "removeLayer"; id: string }
  /**
   * Empties a paintable layer's pixels. The layer itself — its name, blend,
   * mask and place in the tree — stays, and the emptying is one undo step.
   */
  | { type: "clearLayer"; id: string }
  /** Starts a blank artwork at the current document size. */
  | { type: "clearDocument" }
  /**
   * Filters (18): hue/saturation, brightness/contrast and Gaussian blur on a
   * paintable layer's own pixels, in linear light. `beginFilter` keeps the
   * pixels as they are; each `previewFilter` redraws them from that, at its
   * settings and within the selection, feather and all; `applyFilter` makes
   * the last preview one undo step and `cancelFilter` puts every pixel back.
   * Anything else sent while a filter is open cancels it first, except
   * moving the view.
   */
  | { type: "beginFilter"; id: string; kind: FilterKind }
  | { type: "previewFilter"; filter: Filter }
  | { type: "applyFilter" }
  | { type: "cancelFilter" }
  /** Chooses where the pen paints, which is what the caches are built around. */
  | { type: "selectLayer"; id: string }
  /** Moves a layer to a position in the stack, counted from the bottom. */
  | { type: "moveLayer"; id: string; index: number; parentId?: string | null }
  | { type: "addMask"; id: string }
  | { type: "selectMask"; id: string }
  | { type: "setMaskEnabled"; id: string; enabled: boolean }
  | { type: "removeMask"; id: string }
  /**
   * Hands a placed image to the pen: after this the layer paints, erases and
   * refuses nothing, like a layer the artist drew themselves. Destructive by
   * nature — a mask is the undoable way to hide part of a picture — so it is
   * only ever sent because the artist asked for it.
   */
  | { type: "makeLayerPaintable"; id: string }
  /**
   * Picks a placed image up to be moved, scaled, turned or mirrored (06).
   *
   * What follows is a run of `adjustImageTransform` — each one rendered from
   * the original, so nothing softens however long the artist takes — ended by
   * `commitImageTransform`, which makes the whole run one undo step, or by
   * `cancelImageTransform`, which leaves the picture exactly as it was.
   *
   * Only offered for a layer that is still an image layer: a layer handed to
   * the pen (`makeLayerPaintable`) has no original to re-render from.
   *
   * The layer's mask stays where the artist painted it. It is theirs — hand
   * marks with no original behind them — so moving it with the picture would
   * mean resampling it, and resampling a mask that has already been
   * resampled is exactly the softening this whole design exists to avoid.
   * A mask hides a part of the canvas; the picture moves under it.
   */
  | { type: "beginImageTransform"; id: string }
  /** Where the picture sits as of this moment of the drag. */
  | { type: "adjustImageTransform"; placement: ImagePlacement }
  /** Ends the transform, as one step. */
  | { type: "commitImageTransform" }
  /** Ends the transform, putting the picture back where it was picked up. */
  | { type: "cancelImageTransform" }
  /**
   * Picks a painted layer up to be moved, scaled, turned or mirrored (13).
   *
   * The layer's pixels are snapshotted on the GPU as it is picked up — the
   * tight box round them — and every `adjustLayerTransform` after that is
   * drawn from the snapshot, never from the last preview, so a dozen
   * adjustments are as sharp as one. `commitLayerTransform` resamples once
   * and records one step; `cancelLayerTransform` puts the pixels back
   * texel for texel. A placed image has its own original to go back to and
   * is moved with `beginImageTransform` instead; a group has no pixels.
   * The mask stays put, for the reason a placed image's does.
   */
  | { type: "beginLayerTransform"; id: string }
  /** Where the layer's content sits as of this moment of the drag. */
  | { type: "adjustLayerTransform"; placement: ImagePlacement }
  | { type: "commitLayerTransform" }
  | { type: "cancelLayerTransform" }
  /**
   * Mirrors a layer's content in place, as one step: a picked-up placed
   * image or painted layer is flipped within its transform instead.
   */
  | { type: "flipLayer"; id: string; axis: "horizontal" | "vertical" }
  /**
   * Lines a layer's content up with the canvas or the selection (15), along
   * one axis, as one step — or, mid-transform, as one more adjustment of it.
   * Against the canvas with a selection, only a painted layer's selected
   * pixels move; a placed image, and anything aligned against the
   * selection, moves whole.
   */
  | {
      type: "alignLayer"
      id: string
      anchor: AlignAnchor
      to: "canvas" | "selection"
    }
  /** Whether transform drags snap to edges, centres and other content (15). */
  | { type: "setSnapping"; enabled: boolean }
  /**
   * Guides (16): lines in document pixels, `x` a vertical line and `y` a
   * horizontal one. Laying one down, moving it and taking it away are each
   * one step, saved with the document.
   */
  | { type: "addGuide"; axis: GuideAxis; position: number }
  | { type: "moveGuide"; id: string; position: number }
  | { type: "removeGuide"; id: string }
  | { type: "clearGuides" }
  /** Hides guides without deleting them; hidden guides are not snapped to. */
  | { type: "setGuidesVisible"; visible: boolean }
  /** Whether the rulers are shown along the canvas's edges (16). */
  | { type: "setRulersVisible"; visible: boolean }
  /**
   * How raster layers look magnified on screen (sharp-zoom 03): hard-edged
   * pixels past 200%, or filtered at every zoom. Never what export reads.
   */
  | { type: "setRasterMagnification"; mode: RasterMagnification }
  /**
   * Stroke assist (17): a straight-edge in document pixels, angle in radians,
   * that every stroke, brush or eraser, is held to; null takes it away.
   */
  | { type: "setStraightEdge"; edge: StraightEdge | null }
  /**
   * A layer's own settings. Every field is optional and unnamed ones are left
   * alone, so a control that owns one property need not know the rest.
   */
  | ({ type: "setLayer"; id: string } & LayerPatch)
  /**
   * Moves the canvas under the window, in CSS pixels — the units a pointer
   * event reports, so a host never has to know the backing store's density.
   */
  | { type: "panView"; dx: number; dy: number }
  /**
   * Multiplies the zoom. The anchor, in CSS pixels from the canvas's
   * top-left, is held still: that is what makes a wheel or a pinch feel attached to the
   * canvas rather than to the window. Without one the viewport's centre holds.
   */
  | { type: "zoomView"; factor: number; anchor?: { x: number; y: number } }
  /**
   * Turns the canvas. Relative by default, since a twist and a rotate key
   * both report a delta, and snapping to square unless told otherwise.
   */
  | { type: "rotateView"; radians: number; absolute?: boolean; snap?: boolean }
  /** Mirrors the view horizontally, and back: the fresh-eyes check. */
  | { type: "flipView" }
  /**
   * The whole piece in the window, at the angle it is being worked at.
   *
   * `occludedRight` is a strip of the viewport, in CSS pixels, that the artist
   * cannot see into because a panel covers it. Only the host knows what is on
   * screen, so only the host can say — the engine holds no opinion on panels.
   */
  | { type: "fitView"; occludedRight?: number }
  /** Back to square, centred in whatever the panels leave visible. */
  | { type: "resetView"; occludedRight?: number }
  /** Takes back the last stroke or layer operation. Nothing to undo is a no-op. */
  /**
   * Picks one layer or group out on the canvas while the artist points at it
   * in the list: everything else dims until null puts the stack back. How
   * the canvas is looked at, never what is in it — an export ignores it, and
   * a stroke clears it.
   */
  | { type: "highlightLayer"; id: string | null }
  /**
   * Replaces the selection (07) with a shape in document pixels: a rectangle
   * snapped to whole pixels, or the ellipse inscribed in one. What the
   * selection tools commit when a drag ends; one undo step. `mode` (09)
   * says how it meets the selection already there, replacing it by default.
   */
  | {
      type: "selectShape"
      shape: "rect" | "ellipse"
      x: number
      y: number
      width: number
      height: number
      mode?: SelectionMode
    }
  /**
   * The closed outline through `points`, in document pixels, as the lasso
   * tools commit it (09); combined with the selection as `mode` says.
   */
  | {
      type: "selectLasso"
      points: readonly Point[]
      mode?: SelectionMode
    }
  /**
   * The magic wand's click (10), in document pixels: the region of similar
   * colour joined to that point, read as the wand's options say, combined
   * with the selection as `mode` says. Asynchronous — the pixels are read
   * back off the GPU once, for this click (D30).
   */
  | { type: "selectWand"; x: number; y: number; mode?: SelectionMode }
  | { type: "setWandOptions"; tolerance?: number; sample?: WandSample }
  | { type: "selectAll" }
  | { type: "deselect" }
  /**
   * Drops a selection outline still being drawn — above all a polygon
   * between clicks — leaving the selection as it was. Nothing to drop, it
   * does nothing.
   */
  | { type: "abandonSelectionGesture" }
  /** Selects what was not selected; with nothing selected, everything. */
  | { type: "invertSelection" }
  /**
   * Softens the selection's edges over `radius` document pixels (11), so
   * painting fades out across the boundary rather than stopping at it.
   */
  | { type: "featherSelection"; radius: number }
  /** Moves the selection outline by whole pixels, the pixels left alone (11). */
  | { type: "moveSelection"; dx: number; dy: number }
  /**
   * Copies what the selection covers of the active layer into a new layer
   * above it, in place (11); soft coverage copies partly.
   */
  | { type: "copySelectionToLayer" }
  | { type: "undo" }
  | { type: "redo" }

export type EngineSnapshot = Readonly<{
  status:
    | "idle"
    | "initializing"
    | "ready"
    | "unavailable"
    | "failed"
    | "disposed"
  width: number
  height: number
  /** The colour space pixels are presented in: wide gamut where available. */
  outputColorSpace: OutputColorSpace
  /** Stabilizer strength in [0, 1]. Structural state, so React may see it. */
  stabilization: number
  /**
   * The pen response curve in force. Published so a settings control can be
   * driven by what the engine actually holds rather than its own copy.
   */
  pressureCurve: Curve
  /** Whether pen tilt reaches the dynamics graph. */
  tiltEnabled: boolean
  /** Whether transform drags snap (15); a host may suspend it per drag. */
  snapping: boolean
  /** The document's guides (16); part of the document, so undo restores them. */
  guides: readonly Guide[]
  /** Session view state (16): whether guides are drawn and snapped to. */
  guidesVisible: boolean
  rulersVisible: boolean
  rasterMagnification: RasterMagnification
  /** The straight-edge strokes are held to (17), if one is placed. */
  straightEdge: StraightEdge | null
  /** The persistent tool in the hand; Alt/Option sampling never changes it. */
  tool: Tool
  /** What the shape tools give a new shape (19). */
  shapeStyle: ShapeStyle
  /** Whether the vector brush's width follows pressure; off, it is solid. */
  vectorBrushPressure: boolean
  /** The solid vector brush's tapers, as shares of a stroke's length. */
  vectorBrushTaper: Taper
  /**
   * What the eraser takes on a vector layer: the pixels under its tip, as a
   * mark kept in the scene, or every object it touches, whole.
   */
  vectorEraser: VectorEraserMode
  /**
   * The selected objects' own style, which the shape options show and edit
   * in place of `shapeStyle` while there is one; null with none selected.
   */
  selectionStyle: ShapeStyle | null
  vectorSelection: readonly string[]
  vectorPaths: readonly VectorObject[]
  penNodes: readonly PathNode[]
  /** The nodes selected with the node tool, on the paths being edited. */
  vectorNodes: readonly VectorNode[]
  /** A node handle is held by the node tool, for the hint's modifiers. */
  vectorHandleHeld: boolean
  vectorSelectionBounds: Extent | null
  vectorTransform: {
    placement: ImagePlacement
    snapTargets: SnapTargets
  } | null
  /** Current display-encoded ink, updated by the eyedropper. */
  color: EngineColor
  /** The brush in the hand: serialisable data, never code (D23). */
  brush: Brush
  eraser: Brush
  /**
   * Every texture id a brush may name (D24): the built-ins, plus whatever has
   * been imported. The editor offers these, so a brush cannot be pointed at a
   * texture the engine would then refuse to resolve.
   */
  textures: readonly string[]
  /** The stack, bottom to top. Pixels are not in here; the panel reads this. */
  layers: readonly LayerSummary[]
  activeLayerId: string
  paintingMask: boolean
  /**
   * How the artist is looking at the canvas (D28). View state only: no
   * command here changes a texel, and an export ignores it entirely.
   */
  view: CanvasView
  /**
   * The transform in progress, if one is (06): which layer is being moved,
   * where it sits as of now, and how much of the picture's own detail is
   * left at that size — above 1 means the artist is being shown pixels the
   * picture never held, which the box says out loud rather than pretending.
   */
  imageTransform: ImageTransformState | null
  /**
   * The painted layer being transformed, if one is (13): its content box as
   * a placement, and the size of the snapshot it is drawn from.
   */
  layerTransform: LayerTransformState | null
  /** The filter open on a layer, at the settings last previewed (18). */
  filter: { layerId: string; filter: Filter } | null
  /**
   * The document's selection (07), or null when nothing is selected. It
   * belongs to the document, not a layer, so it stays as layers are switched.
   */
  selection: SelectionSummary | null
  wand: WandOptions
  /** Whether there is a step to take back, and one to put back (D21). */
  canUndo: boolean
  canRedo: boolean
  error: string | null
  /** A non-fatal durability/sync problem with an explicit next action. */
  problem: ExplainedFailure | null
  /**
   * Genuine upload state — null with no cloud configured, otherwise never an
   * optimistic guess (§9.2/18): "syncing" only while a flush is actually in
   * flight, "fully-synced" only once one has committed exactly what is on
   * screen now.
   */
  syncStatus: SyncStatus | null
  /**
   * True from the moment tiles start restoring until the ones nearest the
   * viewport are in, at which point the canvas is usable even though tiles
   * farther away may still be arriving in the background.
   */
  loading: boolean
}>

export type SelectionSummary = Readonly<{
  /** The smallest rectangle holding every selected pixel. */
  bounds: PixelRect
}>

export type ImageTransformState = Readonly<{
  layerId: string
  placement: ImagePlacement
  /** The original's own size, in its own pixels. */
  source: Readonly<{ width: number; height: number }>
  /** Drawn pixels per source pixel; 1 is the size the picture was recorded at. */
  resolution: number
  /** What a drag of it may snap to, found as it was picked up (15). */
  snapTargets: SnapTargets
}>

export type LayerTransformState = Readonly<{
  layerId: string
  /**
   * Only the selected pixels were picked up (14): the handles are on the
   * selection, and the outline goes with the pixels when put down.
   */
  lifted: boolean
  placement: ImagePlacement
  /** The snapshot's size: the layer's content box as it was picked up. */
  source: Readonly<{ width: number; height: number }>
  /** What a drag of it may snap to, found as it was picked up (15). */
  snapTargets: SnapTargets
}>

export type MaskSummary = Readonly<Omit<LayerMask, "surface">>
export type RasterLayerSummary = Readonly<
  Omit<Layer, "surface" | "mask"> & { mask?: MaskSummary }
>
/** A vector layer without its objects, but with how many it holds. */
export type VectorLayerSummary = Readonly<
  Omit<VectorLayer, "scene" | "mask"> & { mask?: MaskSummary; objects: number }
>
export type GroupSummary = Readonly<
  Omit<LayerGroup, "children" | "mask"> & {
    mask?: MaskSummary
    children: readonly LayerSummary[]
  }
>
/** The recursive tree as the UI sees it: settings, never pixels. */
export type LayerSummary =
  | RasterLayerSummary
  | VectorLayerSummary
  | GroupSummary

/**
 * What a host shows before an engine exists. Exported so the React host and
 * the engine cannot drift apart on the shape or the defaults.
 */
export const INITIAL_SNAPSHOT: EngineSnapshot = Object.freeze({
  status: "idle",
  width: 1,
  height: 1,
  outputColorSpace: "srgb",
  stabilization: DEFAULT_STABILIZATION,
  pressureCurve: DEFAULT_PRESSURE_CURVE,
  tiltEnabled: true,
  snapping: true,
  guides: Object.freeze([]),
  guidesVisible: true,
  rulersVisible: false,
  rasterMagnification: DEFAULT_RASTER_MAGNIFICATION,
  straightEdge: null,
  tool: "brush",
  shapeStyle: DEFAULT_SHAPE_STYLE,
  vectorBrushPressure: true,
  vectorBrushTaper: { start: 0, end: 0 },
  vectorEraser: "pixel",
  selectionStyle: null,
  vectorSelection: [],
  vectorPaths: [],
  penNodes: [],
  vectorNodes: [],
  vectorHandleHeld: false,
  vectorSelectionBounds: null,
  vectorTransform: null,
  color: Object.freeze({
    red: 36 / 255,
    green: 37 / 255,
    blue: 38 / 255,
    alpha: 1,
    colorSpace: "srgb",
    hex: "#242526",
  }),
  brush: Object.freeze(cloneBrush(DEFAULT_BRUSH)),
  eraser: Object.freeze(eraserBrush()),
  textures: BUILTIN_TEXTURE_IDS,
  // A host that has not started an engine has no document to describe.
  layers: Object.freeze([]),
  activeLayerId: "",
  paintingMask: false,
  view: DEFAULT_VIEW,
  imageTransform: null,
  layerTransform: null,
  filter: null,
  selection: null,
  wand: DEFAULT_WAND,
  canUndo: false,
  canRedo: false,
  error: null,
  problem: null,
  syncStatus: null,
  loading: false,
})

export type RenderedPixels = {
  width: number
  height: number
  /** Display-encoded RGBA8, tightly packed, top row first. */
  data: Uint8Array
  /** The colour space `data` is encoded in. */
  colorSpace: OutputColorSpace
}

/**
 * What one frame of the interactive loop cost (D30). Emitted only while an
 * observer is attached, and only for frames the stroke loop actually ran:
 * nothing here is computed, allocated or awaited during ordinary painting.
 */
export type FrameTiming = {
  /** The frame callback's timestamp, on the page's clock. */
  start: number
  /** Main-thread milliseconds spent draining, stamping and submitting. */
  cpuMs: number
  /** Dabs stamped in this frame. */
  stamps: number
  /**
   * Pen-to-pixel, in milliseconds: from the event timestamp of the oldest
   * sample the frame consumed to the GPU reporting the frame's work done.
   * Null on a frame that consumed no sample. This is a fence, not a readback —
   * no pixel crosses back to the CPU (D30).
   */
  latencyMs: number | null
}

export interface Engine {
  dispatch(command: EngineCommand): Promise<void>
  getSnapshot(): EngineSnapshot
  subscribe(listener: () => void): () => void
  /** Explicit asynchronous readback for tests and future export; never per frame. */
  readPixels(): Promise<RenderedPixels>
  /** Authored vectors and named layers, with optional raster PNGs and fidelity warnings. */
  exportSvg(options: SvgExportOptions): Promise<SvgExportResult>
  /** A real ZIP backup containing the complete layer tree and every exact tile. */
  exportDocument(): Promise<Uint8Array>
  /** Validates a backup in full before replacing the open document. */
  importDocument(bytes: Uint8Array): Promise<void>
  /**
   * The selection (07) as coverage, one byte per document pixel, read back
   * from the GPU; null while nothing is selected. Explicit and asynchronous,
   * like `readPixels`.
   */
  readSelection(): Promise<{
    width: number
    height: number
    data: Uint8Array
  } | null>
  /** Samples one composited canvas pixel and makes it the current ink. */
  sampleColor(x: number, y: number): Promise<EngineColor>
  /**
   * Watches the cost of every frame of drawing, for the benchmark (D30). Null
   * detaches. Attaching one adds a promise per frame, so it is off by default
   * and never on in the product.
   */
  /** Live path controls bypass React snapshots during gestures. */
  observeVectorControls(
    observer: (
      objects: readonly VectorObject[],
      penNodes: readonly PathNode[]
    ) => void
  ): () => void
  observeFrames(observer: ((frame: FrameTiming) => void) | null): void
  /**
   * What the session's history is holding: how many steps it can take back, the
   * logical bytes of the tiles behind them, and how much of that is in memory
   * rather than compressed away or spilled to disk (D21).
   */
  historyUsage(): {
    steps: number
    heldBytes: number
    residentBytes: number
    spilledBytes: number
  }
  /**
   * Writes the document to local storage now, and — where `cloud` is
   * configured — flushes it to R2 too, and waits for both. Strokes already
   * save themselves; this is for a host that wants the tab-hide or explicit
   * save to be a promise it can await. A no-op with no persistence configured,
   * and with a version preview on trial (see `keepRestore`). While tiles are
   * still loading it saves locally only and owes the flush, sent once they
   * are all in: a flush then would send a document missing them.
   */
  save(): Promise<void>
  /**
   * The restore points this document has, newest first (§9.4). Empty where
   * the document has no cloud copy to have kept any.
   */
  restorePoints(): Promise<readonly RestorePoint[]>
  /**
   * Puts the document back to how it looked at a restore point, as a single
   * undoable step (D9): the artist can look at an earlier state and take the
   * look back, which is what makes previewing one safe. Answers false where
   * there is nothing to restore from, or where this session is not allowed to
   * write over what it read.
   */
  restoreVersion(versionId: string): Promise<boolean>
  /**
   * Whether the last restore is still the step a single undo would take back.
   * False once the artist has painted over it — from then on the restored
   * state is part of their work, unpicked with undo like anything else.
   */
  canRevertRestore(): boolean
  /**
   * Keeps the restore in hand: until this is called it is only on trial,
   * saved neither to this device nor to the cloud, so a tab that closes
   * mid-preview reopens on the document as it was. Saves at once, and says
   * whether that save reached the cloud as well as this device.
   */
  keepRestore(): Promise<{ synced: boolean }>
  /**
   * Takes back the last restore, where it is still the top step. This is what
   * makes looking at an old state safe: the caller does not have to know how
   * many entries a restore costs, or whether history has moved since.
   */
  revertRestore(): Promise<boolean>
  /** Cumulative R2/Convex operation counts for this session, or null with no cloud sync. */
  cloudMetrics(): SyncMetrics | null
  /**
   * Shows a layer, group or mask in a small canvas of the host's, kept up to
   * date by the engine: redrawn from the GPU a moment after its pixels stop
   * changing, and never while a stroke is in flight. `onDrawn` hears whether
   * there was anything to show. Returns the detach.
   */
  attachThumbnail(
    id: string,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    onDrawn?: (drawn: { empty: boolean }) => void
  ): () => void
  dispose(): void
}

/** A grain setting is input like any other brush field, so it is checked once. */
function validateGrain(grain: BrushGrain): void {
  if (typeof grain.textureId !== "string" || grain.textureId === "")
    throw new Error("Grain must name a texture.")
  if (!Number.isFinite(grain.scale) || grain.scale <= 0)
    throw new Error("Grain scale must be positive.")
  if (!Number.isFinite(grain.depth) || grain.depth < 0 || grain.depth > 1)
    throw new Error("Grain depth must be a finite value in [0, 1].")
  if (
    !Number.isFinite(grain.movement) ||
    grain.movement < 0 ||
    grain.movement > 1
  )
    throw new Error("Grain movement must be a finite value in [0, 1].")
}

/**
 * How much of a session's history stays in memory and how much of it is kept
 * at all (D21). The defaults are the product's; tests set them small so a
 * synthetic session crosses the compression and spill boundaries in seconds
 * rather than in an afternoon of painting.
 */
export type HistoryBudget = {
  budgetBytes?: number
  hotBytes?: number
  warmBytes?: number
}

/**
 * Where a document is kept between sessions (§9.2). Anonymous work is a real
 * document with a real id: local storage is the durability guarantee, and the
 * cloud is a copy of it rather than the other way round.
 */
export type PersistenceOptions = {
  documentId: string
  /** Defaults to OPFS, or memory where the browser has none. */
  blobs?: BlobStore
  /** Told when a save fails, so a host can say that work is not being kept. */
  onError?: (error: unknown) => void
}

/**
 * Where a document's tiles go beyond this device (§9.2). Only meaningful
 * alongside `persistence` — cloud sync uploads what local storage already
 * wrote, it never becomes the source of truth on its own. Painting with no
 * `cloud` configured is unaffected: the local copy is still the document.
 */
export type CloudOptions = {
  remote: RemoteIndex
  /** Idle time after a commit before an unforced flush fires. Default 30s. */
  idleMs?: number
  onError?: (error: unknown) => void
  /** Each change of sync status, including those after the engine is disposed. */
  onSyncStatus?: (status: SyncStatus) => void
  /** Each library preview as soon as it is encoded (see `createCloudSync`). */
  onPreview?: (preview: {
    bytes: Uint8Array
    committed: Promise<number | undefined>
  }) => void
}

/** Canvas attachment is a lifecycle operation; commands contain only values. */
export function createEngine(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  options: {
    /** Fixed pixel extent of a newly-created document. Stored work overrides it. */
    documentSize?: { width: number; height: number }
    history?: HistoryBudget
    persistence?: PersistenceOptions
    cloud?: CloudOptions
    /**
     * The ink a finished stroke actually laid down. A colour is "used" when it
     * reaches the canvas, not when it is dialled in the picker, so this — and
     * not the picker's own commit — is what a recents list should listen to.
     */
    onStrokeCommitted?: (hex: string) => void
    /**
     * How a placed image is decoded and drawn at a placement (06). The
     * browser's own canvas by default; a test hands over its own so the
     * engine's half can be exercised without a decoder.
     */
    imageCodec?: ImageSourceCodec
    /**
     * Pixels for a texture id this engine has never been given — a shipped
     * texture fetched the first time a brush names it, rather than every one
     * of them at startup (brush library 01). Undefined for an id the host
     * does not know either, which a brush naming it is then refused for.
     */
    resolveTexture?: (id: string) => Promise<GrayscaleTexture | undefined>
  } = {}
): Engine {
  let snapshot: EngineSnapshot = INITIAL_SNAPSHOT
  const vectorControlObservers = new Set<
    (objects: readonly VectorObject[], penNodes: readonly PathNode[]) => void
  >()
  const listeners = new Set<() => void>()
  let device: GPUDevice | undefined
  let context: GPUCanvasContext | null = null
  let format: GPUTextureFormat = "bgra8unorm"
  let initialization: Promise<void> | undefined
  let viewport = { width: 1, height: 1, devicePixelRatio: 1 }
  let renderer: Renderer | undefined
  // The view (D28). Held here rather than in the host so that the pen, the
  // present pass and the snapshot cannot disagree about where the canvas is.
  let view: CanvasView = DEFAULT_VIEW
  // Screen pixels to document pixels, rebuilt whenever the view, document or
  // viewport changes. Cached because every pen sample is mapped through it.
  let toDoc: ViewMatrix = IDENTITY_MATRIX
  // The document: the layer stack and its pixels. Its fixed authored extent is
  // independent of the swap chain used to look at it.
  let doc: PaintDocument | undefined
  // Session-scoped, local undo (D9): tile hashes, tiered by bytes (D21).
  let history: DocumentHistory | undefined
  let persistence: DocumentPersistence | undefined
  let documents: DocumentStore | undefined
  let cloudSync: CloudSync | undefined
  /**
   * The history step the last restore made, by identity. Whether it is still
   * the step undo would reach is the whole of what "this preview is still
   * reversible" means — and asked by identity rather than by depth, because
   * a depth is fooled by old steps trimmed from the bottom of the stack.
   */
  let restoreStep: object | undefined
  /** Set while `revertRestore` takes the trial back through undo. */
  let revertingRestore = false
  /** True from the moment a restore starts writing until it is on trial. */
  let applyingRestore = false
  /**
   * A restore applied but not kept, and still the step one undo takes back.
   * Nothing saves while one is — not the commit hook, not an idle flush, not
   * a tab going hidden, not leaving the canvas — because what is on screen is
   * a look at the past, not the document. Painting over it ends the trial for
   * good (see the commit hook): from then on it is the artist's work and
   * saves like any other, however far undo later walks back.
   */
  /**
   * Undo and redo are closed while a preview is on trial: "Back to now" is
   * the way out of one, and an undo that slipped past it would leave the
   * next stroke landing where the preview stood, mistaken for it.
   */
  function publishHistory() {
    const trial = restoreRevertible()
    publish({
      canUndo: !trial && (history?.canUndo() ?? false),
      canRedo: !trial && (history?.canRedo() ?? false),
    })
  }
  function restoreOnTrial(): boolean {
    return applyingRestore || restoreRevertible()
  }
  function restoreRevertible(): boolean {
    return restoreStep !== undefined && history?.topStep() === restoreStep
  }
  /**
   * Stored tiles still arriving in the background, by surface and slot.
   * History's tile index only names the tiles loaded so far, so a local save
   * names these too (they are already on disk) rather than writing the
   * document without them. A cloud sync cannot — it would send a document
   * missing them — so it waits, and `unsyncedWhileLoading` says one is owed.
   */
  const pendingTiles = new Map<string, Map<string, TileRef>>()
  let unsyncedWhileLoading = false
  function withPendingTiles(
    surfaces: readonly SurfaceTileIndex[],
    structure: DocumentStructure
  ): SurfaceTileIndex[] {
    if (pendingTiles.size === 0) return [...surfaces]
    // A layer deleted before its tiles arrived is gone, not stranded.
    const present = structureSurfaceIds(structure)
    const merged = new Map(
      surfaces.map((surface) => [
        surface.surfaceId,
        new Map(surface.tiles.map((tile) => [tileKey(tile.x, tile.y), tile])),
      ])
    )
    for (const [surfaceId, pending] of pendingTiles) {
      if (!present.has(surfaceId)) continue
      const surface = merged.get(surfaceId) ?? new Map<string, TileRef>()
      // What history holds for a slot is newer than what disk held for it.
      for (const [slot, tile] of pending)
        if (!surface.has(slot)) surface.set(slot, tile)
      merged.set(surfaceId, surface)
    }
    return [...merged].map(([surfaceId, tiles]) => ({
      surfaceId,
      tiles: [...tiles.values()],
    }))
  }
  /**
   * The originals placed images were made from, by content hash (06). One
   * copy per distinct file however many layers show it, held here so a
   * transform never has to go back to disk mid-drag.
   */
  const assets = new Map<string, ImageAsset>()
  let codec: ImageSourceCodec | undefined
  /** The picture being moved, if one is; see `beginImageTransform`. */
  let imageTransform:
    | {
        layerId: string
        /** Where it was picked up: what a cancel puts back. */
        start: ImagePlacement
        placement: ImagePlacement
        asset: ImageAsset
        snapTargets: SnapTargets
        /** The original, decoded once for the whole drag (06). */
        open: OpenImage
        /**
         * The shared transform session (12): previews from the original,
         * one resample and one step on commit, nothing kept on cancel. The
         * placement is the artist's description; this is its matrix.
         */
        transform: TransformSession
      }
    | undefined
  /** The painted layer being moved, if one is; see `beginLayerTransform`. */
  let layerTransform:
    | {
        layerId: string
        /** The content box as picked up, which is the snapshot's region. */
        start: ImagePlacement
        placement: ImagePlacement
        source: PixelRect
        /** Only the selection's pixels were picked up (14). */
        lifted: boolean
        snapTargets: SnapTargets
        transform: TransformSession
      }
    | undefined
  let flushScheduler: FlushScheduler | undefined
  /**
   * Whether this session may write to local storage. False until the stored
   * document has been looked for — the empty canvas a session opens on must
   * not overwrite the work it is about to reopen — and false for good where
   * that document came back but could not be taken on whole.
   */
  let restored = !options.persistence
  /** Whether the reopened document found the cloud missing work or a preview. */
  let cloudBehind = false
  /** Whether this session has changed the document at all. */
  let committedSinceOpen = false
  /** Settles once every stored tile is back on the GPU, background ones too. */
  let fullyLoaded: Promise<void> = Promise.resolve()
  let disposed = false

  // The stroke path. Every buffer here is allocated once, at construction:
  // a frame of drawing performs no allocation at all (D30).
  const samples = createSampleBuffer(SAMPLE_CAPACITY)
  const stabilizer = createStabilizer()
  const assist = createStrokeAssist()
  let straightEdge: StraightEdge | null = null
  /**
   * Where the last stroke lifted, in document pixels: what Shift at pen-down
   * draws a straight line from (17). Session state, like the pen itself.
   */
  let lastStrokeEnd: { x: number; y: number } | null = null
  /** Whether the stroke in flight was asked to start from `lastStrokeEnd`. */
  let fromLastPoint = false
  // The pen response curve is engine state rather than a sampler argument: it
  // outlives any one attachment, and the sampler reads it back per sample.
  let pressureCurve: Curve = DEFAULT_PRESSURE_CURVE
  // On unless the artist says otherwise: a pen that reports tilt should use
  // it, and a pen that does not already reads as upright.
  let tiltEnabled = true
  let snapping = true
  let guidesVisible = true
  // Rebuilt only when the brush changes its spacing, which never happens
  // inside a stroke: a frame of drawing still allocates nothing (D30).
  let resampler = createStrokeResampler(brushSpacing(DEFAULT_BRUSH))
  const dynamics = createStampContextTracker()
  // Ids in a brush are resolved here, so the brush stays data and the pixels
  // stay an asset (D24). Imported textures register into this same library.
  const textures = createTextureLibrary()
  // Published rather than assumed: the snapshot's default is the built-in set,
  // and this is what keeps it true of the library this engine actually holds.
  snapshot = { ...snapshot, textures: Object.freeze(textures.ids()) }
  /**
   * The brush change still waiting on a texture to arrive, if any. Brush
   * changes queue behind it, so a brush picked while another's paper is
   * loading is not overwritten by that one landing late. With nothing
   * waiting, a brush applies in the same turn it is dispatched, as it always
   * has. Other commands do not queue: a stroke begun while a texture is still
   * on its way paints with the brush already in the hand, which is the brush
   * the artist can see they are holding.
   */
  let brushTurn: Promise<void> | undefined

  async function resolveBrushTextures(ids: (string | null | undefined)[]) {
    const missing = ids.filter((id): id is string => !!id && !textures.get(id))
    if (!missing.length || !options.resolveTexture) return
    const found = await Promise.all(missing.map(options.resolveTexture))
    if (disposed) return
    found.forEach((texture, i) => {
      if (texture && !textures.get(missing[i]))
        textures.register(missing[i], texture)
    })
    publish({ textures: Object.freeze(textures.ids()) })
  }
  const params: StampParams = { ...NEUTRAL_STAMP_PARAMS }
  // Evaluated once per stroke rather than per dab, so it is kept apart from
  // `params` instead of borrowing it and being overwritten by the first dab.
  const strokeParams: StampParams = { ...NEUTRAL_STAMP_PARAMS }
  const stamps = new Float32Array(MAX_STAMPS_PER_DRAW * STAMP_STRIDE)
  let stampCount = 0
  let stroking = false
  // The pen-down sample opens the path, and it arrives through the buffer like
  // every other sample: nothing is drawn from inside an event handler.
  let opening = false
  // The pen has lifted and the stroke's tail waits on the next frame to land.
  // A command that arrives first lands it, so it never overtakes the stroke.
  let landing = false
  // Where the pen actually was, before stabilization pulled the path behind it,
  // and what it reported there: the tail flushed on pen-up reuses all of it.
  let rawX = 0
  let rawY = 0
  let rawPressure = 1
  /** Whether the device drawing this stroke has a force sensor. */
  let strokeSensesPressure = true
  let rawTiltX = 0
  let rawTiltY = 0
  let rawTime = 0
  // Mirrors the snapshot so the per-dab path reads plain fields off one object
  // rather than a frozen snapshot that is replaced on every publish.
  let brush = cloneBrush(DEFAULT_BRUSH)
  let eraser = eraserBrush()
  const activeBrush = () => (tool === "eraser" ? eraser : brush)
  let tool: Tool = "brush"
  let ink = [...BRUSH_COLOR] as [number, number, number, number]
  // Jitter is seeded per stroke, so a `random` mapping differs between marks
  // while any one mark stays reproducible — which is what lets a stroke be
  // replayed from the log identically (D26).
  let strokeSeed = 0
  // What the renderer was last told the brush's textures are. Undefined means
  // a renderer that has been told nothing, which a fresh one has not.
  let appliedTextures: string | undefined
  let frame: number | undefined
  let detachSampler: (() => void) | undefined
  let detachGestures: (() => void) | undefined
  // Frame instrumentation. All of it is inert until an observer is attached.
  let frameObserver: ((frame: FrameTiming) => void) | null = null
  /** The page clock reading that this stroke's sample times are relative to. */
  let strokeOrigin = 0
  let frameStamps = 0
  /** Event time of the oldest sample this frame drained, on the page's clock. */
  let frameOldestSample: number | null = null
  stabilizer.setStrength(DEFAULT_STABILIZATION)

  type ThumbnailView = {
    canvas: HTMLCanvasElement | OffscreenCanvas
    onDrawn?: (drawn: { empty: boolean }) => void
    context?: GPUCanvasContext
    /** The device the context was configured for; a new one reconfigures. */
    configuredFor?: GPUDevice
  }
  /** Every canvas showing each id: a row's thumbnail, and its larger preview. */
  const thumbnailViews = new Map<string, Set<ThumbnailView>>()
  const contentBounds = createContentBounds()
  /** The layer or group the list is pointing at, if any. */
  let highlight: string | undefined
  const thumbnails = createThumbnailScheduler({
    quietMs: THUMBNAIL_QUIET_MS,
    busy: () => stroking || opening,
    draw: drawThumbnails,
  })

  /** Marks the thumbnails a change to one surface's pixels reaches. */
  function invalidateThumbnailsOf(surfaceId: string) {
    if (thumbnailViews.size === 0) return
    thumbnails.invalidate(
      doc ? thumbnailOwners(doc.layers, surfaceId) : [surfaceId]
    )
  }

  /** Per shown id, the tiles history said its layers held when last asked. */
  const holdings = new Map<string, string>()

  /**
   * Marks the thumbnails whose layers' held tiles moved since last asked.
   * Only ids with a canvas are asked, and asking is a walk over an index in
   * memory, never a pixel.
   */
  function invalidateChangedHoldings() {
    const past = history
    if (!past || !doc) return
    const changed: string[] = []
    for (const id of thumbnailViews.keys()) {
      const node = findNodeIn(doc.layers, id)
      if (!node) continue
      const layers = (
        node.kind === "group" ? leafLayers(node.children) : [node]
      ).filter((layer) => layer.kind === "raster")
      const held = layers
        .flatMap((layer) =>
          past.occupiedTiles(layer.id).map((tile) => tileKey(tile.x, tile.y))
        )
        .sort()
        .join(";")
      if (holdings.get(id) !== held) changed.push(id)
      holdings.set(id, held)
    }
    if (changed.length) thumbnails.invalidate(changed)
  }

  /**
   * What a thumbnail id names in the document now, if anything, and the
   * region to show of it: where its work is, framed. A mask means something
   * everywhere it covers, so it is shown whole; so is anything no pixel has
   * been seen arriving on.
   */
  function resolveThumbnail(
    id: string
  ):
    | { subject: ThumbnailSubject; crop?: PixelRect; empty?: boolean }
    | undefined {
    const framed = (box: PixelRect | undefined) =>
      box ? frameContent(box, extent()) : undefined
    /**
     * What a set of layers holds. Raster layers' from history's index of
     * their tiles: nothing at all, or the region their marks cover, trimmed
     * to the tiles still holding something so that erasing shrinks it again.
     * Vector layers' from their objects, which their pixels are drawn from.
     */
    const holding = (layers: readonly LeafLayer[]) => {
      const ids = layers.map((layer) => layer.id)
      const past = history
      if (!past) return { crop: framed(contentBounds.union(ids)) }
      const raster = layers.filter((layer) => layer.kind === "raster")
      const shapes = layers.filter(
        (layer) => layer.kind === "vector" && layer.scene.objects.length > 0
      )
      const tiles = raster.flatMap((layer) => past.occupiedTiles(layer.id))
      if (tiles.length === 0 && shapes.length === 0) return { empty: true }
      const marked = contentBounds.union(raster.map((layer) => layer.id))
      const painted =
        tiles.length > 0
          ? ((marked && intersectRect(marked, tileBox(tiles))) ??
            tileBox(tiles))
          : null
      const drawn = contentBounds.union(shapes.map((layer) => layer.id)) ?? null
      return { crop: framed(unionOf([painted, drawn]) ?? undefined) }
    }
    const find = (
      nodes: readonly LayerNode[]
    ): ReturnType<typeof resolveThumbnail> => {
      for (const node of nodes) {
        if (node.mask?.id === id) return { subject: { kind: "mask", id } }
        if (node.id === id)
          return node.kind === "group"
            ? {
                subject: { kind: "group", item: groupContents(node) },
                ...holding(leafLayers(node.children)),
              }
            : { subject: { kind: "layer", id }, ...holding([node]) }
        if (node.kind === "group") {
          const found = find(node.children)
          if (found) return found
        }
      }
    }
    return doc ? find(doc.layers) : undefined
  }

  function drawThumbnails(ids: ReadonlySet<string>) {
    for (const id of ids)
      for (const view of thumbnailViews.get(id) ?? []) drawThumbnail(id, view)
  }

  function drawThumbnail(id: string, view: ThumbnailView) {
    if (!renderer || !device || snapshot.status !== "ready") return
    const resolved = resolveThumbnail(id)
    if (!resolved) return
    if (view.configuredFor !== device) {
      view.context ??= view.canvas.getContext("webgpu") ?? undefined
      if (!view.context) return
      view.context.configure({
        device,
        format,
        alphaMode: "premultiplied",
        colorSpace: snapshot.outputColorSpace,
      })
      view.configuredFor = device
    }
    const empty = !renderer.drawThumbnail(
      view.context!.getCurrentTexture().createView(),
      { width: view.canvas.width, height: view.canvas.height },
      resolved.subject,
      resolved.crop
    )
    view.onDrawn?.({ empty: empty || !!resolved.empty })
  }

  function publish(update: Partial<EngineSnapshot>) {
    const next = { ...snapshot, ...update }
    if (
      doc &&
      (update.vectorSelection ||
        update.layers ||
        update.tool ||
        update.vectorPaths)
    ) {
      const layer = activeLayer(doc)
      next.vectorPaths =
        update.vectorPaths ??
        (layer.kind === "vector"
          ? layer.scene.objects.filter(
              (o) =>
                next.vectorSelection.includes(o.id) &&
                o.geometry.kind === "path"
            )
          : [])
      // Nodes handed in with the update are the caller's word on which are
      // selected after an edit; any others are pruned against it.
      next.vectorNodes = pruneNodes(
        next.vectorPaths,
        next.vectorNodes,
        update.vectorNodes ? next.vectorPaths : snapshot.vectorPaths
      )
      next.vectorSelectionBounds =
        layer.kind === "vector"
          ? objectsBounds(layer.scene, next.vectorSelection)
          : null
    }
    if (
      doc &&
      (update.vectorSelection ||
        update.layers ||
        update.tool ||
        update.vectorPaths ||
        update.shapeStyle)
    ) {
      const layer = activeLayer(doc)
      const style =
        layer.kind === "vector"
          ? selectionStyle(layer.scene, next.vectorSelection, next.shapeStyle)
          : null
      // Kept by identity while it says the same, so a frame that changed
      // nothing about it does not re-render the options.
      next.selectionStyle =
        style &&
        snapshot.selectionStyle &&
        sameShapeStyle(style, snapshot.selectionStyle)
          ? snapshot.selectionStyle
          : style && Object.freeze(style)
    }
    if (
      Object.keys(next).every(
        (key) =>
          next[key as keyof EngineSnapshot] ===
          snapshot[key as keyof EngineSnapshot]
      )
    )
      return
    snapshot = Object.freeze(next)
    // A new structure can change what any thumbnail shows — a child hidden
    // changes its group's, a layer moved changes nothing but is cheap to
    // redraw — and pixels only reach the document once it is ready.
    if ((update.layers || update.status === "ready") && thumbnailViews.size)
      thumbnails.invalidate(thumbnailViews.keys())
    listeners.forEach((listener) => listener())
    notifyVectorControls()
  }

  /** Re-reads `cloudSync`'s genuine status into the snapshot (18). */
  function publishSyncStatus() {
    publish({ syncStatus: cloudSync?.status() ?? null })
  }

  function release() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    // The selection goes with the document it was drawn on; a new one is
    // started or restored after this, without one.
    stopSelection()
    stroking = false
    opening = false
    landing = false
    stampCount = 0
    samples.clear()
    renderer?.destroy()
    renderer = undefined
    drawnScenes.clear()
    shapeDrag = undefined
    history?.clear()
    history = undefined
    persistence = undefined
    flushScheduler?.dispose()
    flushScheduler = undefined
    cloudSync = undefined
    documents = undefined
    doc = undefined
    contentBounds.clear()
    context?.unconfigure()
    context = null
    device?.destroy()
    device = undefined
  }

  function fail(error: unknown) {
    if (disposed) return
    release()
    publish({
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      problem: explainFailure(error, "graphics"),
    })
  }

  /**
   * A lost device invalidates every GPU object, but not the document already
   * committed to the local tile cache. Let the current disk write finish,
   * discard only the dead runtime, and initialize through the normal restore
   * path. A failed replacement falls through to the ordinary retry screen.
   *
   * Through the same latch the retry screen's button uses: a recovery already
   * under way is what an artist pressing Try again should be made to wait for,
   * not something they race a second device acquisition against.
   */
  async function recoverDevice(acquired: GPUDevice): Promise<void> {
    if (disposed || device !== acquired) return
    publish({ status: "initializing", error: null })
    await persistence?.settle()
    if (disposed || device !== acquired) return
    release()
    await startInitialization()
  }

  /**
   * Runs `initialize`, or joins the run already in flight. One device
   * acquisition at a time: two would leave the loser's `device !== acquired`
   * guards to abandon a half-built engine on the screen.
   */
  function startInitialization(): Promise<void> {
    if (!initialization)
      initialization = initialize().finally(() => {
        initialization = undefined
      })
    return initialization
  }

  function validateDocumentSize(size: { width: number; height: number }) {
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width < 1 ||
      size.height < 1
    )
      throw new Error("Document dimensions must be positive whole pixels.")
    const limit = Math.min(
      MAX_DOCUMENT_EDGE,
      device?.limits.maxTextureDimension2D ?? MAX_DOCUMENT_EDGE
    )
    if (size.width > limit || size.height > limit)
      throw new Error(
        `This device supports documents up to ${limit} pixels on either edge; ` +
          `${size.width}x${size.height} cannot be allocated.`
      )
  }

  function setDocumentSize(size: { width: number; height: number }) {
    validateDocumentSize(size)
    doc = createDocument(size)
    contentBounds.clear()
    renderer?.resize(size.width, size.height)
    drawnScenes.clear()
    resetSelection()
    uploadLayers()
    syncComposition()
    publish({ width: size.width, height: size.height, ...describeLayers(doc) })
  }

  function resize() {
    const limit = device?.limits.maxTextureDimension2D ?? 8192
    const width = Math.max(1, viewport.width * viewport.devicePixelRatio)
    const height = Math.max(1, viewport.height * viewport.devicePixelRatio)
    // Scale both axes together when the backing store exceeds the device limit.
    const scale = Math.min(1, limit / width, limit / height)
    const pixelWidth = Math.max(1, Math.round(width * scale))
    const pixelHeight = Math.max(1, Math.round(height * scale))
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    if (!doc && renderer)
      setDocumentSize(
        options.documentSize ?? { width: pixelWidth, height: pixelHeight }
      )
    // The viewport the view is centred in just changed, so the matrix the
    // present pass and the pen share has to be rebuilt against the new size.
    applyView()
  }

  /** The fixed authored extent of the document, in document pixels. */
  function extent() {
    return { width: snapshot.width, height: snapshot.height }
  }

  function viewportExtent() {
    return { width: canvas.width, height: canvas.height }
  }

  /**
   * Tells the present pass where the document sits on screen, and keeps the
   * inverse the pen is mapped through in step with it. Nothing here touches a
   * texel: the view is a matrix, and that is the whole of it (D28).
   */
  function applyView() {
    const size = extent()
    const viewportSize = viewportExtent()
    const matrix = docToScreen(view, size, viewportSize)
    toDoc = screenToDoc(view, size, viewportSize)
    renderer?.setView(matrix, viewportSize)
    refreshVectorDetail()
  }

  /**
   * CSS pixels to swap-chain pixels, per axis. The host speaks the units the
   * DOM gave it; the view transform then maps these viewport pixels into the
   * fixed document extent.
   */
  function toBackingX(value: number): number {
    return value * (canvas.width / Math.max(1, viewport.width))
  }

  function toBackingY(value: number): number {
    return value * (canvas.height / Math.max(1, viewport.height))
  }

  /** A host's CSS-pixel occlusion in the backing pixels the view is kept in. */
  function backingOcclusion(occludedRight: number | undefined): number {
    if (occludedRight === undefined) return 0
    if (!Number.isFinite(occludedRight) || occludedRight < 0)
      throw new Error("Occlusion must be a non-negative, finite width.")
    return toBackingX(occludedRight)
  }

  /**
   * How far, in document pixels, a freehand fit may stray from the hand: a
   * fixed distance on screen, as Inkscape's pencil sizes it, so jitter is
   * smoothed the same at every zoom.
   */
  function fitTolerance(): number {
    return (
      FIT_SCREEN_TOLERANCE *
      viewport.devicePixelRatio *
      Math.hypot(toDoc[0], toDoc[1])
    )
  }

  /**
   * How near a guide, in document pixels, a stroke has to open to be caught
   * by it: a fixed reach on screen, whatever the zoom.
   */
  function guideReach(): number {
    return (
      GUIDE_STROKE_REACH *
      viewport.devicePixelRatio *
      Math.hypot(toDoc[0], toDoc[1])
    )
  }

  /**
   * The view, inverted, applied to one point. Written out rather than routed
   * through `applyMatrix` because this runs per pen sample, and a frame of
   * drawing allocates nothing (D30).
   */
  function toDocX(x: number, y: number): number {
    return toDoc[0] * x + toDoc[2] * y + toDoc[4]
  }

  function toDocY(x: number, y: number): number {
    return toDoc[1] * x + toDoc[3] * y + toDoc[5]
  }

  /** Publishes a new view, redraws through it, and leaves the pixels alone. */
  function setView(next: CanvasView) {
    view = next
    applyView()
    publish({ view })
    if (snapshot.status === "ready") render()
  }

  /**
   * The decoder and scaler placed images are rendered through. Made on first
   * use rather than at construction: an engine that never sees an image never
   * touches a canvas, and a test can hand over one with no browser behind it.
   */
  function imageCodec(): ImageSourceCodec {
    codec ??= options.imageCodec ?? createCanvasImageCodec()
    return codec
  }

  /**
   * The original a layer was made from. Held in memory for the session; a
   * reopened document reads it back off disk before the layer can be moved,
   * so this answering nothing means the picture is not here to re-render.
   */
  function assetFor(id: string): ImageAsset {
    const held = assets.get(id)
    if (!held)
      throw new Error("The picture this layer was made from is not loaded yet.")
    return held
  }

  /**
   * Draws a picture that is not already open at a placement, and lets it go
   * again: what placing an image is, as against the run of drawings a drag
   * makes from one that stays open.
   */
  async function drawPlacement(
    layerId: string,
    asset: ImageAsset,
    placement: ImagePlacement
  ): Promise<void> {
    const open = await imageCodec().open(asset)
    try {
      renderer?.openPlacedImage(layerId, open.source)
      showTransform(layerId, placementQuad(placement))
    } finally {
      open.close()
      renderer?.closePlacedImage(layerId)
    }
  }

  /**
   * Shows a transform in progress without recording it.
   *
   * One textured quad, drawn by the renderer from the original it is holding
   * (06). Mid-drag there is no step to take back yet — the step is the whole
   * drag — so the GPU is told and history's index is left describing the
   * picture as it was, which is exactly the "before" the commit records
   * against.
   */
  function showTransform(
    layerId: string,
    corners: readonly [Point, Point, Point, Point]
  ) {
    if (!renderer) return
    renderer.drawPlacedImage({
      surfaceId: layerId,
      imageId: layerId,
      // The quad, not the box: which way round the picture is drawn inside
      // its corners is what a flip changes.
      corners,
    })
    contentBounds.grow(layerId, quadBounds(corners))
    invalidateThumbnailsOf(layerId)
    if (snapshot.status === "ready") render()
  }

  /** What the host needs to draw the box and to say how much detail is left. */
  function describeTransform(): ImageTransformState | null {
    if (!imageTransform) return null
    const { layerId, placement, asset, snapTargets } = imageTransform
    return Object.freeze({
      layerId,
      placement,
      snapTargets,
      source: Object.freeze({ width: asset.width, height: asset.height }),
      resolution: resolution(placement, asset),
    })
  }

  /**
   * The tree as a save should write it.
   *
   * Mid-drag the document carries the placement the artist is looking at,
   * while the tiles on disk are still the ones the picture was picked up
   * with — the drag is deliberately not recorded until it is committed. A
   * save landing in that window must not write the new placement against the
   * old pixels, or reopening would show the picture where it used to be
   * while claiming it is somewhere else. So the in-flight layer is written
   * as it was picked up, and the commit saves the pair together.
   */
  function structureForSave(): DocumentStructure {
    const document = requireDocument()
    const surfaces = history?.tileIndex() ?? []
    const structure = savedStructure(
      captureStructure(document, { scenes: true }),
      surfaces
    )
    const session = imageTransform
    if (!session) return structure
    const settle = (nodes: readonly NodeStructure[]): NodeStructure[] =>
      nodes.map((node) =>
        node.id === session.layerId && node.placed
          ? { ...node, placed: { ...node.placed, placement: session.start } }
          : node.children
            ? { ...node, children: settle(node.children) }
            : node
      )
    return { ...structure, layers: settle(structure.layers) }
  }

  /**
   * The originals a save can actually write: the ones the tree names that
   * this session is holding.
   *
   * A device that has lost an original — a cache cleared under a document
   * whose blob was never fetched back — still has the picture, because the
   * pixels are the document's tiles. Naming a file the save cannot produce
   * would fail the save, and a lost original must not cost the artist the
   * stroke they just painted. The tree keeps naming it either way, so the
   * machine that does hold it is unaffected.
   */
  function writableAssets(structure: DocumentStructure): ImageAssetRef[] {
    return structureAssets(structure).filter((ref) => assets.has(ref.id))
  }

  /** A placed image's asset, without the bytes: what the tree carries. */
  function assetRef(asset: ImageAsset): ImageAssetRef {
    return Object.freeze({
      id: asset.id,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
    })
  }

  /** Pixels handed straight over, as a file they can be re-rendered from. */
  async function encodeGivenPixels(
    image: SourceImage | undefined
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    if (!image) throw new Error("Placing an image needs a picture to place.")
    if (
      !Number.isInteger(image.width) ||
      !Number.isInteger(image.height) ||
      image.width < 1 ||
      image.height < 1
    )
      throw new Error("An image needs a whole width and height.")
    if (image.pixels.length < image.width * image.height * 4)
      throw new Error("That image has fewer pixels than it claims.")
    return await imageCodec().encode(image)
  }

  /**
   * Takes an original into the session, by content: the same photo placed
   * twice, or placed and then duplicated, is one asset and one blob on disk.
   */
  async function rememberAsset(file: {
    bytes: Uint8Array
    mime: string
  }): Promise<ImageAsset> {
    if (file.bytes.length === 0) throw new Error("That image file is empty.")
    const id = assetId(file.bytes)
    const held = assets.get(id)
    if (held) return held
    const size = await imageCodec().measure(file.bytes, file.mime)
    if (
      !Number.isInteger(size.width) ||
      !Number.isInteger(size.height) ||
      size.width < 1 ||
      size.height < 1
    )
      throw new Error("That image could not be read.")
    const asset: ImageAsset = Object.freeze({
      id,
      mime: file.mime,
      bytes: file.bytes,
      width: size.width,
      height: size.height,
    })
    assets.set(id, asset)
    return asset
  }

  /** Where a `placeImage` asked for its picture to go. */
  function placementFor(
    command: { placement?: ImagePlacement; origin?: { x: number; y: number } },
    asset: ImageAsset,
    canvas: { width: number; height: number }
  ): ImagePlacement {
    if (command.placement) return command.placement
    const centred = centeredPlacement(asset, canvas)
    // An origin names a top-left, which is how placing an image was asked for
    // before a placement was a thing; the size it lands at is unchanged.
    if (!command.origin) return centred
    return {
      ...centred,
      x: command.origin.x + centred.width / 2,
      y: command.origin.y + centred.height / 2,
    }
  }

  /**
   * Ends a transform as one step: the tree with the new placement in it, and
   * the surface's pixels replaced outright — replaced, not added to, because
   * a picture that moved has to stop being where it was.
   *
   * Undoing this puts the previous placement back and the previous pixels
   * with it, which is what makes a transform feel like one act rather than
   * like however many adjustments the artist made getting there.
   */
  async function commitTransform(): Promise<void> {
    const session = imageTransform
    if (!session) return
    imageTransform = undefined
    const changed = !samePlacement(session.placement, session.start)
    if (!session.transform.commit({ changed })) {
      // Picked up and put down: not a step, and nothing to re-render.
      closeTransform(session)
      publish({ imageTransform: null })
      return
    }
    closeTransform(session)
    publish({ imageTransform: null })
    applyLayerChange()
  }

  /**
   * Ends a transform having changed nothing. The picture is rendered once
   * more at the placement it was picked up from rather than the preview being
   * "undone": there is no step to undo, and re-rendering from the original is
   * how every other placement this picture has ever had was produced.
   */
  async function cancelTransform(): Promise<void> {
    const session = imageTransform
    if (!session) return
    imageTransform = undefined
    session.transform.cancel()
    closeTransform(session)
    publish({ imageTransform: null })
    applyLayerChange()
  }

  /** Lets go of an original a transform was holding, on the GPU and off it. */
  function closeTransform(session: { layerId: string; open: OpenImage }) {
    session.open.close()
    renderer?.closePlacedImage(session.layerId)
  }

  /** The transform in force, or the failure of asking for one out of turn. */
  function requireTransform() {
    if (!imageTransform) throw new Error("No image is being transformed.")
    return imageTransform
  }

  function adjustImageTransformTo(placement: ImagePlacement) {
    const document = requireDocument()
    const session = requireTransform()
    const canvas = { width: document.width, height: document.height }
    if (!validPlacement(placement, canvas))
      throw new Error("That is not a placement an image can be put at.")
    if (samePlacement(placement, session.placement)) return
    const matrix = affineFromPlacement(placement, session.asset)
    session.placement = placement
    setPlacement(document, session.layerId, placement)
    session.transform.update(matrix)
    publish({
      imageTransform: describeTransform(),
      ...describeLayers(document),
    })
  }

  /** Picks a placed image up; see `beginImageTransform`. */
  async function beginImageTransformOf(id: string): Promise<void> {
    commitVectorTransform()
    const document = requireDocument()
    const layer = findLayer(document, id)
    if (layer.kind !== "raster" || !layer.image || !layer.placed)
      throw new Error("Only a placed image can be moved, scaled or turned.")
    // A transform in flight on another layer is finished rather than
    // abandoned: the artist moved on, they did not undo.
    if (imageTransform && imageTransform.layerId !== id) await commitTransform()
    await commitLayerTransform()
    const asset = assetFor(layer.placed.asset.id)
    // Decoded and uploaded here, once. Every adjustment after this is a
    // textured quad: no decode, no canvas-sized conversion in
    // JavaScript, no tile upload — which is the difference between
    // dragging a six-megapixel photograph at three frames a second and
    // dragging it at the frame rate (06).
    const open = await imageCodec().open(asset)
    try {
      renderer?.openPlacedImage(id, open.source)
    } catch (error) {
      open.close()
      throw error
    }
    const layerId = id
    const start = layer.placed.placement
    const before = captureStructure(document)
    imageTransform = {
      layerId,
      start,
      placement: start,
      asset,
      snapTargets: snapTargetsBesides(layerId),
      open,
      transform: beginTransform(
        {
          source: asset,
          preview: (matrix) =>
            showTransform(layerId, affineQuad(matrix, asset)),
          commit: (_matrix, region) =>
            // The drag drew the picture with the renderer, so the
            // pixels this step has to remember are the ones on the
            // GPU. The region is everywhere the picture has been since
            // it was picked up, so the tiles it left behind are
            // recorded as the empty ones they now are.
            recordOperation("transform image", before, {
              readback: [{ surfaceId: layerId, region }],
              canvas: { width: document.width, height: document.height },
            }),
          cancel: (startMatrix, moved) => {
            // Rendered once more from the original rather than the
            // preview being "undone": there is no step to undo.
            setPlacement(requireDocument(), layerId, start)
            if (moved) showTransform(layerId, affineQuad(startMatrix, asset))
          },
        },
        affineFromPlacement(start, asset)
      ),
    }
    publish({ imageTransform: describeTransform() })
  }

  /**
   * The lines a drag may snap to (15): the canvas's, and every other visible
   * layer's content box — a placed image's by its placement, a painted
   * layer's by where it has been marked, within the canvas.
   */
  function snapTargetsBesides(id: string): SnapTargets {
    const document = requireDocument()
    const canvas = {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    }
    const others: Extent[] = []
    for (const layer of leafLayers(document.layers)) {
      if (layer.id === id || !layer.visible) continue
      const box =
        layer.kind === "raster" && layer.placed
          ? placementExtent(layer.placed.placement)
          : contentBounds.get(layer.id)
      const within = box && intersectRect(box, canvas)
      if (within) others.push(within)
    }
    const targets = snapTargets(document, others)
    return Object.freeze(
      guidesVisible ? guideSnapTargets(targets, document.guides) : targets
    )
  }

  /** Lines a layer up with the canvas or the selection; see `alignLayer`. */
  async function alignLayer(
    id: string,
    anchor: AlignAnchor,
    to: "canvas" | "selection"
  ): Promise<void> {
    const document = requireDocument()
    const within =
      to === "canvas"
        ? { x: 0, y: 0, width: document.width, height: document.height }
        : selection?.bounds
    if (!within) throw new Error("There is no selection to align to.")
    if (imageTransform?.layerId === id) {
      adjustImageTransformTo(
        alignedPlacement(imageTransform.placement, anchor, within)
      )
      return
    }
    if (layerTransform?.layerId === id) {
      adjustLayerTransformTo(
        alignedPlacement(layerTransform.placement, anchor, within)
      )
      return
    }
    const layer = findLayer(document, id)
    if (layer.kind === "raster" && layer.image && layer.placed) {
      await beginImageTransformOf(id)
      const session = requireTransform()
      adjustImageTransformTo(
        alignedPlacement(session.placement, anchor, within)
      )
      await commitTransform()
      return
    }
    // Aligned to the selection, the layer moves to it rather than the
    // selection's own pixels being lifted onto where they already are.
    await beginLayerTransformOf(id, { lift: to === "canvas" })
    const session = layerTransform as typeof layerTransform
    if (!session) return
    adjustLayerTransformTo(alignedPlacement(session.placement, anchor, within))
    await commitLayerTransform()
  }

  /** Layer transforms hold their snapshot under an id no asset can have. */
  const layerImageId = (layerId: string) => `layer-transform:${layerId}`

  /** A surface's tiles read back, each with its coordinate. */
  async function readTileTexels(
    id: string,
    coords: readonly TileCoord[]
  ): Promise<TileTexels[]> {
    if (!renderer) throw new Error("The canvas is not ready.")
    const texels = await renderer.readTiles(id, coords)
    return coords.map(({ x, y }, index) => ({ x, y, texels: texels[index]! }))
  }

  function describeLayerTransform(): LayerTransformState | null {
    if (!layerTransform) return null
    const { layerId, placement, source, lifted, snapTargets } = layerTransform
    return Object.freeze({
      layerId,
      placement,
      snapTargets,
      lifted,
      source: Object.freeze({ width: source.width, height: source.height }),
    })
  }

  /**
   * Picks a painted layer up (13): its pixels snapshotted on the GPU, the
   * tight box round them found from one readback, and a shared session (12)
   * that previews from the snapshot and resamples once on commit.
   */
  async function beginLayerTransformOf(
    id: string,
    options: { lift?: boolean } = {}
  ): Promise<void> {
    commitVectorTransform()
    const document = requireDocument()
    const layer = findLayer(document, id)
    if (layer.kind !== "raster")
      throw new Error("Only a layer with pixels of its own can be transformed.")
    if (layer.image)
      throw new Error("A placed image is moved with its own transform.")
    if (imageTransform) await commitTransform()
    if (layerTransform) {
      if (layerTransform.layerId === id) return
      await commitLayerTransform()
    }
    if (!renderer) throw new Error("The canvas is not ready.")
    const canvasRect = {
      x: 0,
      y: 0,
      width: document.width,
      height: document.height,
    }
    // With a selection, only what it covers is lifted (14), and the handles
    // sit on the selection rather than on the layer's content.
    const lifted =
      selection && options.lift !== false
        ? { mask: selection, key: selectionKey }
        : undefined
    let region: PixelRect | null
    if (lifted) {
      // Nothing painted under the selection is nothing to lift. Asked of the
      // pixels under the mask rather than of the content box, which only
      // grows and so says yes wherever a cancelled preview once reached.
      const tiles = await readTileTexels(id, lifted.mask.tiles())
      region = liftsAnything(tiles, lifted.mask) ? lifted.mask.bounds : null
    } else {
      const held = contentBounds.get(id)
      const area = held && intersectRect(held, canvasRect)
      const coords = area ? tilesCoveringRect(area) : []
      // Whole tiles overhang the canvas's edge; the surface does not.
      const covered = coveredBounds(await readTileTexels(id, coords))
      region = covered && intersectRect(covered, canvasRect)
    }
    if (!region) throw new Error("There is nothing on this layer to transform.")
    const imageId = layerImageId(id)
    if (lifted) {
      renderer.openSelectionImage(imageId, id, region)
      // The outline is put down with the pixels, so it is not shown behind.
      renderer.setSelection(null)
    } else renderer.openLayerImage(imageId, id, region)
    const start = layerStartPlacement(region)
    const before = captureStructure(document)
    const source = region
    const show = (matrix: Affine) =>
      showLayerImage(id, imageId, affineQuad(matrix, region))
    layerTransform = {
      layerId: id,
      lifted: !!lifted,
      snapTargets: snapTargetsBesides(id),
      start,
      placement: start,
      source: region,
      transform: beginTransform(
        {
          source: region,
          preview: show,
          // The pixels the step remembers are the ones the last preview
          // drew, over everywhere the content has been since it was lifted.
          commit: (matrix, touched) => {
            const pixels = {
              readback: [
                {
                  surfaceId: id,
                  region: intersectRect(touched, canvasRect) ?? touched,
                },
              ],
              canvas: { width: document.width, height: document.height },
            }
            if (!lifted) {
              recordOperation("transform layer", before, pixels)
              return
            }
            // The outline goes where the pixels went, in the same step.
            const mask = transformSelection(
              document,
              lifted.mask,
              source,
              matrix
            )
            const key = mask ? `selection-${++nextSelectionKey}` : null
            if (mask) selections.set(key!, mask)
            history?.recordOperation(
              "transform selection",
              {
                before: { ...before, selection: lifted.key },
                after: { ...captureStructure(document), selection: key },
              },
              pixels
            )
            selectionKey = key
            showSelection(mask, false)
          },
          cancel: (_start, moved) => {
            if (lifted) renderer?.setSelection(lifted.mask)
            if (!moved) return
            renderer?.restoreLayerImage(imageId, id)
            invalidateThumbnailsOf(id)
            if (snapshot.status === "ready") render()
          },
        },
        affineFromPlacement(start, region)
      ),
    }
    publish({ layerTransform: describeLayerTransform() })
  }

  function showLayerImage(
    layerId: string,
    imageId: string,
    corners: readonly [Point, Point, Point, Point]
  ) {
    if (!renderer) return
    renderer.drawPlacedImage({ surfaceId: layerId, imageId, corners })
    contentBounds.grow(layerId, quadBounds(corners))
    invalidateThumbnailsOf(layerId)
    if (snapshot.status === "ready") render()
  }

  function adjustLayerTransformTo(placement: ImagePlacement) {
    const session = layerTransform
    if (!session) throw new Error("No layer is being transformed.")
    const document = requireDocument()
    if (
      !validPlacement(placement, {
        width: document.width,
        height: document.height,
      })
    )
      throw new Error("That is not a placement a layer can be put at.")
    if (samePlacement(placement, session.placement)) return
    session.placement = placement
    session.transform.update(affineFromPlacement(placement, session.source))
    publish({ layerTransform: describeLayerTransform() })
  }

  async function commitLayerTransform(): Promise<void> {
    const session = layerTransform
    if (!session) return
    layerTransform = undefined
    const changed = !samePlacement(session.placement, session.start)
    const recorded = session.transform.commit({ changed })
    if (!recorded && session.lifted) {
      // Put down where it was picked up: a soft edge drawn back over its own
      // hole is not quite the layer it came from, so the layer is put back.
      renderer?.restoreLayerImage(
        layerImageId(session.layerId),
        session.layerId
      )
      renderer?.setSelection(selection)
    }
    renderer?.closePlacedImage(layerImageId(session.layerId))
    publish({ layerTransform: null })
    if (recorded) applyLayerChange()
  }

  async function cancelLayerTransform(): Promise<void> {
    const session = layerTransform
    if (!session) return
    layerTransform = undefined
    session.transform.cancel()
    renderer?.closePlacedImage(layerImageId(session.layerId))
    publish({ layerTransform: null })
    applyLayerChange()
  }

  /** The filter open on a layer (18), if one is. */
  let filterSession: { layerId: string; filter: Filter } | undefined

  /** Closes the open filter, putting back every pixel it previewed. */
  function cancelFilter() {
    if (!filterSession) return
    filterSession = undefined
    renderer?.endFilter(false)
    publish({ filter: null })
    if (snapshot.status === "ready") render()
  }

  /** Drops a layer transform whose layer is going away, recording nothing. */
  function abandonLayerTransform() {
    if (!layerTransform) return
    renderer?.closePlacedImage(layerImageId(layerTransform.layerId))
    if (layerTransform.lifted) renderer?.setSelection(selection)
    layerTransform = undefined
    publish({ layerTransform: null })
  }

  // Vector layers (19). What each layer's pixels were last drawn from, by
  // identity: a scene is an immutable value, so "has this layer changed since
  // it was drawn" is one comparison, and what changed is a diff of two lists
  // of objects that share everything an edit did not touch.
  const drawnScenes = new Map<string, VectorScene>()
  /**
   * Triangles per object and level of detail, each made once for as long as
   * the object exists.
   */
  const meshes = new WeakMap<
    VectorObject,
    Map<number, { fill: Mesh | null; stroke: Mesh | null }>
  >()
  /** The detail the screen's vector scenes were last cut at. */
  let screenDetail = 1
  /** A shape being dragged out (19), shown in its layer but not yet in it. */
  let shapeDrag:
    | {
        layerId: string
        tool: VectorTool
        points?: Point[]
        nodes?: PathNode[]
        placing?: boolean
        closed?: boolean
        /** When the polygon's last corner was clicked, to tell a double-click. */
        clickedAt?: number
        pressurePoints?: PressurePoint[]
        pressureTail?: {
          x: number
          y: number
          pressure: number
          tiltX: number
          tiltY: number
          time: number
        }
        pressureResampler?: ReturnType<typeof createStrokeResampler>
        /** The stroke fitted and meshed as it is drawn, and how many samples it has had. */
        pressureFit?: {
          fit: ReturnType<typeof createPressureFit>
          fed: number
          mesh: ReturnType<typeof createLiveStrokeMesh>
        }
        node?: NodeGrab
        /** Where the grabbed part sat as the press began, for the axis lock. */
        nodeAt?: Point
        /** Ctrl was down at the press. A click then turns an anchor to the
         * next type, or retracts a handle. */
        ctrlClick?: boolean
        /** The grabbed part has left its place: the pointer went past the
         * drag threshold, so a click alone never moves it. */
        nodeMoved?: boolean
        /** The node tool is drawing a rubber band, not moving a node. */
        nodeBox?: boolean
        anchor: Point
        point: Point
        ended: boolean
        /** The layer's scene with the shape in it, as last drawn. */
        preview?: VectorScene
        /** The point and Shift `preview` was made at; a still pen redraws nothing. */
        previewAt?: { x: number; y: number; square: boolean }
      }
    | undefined

  function notifyVectorControls() {
    if (!vectorControlObservers.size) return
    const objects =
      shapeDrag?.node && shapeDrag.preview
        ? shapeDrag.preview.objects.filter((o) =>
            snapshot.vectorSelection.includes(o.id)
          )
        : snapshot.vectorPaths
    const nodes =
      shapeDrag?.tool === "pen" ? shapeDrag.nodes! : snapshot.penNodes
    vectorControlObservers.forEach((observer) => observer(objects, nodes))
  }

  /** Frees a surface's texture, and forgets what was drawn into it. */
  function releaseSurface(id: string) {
    renderer?.releaseLayer(id)
    drawnScenes.delete(id)
  }

  function meshesOf(object: VectorObject, detail = 1) {
    let levels = meshes.get(object)
    if (!levels) meshes.set(object, (levels = new Map()))
    let found = levels.get(detail)
    if (!found) {
      found = tessellateObject(object, detail)
      levels.set(detail, found)
    }
    return found
  }

  /**
   * How many times finer than a document pixel the view needs its curves:
   * screen pixels per document pixel, rounded up to a power of two so a
   * zoom re-cuts them only when it crosses one, as a map's tiles do.
   */
  function viewDetail(): number {
    const magnified = 1 / Math.max(1e-9, Math.hypot(toDoc[0], toDoc[1]))
    if (!(magnified > 1)) return 1
    return Math.min(
      MAX_VECTOR_DETAIL,
      2 ** Math.ceil(Math.log2(magnified - 1e-6))
    )
  }

  /** Re-cuts the screen's vector scenes when the zoom has crossed a level. */
  function refreshVectorDetail() {
    const detail = viewDetail()
    if (detail === screenDetail) return
    screenDetail = detail
    for (const [layerId, scene] of drawnScenes)
      renderer?.setVectorScene(layerId, vectorDraws(scene, undefined, detail))
  }

  /** Whole pixels round an object, a pixel out for its antialiased edge. */
  function objectBounds(object: VectorObject): PixelRect | null {
    const { fill, stroke } = meshesOf(object)
    const boxes = [fill?.bounds, stroke?.bounds].filter((box) => !!box)
    if (boxes.length === 0) return null
    const minX = Math.floor(Math.min(...boxes.map((box) => box.minX))) - 1
    const minY = Math.floor(Math.min(...boxes.map((box) => box.minY))) - 1
    const maxX = Math.ceil(Math.max(...boxes.map((box) => box.maxX))) + 1
    const maxY = Math.ceil(Math.max(...boxes.map((box) => box.maxY))) + 1
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
  }

  function unionOf(boxes: readonly (PixelRect | null)[]): PixelRect | null {
    return boxes.reduce<PixelRect | null>(
      (sum, box) => (!box ? sum : sum ? unionRect(sum, box) : box),
      null
    )
  }

  /**
   * Where two scenes can differ in pixels: every object added, removed,
   * changed or moved in the stack, where it was and where it is.
   */
  function changedRegion(
    before: VectorScene | undefined,
    after: VectorScene
  ): PixelRect | null {
    if (!before) return unionOf(after.objects.map(objectBounds))
    const was = new Map(before.objects.map((object) => [object.id, object]))
    const now = new Map(after.objects.map((object) => [object.id, object]))
    const touched: VectorObject[] = []
    for (const object of after.objects) {
      const previous = was.get(object.id)
      if (previous === object) continue
      touched.push(object)
      if (previous) touched.push(previous)
    }
    for (const object of before.objects)
      if (!now.has(object.id)) touched.push(object)
    // An object moved up or down the stack changes what it overlaps.
    const kept = (scene: VectorScene) =>
      scene.objects
        .filter((object) => was.has(object.id) && now.has(object.id))
        .map((object) => object.id)
    const order = kept(after)
    kept(before).forEach((id, index) => {
      if (order[index] !== id) touched.push(was.get(id)!)
    })
    return unionOf(touched.map(objectBounds))
  }

  /** Paint as hex and opacity, premultiplied in the working space. */
  function workingPaint(paint: { color: string; opacity: number }) {
    const [red, green, blue] = hexToWorking(paint.color)
    const alpha = paint.opacity
    return [red * alpha, green * alpha, blue * alpha, alpha] as const
  }

  /**
   * What the renderer draws of a scene within a region, bottom first: all of
   * it without one.
   */
  function vectorDraws(
    scene: VectorScene,
    region?: PixelRect,
    detail = 1
  ): VectorDraw[] {
    const draws: VectorDraw[] = []
    const add = (
      mesh: Mesh | null,
      paint: { color: string; opacity: number },
      erase = false
    ) => {
      if (!mesh?.bounds) return
      const { minX, minY, maxX, maxY } = mesh.bounds
      if (
        region &&
        (maxX < region.x ||
          maxY < region.y ||
          minX > region.x + region.width ||
          minY > region.y + region.height)
      )
        return
      draws.push({
        vertices: mesh.vertices,
        rule: mesh.rule,
        color: workingPaint(paint),
        bounds: mesh.bounds,
        erase,
      })
    }
    for (const object of scene.objects) {
      const { fill, stroke } = meshesOf(object, detail)
      const erase = object.erase === true
      if (object.style.fill) add(fill, object.style.fill, erase)
      if (object.style.stroke) add(stroke, object.style.stroke, erase)
    }
    return draws
  }

  /**
   * Brings a vector layer's pixels up to `scene`, redrawing only where it
   * differs from what they were last drawn from.
   */
  function drawScene(layerId: string, scene: VectorScene) {
    if (!renderer) return
    const before = drawnScenes.get(layerId)
    if (before === scene) return
    const region = changedRegion(before, scene)
    drawnScenes.set(layerId, scene)
    if (region)
      renderer.rasterizeVector(layerId, vectorDraws(scene, region), region)
    // The screen draws the layer from its geometry, sharp at any zoom
    // (sharp-zoom 02); the pixels above stay what everything else reads.
    renderer.setVectorScene(
      layerId,
      vectorDraws(scene, undefined, screenDetail)
    )
    // A scene's content box is its objects', and shrinks when they go.
    contentBounds.forget(layerId)
    const box = unionOf(scene.objects.filter((o) => !o.erase).map(objectBounds))
    if (box) contentBounds.grow(layerId, box)
    invalidateThumbnailsOf(layerId)
  }

  /**
   * Edits a vector layer's objects as one undo step: the scene changes now,
   * and the step keeps the commands both ways rather than the scene.
   */
  function editScene(
    layerId: string,
    commands: readonly SceneCommand[],
    label: string,
    coalesceAs?: string
  ) {
    const document = requireDocument()
    const layer = findLayer(document, layerId)
    if (layer.kind !== "vector")
      throw new Error(`${layer.name} holds paint, not shapes.`)
    if (layer.locked) throw new Error(`${layer.name} is locked.`)
    if (commands.length === 0) return
    if (shapeDrag?.layerId === layerId) dropShapeDrag()
    if (vectorTransform?.layerId === layerId) cancelVectorTransform()
    const { scene, inverse } = applySceneEdit(layer.scene, commands)
    layer.scene = scene
    recordOperation(label, captureStructure(document), {
      scenes: [{ layerId, forward: [...commands], inverse }],
      coalesceAs,
    })
    applyLayerChange()
  }

  let vectorTransform:
    | {
        layerId: string
        scene: VectorScene
        ids: readonly string[]
        box: Extent
        session: TransformSession
      }
    | undefined

  function selectedVectorLayer() {
    const layer = activeLayer(requireDocument())
    if (layer.kind !== "vector") throw new Error("Select a vector layer first.")
    return layer
  }

  /**
   * What a band dragged from `anchor` to `point` selects: a click's point,
   * or the rectangle as it is on screen, which on a turned or flipped view
   * is a turned shape in the document, its corners in order round it.
   */
  function boxSelection(anchor: Point, point: Point): Point | Point[] {
    if (
      Math.hypot(point.x - anchor.x, point.y - anchor.y) <
      3 / snapshot.view.zoom
    )
      return point
    const toScreen = invertViewMatrix(toDoc)
    const a = applyViewMatrix(toScreen, anchor.x, anchor.y),
      b = applyViewMatrix(toScreen, point.x, point.y)
    return [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ].map((corner) => applyViewMatrix(toDoc, corner.x, corner.y))
  }

  /** The tool's default stays as it was; the selection's own style is
   * derived from the scene as it is published. */
  function setVectorSelection(ids: readonly string[]) {
    publish({ vectorSelection: ids })
  }

  function selectVectorRegion(
    region: Point | Extent | readonly Point[],
    additive = false
  ) {
    cancelVectorTransform()
    const ids = selectObjects(selectedVectorLayer().scene, region)
    setVectorSelection(
      additive ? [...new Set([...snapshot.vectorSelection, ...ids])] : ids
    )
  }

  /**
   * A pressure stroke's width lives on its nodes, so a new outline width
   * scales them, keeping the shape of its swell.
   */
  function widthScaled(
    o: VectorObject,
    width: number | undefined
  ): { geometry?: VectorObject["geometry"] } {
    const was = o.style.stroke?.width
    if (
      width === undefined ||
      !was ||
      width === was ||
      o.geometry.kind !== "path" ||
      !o.geometry.nodes.some((n) => n.width !== undefined)
    )
      return {}
    const scale = width / was
    return {
      geometry: {
        ...o.geometry,
        nodes: o.geometry.nodes.map((n) =>
          n.width === undefined ? n : { ...n, width: n.width * scale }
        ),
      },
    }
  }

  function applySelectedStyle(
    color?: string,
    change?: Extract<EngineCommand, { type: "setShapeStyle" }>
  ) {
    if (!snapshot.vectorSelection.length || !doc) return
    const layer = activeLayer(doc)
    if (layer.kind !== "vector" || layer.locked) return
    cancelVectorTransform()
    const style = snapshot.shapeStyle
    const paint = { color: color ?? snapshot.color.hex, opacity: 1 }
    const commands: SceneCommand[] = layer.scene.objects
      .filter((o) => snapshot.vectorSelection.includes(o.id))
      .map((o) => ({
        type: "update",
        id: o.id,
        patch: {
          ...widthScaled(o, change?.strokeWidth),
          style: color
            ? {
                fill: o.style.fill ? { ...o.style.fill, color } : null,
                stroke: o.style.stroke ? { ...o.style.stroke, color } : null,
              }
            : {
                fill:
                  change?.fill === false
                    ? null
                    : o.style.fill || change?.fill === true
                      ? {
                          ...(o.style.fill ?? {
                            ...paint,
                            rule: "nonzero" as const,
                          }),
                          color:
                            change?.fillColor ??
                            o.style.fill?.color ??
                            paint.color,
                        }
                      : null,
                stroke:
                  change?.stroke === false
                    ? null
                    : o.style.stroke || change?.stroke === true
                      ? {
                          ...(o.style.stroke ?? paint),
                          color:
                            change?.strokeColor ??
                            o.style.stroke?.color ??
                            paint.color,
                          width:
                            change?.strokeWidth ??
                            o.style.stroke?.width ??
                            style.strokeWidth,
                          cap:
                            change?.strokeCap ??
                            o.style.stroke?.cap ??
                            style.strokeCap,
                          join:
                            change?.strokeJoin ??
                            o.style.stroke?.join ??
                            style.strokeJoin,
                        }
                      : null,
              },
        },
      }))
    // What a new shape is given is left as it was: the selection's own
    // style is read back from the scene as it is published.
    // A colour dragged across the picker is one act, however many commands
    // it sends, so a run of changes to the same fields of the same objects is
    // one step, as a layer's sliders are.
    const fields = change
      ? Object.keys(change)
          .filter((key) => key !== "type")
          .sort()
          .join(",")
      : "color"
    editScene(
      layer.id,
      commands,
      "style objects",
      `style:${layer.id}:${[...snapshot.vectorSelection].sort().join(",")}:${fields}`
    )
  }

  async function beginVectorTransform() {
    await commitTransform()
    await commitLayerTransform()
    cancelVectorTransform()
    const layer = selectedVectorLayer()
    if (layer.locked) throw new Error(`${layer.name} is locked.`)
    const ids = [...snapshot.vectorSelection]
    const box = objectsBounds(layer.scene, ids)
    if (!box) return
    const scene = layer.scene
    const session = beginTransform(
      {
        source: {
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
        },
        preview(matrix) {
          drawScene(
            layer.id,
            applySceneEdit(scene, transformObjects(scene, ids, matrix)).scene
          )
          render()
        },
        commit(matrix) {
          editScene(
            layer.id,
            transformObjects(scene, ids, matrix),
            "transform objects"
          )
        },
        cancel() {
          drawScene(layer.id, scene)
          render()
        },
      },
      [1, 0, 0, 1, 0, 0]
    )
    vectorTransform = { layerId: layer.id, scene, ids, box, session }
    const base = snapTargetsBesides(layer.id)
    const local = snapTargets(
      requireDocument(),
      scene.objects
        .filter((o) => !o.erase && !ids.includes(o.id))
        .map(vectorObjectBounds)
        .filter((b) => b != null)
    )
    publish({
      vectorTransform: {
        placement: {
          x: box.x + box.width / 2,
          y: box.y + box.height / 2,
          width: Math.max(1, box.width),
          height: Math.max(1, box.height),
          rotation: 0,
          flipX: false,
          flipY: false,
        },
        snapTargets: { x: [...base.x, ...local.x], y: [...base.y, ...local.y] },
      },
    })
  }

  function adjustVectorTransform(matrix: Affine, snap: boolean) {
    const transform = vectorTransform
    if (!transform) throw new Error("No objects are being transformed.")
    let next = matrix
    if (snap) {
      const scene = applySceneEdit(
        transform.scene,
        transformObjects(transform.scene, transform.ids, matrix)
      ).scene
      const box = objectsBounds(scene, transform.ids)
      if (box) {
        const others = transform.scene.objects
          .filter((o) => !o.erase && !transform.ids.includes(o.id))
          .map((o) => vectorObjectBounds(o))
          .filter((b) => b != null)
        const base = snapTargetsBesides(transform.layerId)
        const local = snapTargets(requireDocument(), others)
        const resolved = resolveSnap(
          box,
          { x: [...base.x, ...local.x], y: [...base.y, ...local.y] },
          6 / snapshot.view.zoom
        )
        next = [
          matrix[0],
          matrix[1],
          matrix[2],
          matrix[3],
          matrix[4] + resolved.dx,
          matrix[5] + resolved.dy,
        ]
      }
    }
    transform.session.update(next)
  }

  function commitVectorTransform() {
    const transform = vectorTransform
    vectorTransform = undefined
    transform?.session.commit()
    if (transform) publish({ vectorTransform: null })
  }

  function cancelVectorTransform() {
    const transform = vectorTransform
    vectorTransform = undefined
    transform?.session.cancel()
    if (transform) publish({ vectorTransform: null })
  }

  /** Puts an undo or redo step's scene edits into the layers they name. */
  function applySceneChanges(
    document: PaintDocument,
    changes: readonly SceneChange[],
    direction: "undo" | "redo"
  ) {
    const ordered = direction === "undo" ? [...changes].reverse() : changes
    for (const change of ordered) {
      const node = findNodeIn(document.layers, change.layerId)
      if (node?.kind !== "vector") continue
      node.scene = applySceneEdit(
        node.scene,
        direction === "undo" ? change.inverse : change.forward
      ).scene
    }
  }

  /**
   * What taking a node out of the tree does to its vector layers' scenes:
   * nothing going forward — the layers are gone — and every object put back
   * going back, since the layers return empty with the tree.
   */
  function sceneRemovals(node: LayerNode): SceneChange[] {
    return leafLayers([node]).flatMap((layer) =>
      layer.kind === "vector" && layer.scene.objects.length > 0
        ? [
            {
              layerId: layer.id,
              forward: [],
              inverse: layer.scene.objects.map((object) => ({
                type: "add" as const,
                object,
              })),
            },
          ]
        : []
    )
  }

  /** The problem shown, unless it was a node edit's that has since applied. */
  function nodeProblemGone(): ExplainedFailure | null {
    const message = snapshot.problem?.message
    return message === CANNOT_INSERT || message === CANNOT_BREAK
      ? null
      : snapshot.problem
  }

  /** Ids for new objects, counting on from the highest `scene` has. */
  function objectIds(scene: VectorScene): () => string {
    let next = Number(nextObjectId(scene).slice("shape-".length))
    return () => `shape-${next++}`
  }

  /** An id no object in `scene` has. */
  function nextObjectId(scene: VectorScene): string {
    let highest = 0
    for (const object of scene.objects) {
      const sequence = /^shape-(\d+)$/.exec(object.id)
      if (sequence) highest = Math.max(highest, Number(sequence[1]))
    }
    return `shape-${highest + 1}`
  }

  /**
   * The vector brush's stroke as fitted so far, fed the samples it has not
   * seen. Its width and taper are the ones it began with.
   */
  function pressureStroke(drag: NonNullable<typeof shapeDrag>): BezierPath {
    drag.pressureFit ??= {
      fit: createPressureFit(
        snapshot.shapeStyle.strokeWidth,
        snapshot.vectorBrushPressure ? undefined : snapshot.vectorBrushTaper,
        fitTolerance()
      ),
      fed: 0,
      mesh: createLiveStrokeMesh(),
    }
    const live = drag.pressureFit
    live.fit.add(drag.pressurePoints!.slice(live.fed))
    live.fed = drag.pressurePoints!.length
    return live.fit.path(drag.ended)
  }

  /** Whether the drag is a vector brush stroke still being drawn. */
  function sketching(drag: NonNullable<typeof shapeDrag>): boolean {
    return drag.tool === "pressure" && !drag.ended
  }

  /**
   * The rectangle a drag outlines, in the shape style and the current
   * colour; nothing for a click, or with neither fill nor outline asked for.
   */
  function draggedShape(
    drag: NonNullable<typeof shapeDrag>,
    scene: VectorScene
  ): VectorObject | null {
    const style = snapshot.shapeStyle
    if (drag.tool === "node") return null
    if (
      !style.fill &&
      !style.stroke &&
      drag.tool !== "line" &&
      drag.tool !== "pressure"
    )
      return null
    const box = dragRect(drag.anchor, drag.point, constrained())
    if (drag.tool === "pen" && (drag.nodes?.length ?? 0) < 2) return null
    if (
      !["polygon", "pen", "pressure"].includes(drag.tool) &&
      box.width < 1 &&
      box.height < 1
    )
      return null
    if (drag.tool === "polygon" && (drag.points?.length ?? 0) < 2) return null
    const paint = { color: snapshot.color.hex, opacity: ink[3] }
    return {
      id: nextObjectId(scene),
      geometry:
        drag.tool === "pen"
          ? {
              kind: "path",
              nodes: [...drag.nodes!],
              closed: drag.closed ?? false,
            }
          : drag.tool === "pressure"
            ? pressureStroke(drag)
            : drag.tool === "ellipse"
              ? {
                  kind: "ellipse",
                  cx: box.x + box.width / 2,
                  cy: box.y + box.height / 2,
                  rx: box.width / 2,
                  ry: box.height / 2,
                }
              : drag.tool === "line"
                ? {
                    kind: "polygon",
                    points: [drag.anchor, drag.point],
                    closed: false,
                  }
                : drag.tool === "polygon"
                  ? {
                      kind: "polygon",
                      points: [...(drag.points ?? [drag.anchor]), drag.point],
                      closed: true,
                    }
                  : { kind: "rect", ...box },
      transform: [1, 0, 0, 1, 0, 0],
      style: sketching(drag)
        ? {
            fill: null,
            stroke: {
              color: SKETCH_COLOR,
              opacity: 1,
              width:
                SKETCH_WIDTH *
                viewport.devicePixelRatio *
                Math.hypot(toDoc[0], toDoc[1]),
              cap: "round",
              join: "round",
            },
          }
        : {
            fill:
              style.fill && !drawsOutlineOnly(drag.tool)
                ? {
                    ...paint,
                    color: style.fillColor ?? paint.color,
                    rule: "nonzero",
                  }
                : null,
            stroke:
              style.stroke ||
              drawsOutlineOnly(drag.tool) ||
              (drag.tool === "pen" && !drag.closed)
                ? {
                    ...paint,
                    color: style.strokeColor ?? paint.color,
                    width: style.strokeWidth,
                    cap: style.strokeCap,
                    join: style.strokeJoin,
                  }
                : null,
          },
    }
  }

  /** One frame of a shape drag: drawn into its layer, added as the pen lifts. */
  /**
   * The eraser on a vector layer (19). Taking objects, those its tip touches
   * drop out of the layer as it moves, and lifting it removes them as one
   * step. Taking pixels, its path is fitted as the vector brush's is and
   * kept in the scene as an eraser's mark, above what it erased.
   */
  let vectorErase:
    | {
        mode: "object"
        layerId: string
        scene: VectorScene
        eraser: ReturnType<typeof objectEraser>
        ended: boolean
      }
    | {
        mode: "pixel"
        layerId: string
        scene: VectorScene
        id: string
        points: PressurePoint[]
        fit: ReturnType<typeof createPressureFit>
        fed: number
        style: VectorStyle
        ended: boolean
      }
    | undefined

  /** The eraser's mark as drawn so far, or null before it has a point. */
  function eraseMark(
    erase: Extract<NonNullable<typeof vectorErase>, { mode: "pixel" }>
  ): VectorObject | null {
    if (!erase.points.length) return null
    erase.fit.add(erase.points.slice(erase.fed))
    erase.fed = erase.points.length
    let geometry = erase.fit.path(erase.ended)
    // A dab, not a drag: a path needs two nodes, so it gets a hair's length.
    if (geometry.nodes.length < 2) {
      const [node] = geometry.nodes
      geometry = {
        ...geometry,
        nodes: [node, { ...node, x: node.x + 0.01 }],
      }
    }
    return {
      id: erase.id,
      geometry,
      transform: [1, 0, 0, 1, 0, 0],
      style: erase.style,
      erase: true,
    }
  }

  function drawVectorErase() {
    const erase = vectorErase!
    let took = false
    samples.drain((x, y, pressure) => {
      const at = { x: toDocX(x, y), y: toDocY(x, y) }
      if (erase.mode === "object") {
        if (erase.eraser.moveTo(at)) took = true
        return
      }
      // Half a pixel apart is as fine as a mark needs to follow the hand.
      const last = erase.points.at(-1)
      if (last && Math.hypot(at.x - last.x, at.y - last.y) < 0.5) return
      if (erase.points.length >= MAX_POLYGON_POINTS) return
      erase.points.push({
        ...at,
        // The pressure eraser's tip, as on paint: a tenth of it at a touch.
        pressure:
          eraser.id === "eraser:pressure"
            ? 0.1 + 0.9 * Math.max(0, Math.min(1, pressure))
            : 1,
      })
      took = true
    })
    if (erase.mode === "pixel") {
      const mark = eraseMark(erase)
      if (erase.ended) {
        vectorErase = undefined
        forgetGestureInput()
        if (mark)
          editScene(
            erase.layerId,
            [{ type: "add", object: mark }],
            "erase pixels"
          )
        if (snapshot.status === "ready") render()
        return
      }
      if (took && mark) {
        drawScene(erase.layerId, {
          objects: [...erase.scene.objects, mark],
        })
        if (snapshot.status === "ready") render()
      }
      frame = requestAnimationFrame(drawFrame)
      return
    }
    const { hit } = erase.eraser
    if (erase.ended) {
      vectorErase = undefined
      forgetGestureInput()
      if (hit.size) {
        editScene(
          erase.layerId,
          [...hit].map((id) => ({ type: "remove" as const, id })),
          "erase objects"
        )
        publish({
          vectorSelection: snapshot.vectorSelection.filter(
            (id) => !hit.has(id)
          ),
        })
      }
      if (snapshot.status === "ready") render()
      return
    }
    if (took) {
      drawScene(erase.layerId, {
        objects: erase.scene.objects.filter((o) => !hit.has(o.id)),
      })
      if (snapshot.status === "ready") render()
    }
    frame = requestAnimationFrame(drawFrame)
  }

  /** Puts back what an abandoned vector erase took out of view. */
  function dropVectorErase() {
    const erase = vectorErase
    if (!erase) return
    vectorErase = undefined
    forgetGestureInput()
    drawScene(erase.layerId, erase.scene)
    if (snapshot.status === "ready") render()
  }

  function drawShapeDrag() {
    const drag = shapeDrag!
    const pressureSink = (x: number, y: number, pressure: number) => {
      if (drag.pressurePoints!.length < 100_000)
        drag.pressurePoints!.push({
          x,
          y,
          pressure: snapshot.vectorBrushPressure ? pressure : 1,
        })
    }
    samples.drain((x, y, pressure, tiltX, tiltY, time) => {
      let point = { x: toDocX(x, y), y: toDocY(x, y) }
      if (drag.node && drag.nodeAt) {
        // A press near a part, not on it, grabs it where it sits: the part
        // follows the pointer's travel, and only once it is a drag.
        const dx = point.x - drag.anchor.x,
          dy = point.y - drag.anchor.y
        if (
          !drag.nodeMoved &&
          Math.hypot(dx, dy) * snapshot.view.zoom < NODE_DRAG_THRESHOLD
        )
          return
        drag.nodeMoved = true
        point = { x: drag.nodeAt.x + dx, y: drag.nodeAt.y + dy }
      }
      // The grabbed node snaps; the rest follow its snapped offset. A
      // snap moves it along the locked axis only, never off it.
      // On a handle, Ctrl snaps the angle instead, in `dragNodes`.
      const lock =
        ctrlHeld && drag.node && !isHandle(drag.node.part)
          ? drag.nodeAt
          : undefined
      const locked = lock ? lockAxis(lock, point) : point
      // A band follows the hand: snapping its corner would pull it off
      // the cursor onto whatever it passes.
      drag.point =
        drag.tool === "pressure" || isBand(drag)
          ? point
          : snapVectorPoint(locked, drag.layerId)
      if (lock)
        drag.point =
          locked.y === lock.y
            ? { x: drag.point.x, y: lock.y }
            : { x: lock.x, y: drag.point.y }
      if (drag.tool === "pen" && drag.placing && !drag.ended) {
        const at = drag.nodes!.length - 1,
          node = drag.nodes![at]
        const dx = drag.point.x - node.x,
          dy = drag.point.y - node.y
        drag.nodes![at] = {
          ...node,
          in: { x: node.x - dx, y: node.y - dy },
          out: drag.point,
          type: Math.hypot(dx, dy) > 0 ? "smooth" : "cusp",
        }
      }
      if (drag.tool === "pressure") {
        drag.pressureTail = { ...point, pressure, tiltX, tiltY, time }
        const filtered = stabilizer.filter(point.x, point.y)
        drag.pressureResampler!.extend(
          filtered.x,
          filtered.y,
          pressure,
          tiltX,
          tiltY,
          time,
          pressureSink
        )
      }
    })
    if (drag.ended && drag.tool === "pressure") {
      const tail = drag.pressureTail!
      drag.pressureResampler!.extend(
        tail.x,
        tail.y,
        tail.pressure,
        tail.tiltX,
        tail.tiltY,
        tail.time,
        pressureSink
      )
      drag.pressureResampler!.end(pressureSink)
      // Arc-length stamps can stop short by one spacing; editable paths
      // retain the exact lift position and its pressure.
      const last = drag.pressurePoints!.at(-1)
      if (
        !last ||
        last.x !== tail.x ||
        last.y !== tail.y ||
        last.pressure !== tail.pressure
      )
        drag.pressurePoints!.push({
          x: tail.x,
          y: tail.y,
          pressure: snapshot.vectorBrushPressure ? tail.pressure : 1,
        })
    }
    const document = requireDocument()
    const layer = findNodeIn(document.layers, drag.layerId)
    if (
      layer?.kind !== "vector" ||
      layer.locked ||
      document.activeLayerId !== drag.layerId ||
      document.paintingMask
    ) {
      dropShapeDrag()
      return
    }
    const at = drag.previewAt
    const moved =
      !at ||
      at.x !== drag.point.x ||
      at.y !== drag.point.y ||
      at.square !== constrained()
    if (!drag.ended && !moved && !["pen", "pressure"].includes(drag.tool)) {
      frame = requestAnimationFrame(drawFrame)
      return
    }
    const shape = draggedShape(drag, layer.scene)
    // A stroke being drawn is meshed piece by piece, its finished curves
    // kept from frame to frame, rather than whole as any other object is.
    const live = drag.pressureFit
    if (live && shape?.style.stroke) {
      const pieces = live.fit.pieces()
      if (pieces.length) {
        const stroke = shape.style.stroke
        const levels = new Map<
          number,
          { fill: Mesh | null; stroke: Mesh | null }
        >()
        for (const detail of new Set([1, screenDetail]))
          levels.set(detail, {
            fill: null,
            stroke: live.mesh.mesh(pieces, stroke, detail, sketching(drag)),
          })
        meshes.set(shape, levels)
      }
    }
    if (drag.ended) {
      shapeDrag = undefined
      forgetGestureInput()
      publish({ penNodes: [] })
      if (isBand(drag)) {
        if (drag.nodeBox) endNodeBox(drag)
        else
          selectVectorRegion(boxSelection(drag.anchor, drag.point), shiftHeld)
        drawScene(layer.id, layer.scene)
        showSelection(selection)
        render()
        return
      }
      const moved = drag.node && nodeDragEdits(drag, layer.scene)
      if (drag.node) publish({ vectorHandleHeld: false })
      if (drag.ctrlClick && drag.node && !moved?.length) {
        const retracted = retractHandle(drag.node)
        if (retracted.length) editScene(layer.id, retracted, "retract handle")
      }
      // A click, not a drag, on one of several selected nodes selects it
      // alone; the press kept them all in case it became a drag. With Ctrl
      // it also turns the node to the next type (Inkscape); Ctrl dragged
      // is the axis lock instead.
      if (drag.node?.part === "anchor" && !moved?.length) {
        const clicked = {
          objectId: drag.node.object.id,
          index: drag.node.index,
        }
        const geometry = drag.node.object.geometry
        const cycled =
          drag.ctrlClick &&
          geometry.kind === "path" &&
          nodeCommand(
            layer.scene,
            [clicked],
            nextNodeType(geometry.nodes[clicked.index].type)
          )
        if (cycled) editScene(layer.id, cycled.edits, "edit node")
        publish({ vectorNodes: [clicked] })
      }
      if (moved?.length) {
        editScene(
          layer.id,
          moved,
          drag.node?.part === "segment" ? "bend segment" : "move nodes"
        )
      } else if (shape && !drag.node) {
        editScene(
          layer.id,
          [{ type: "add", object: shape }],
          `draw ${drag.tool}`
        )
        // A brush stroke is left unselected, as paint is: the width and
        // colour then set up the next stroke rather than edit this one.
        publish({ vectorSelection: drag.tool === "pen" ? [shape.id] : [] })
      } else {
        drawScene(layer.id, layer.scene)
        if (snapshot.status === "ready") render()
      }
      return
    }
    drag.previewAt = { ...drag.point, square: constrained() }
    drag.preview = isBand(drag)
      ? layer.scene
      : drag.node
        ? applySceneEdit(layer.scene, nodeDragEdits(drag, layer.scene)).scene
        : shape
          ? applySceneEdit(layer.scene, [{ type: "add", object: shape }]).scene
          : layer.scene
    drawScene(layer.id, drag.preview)
    notifyVectorControls()
    if (isBand(drag)) {
      const band = boxSelection(drag.anchor, drag.point)
      renderer?.setSelection(
        Array.isArray(band) ? lassoSelection(document, band) : null
      )
    }
    try {
      if (snapshot.status === "ready") render()
    } catch (error) {
      fail(error)
      return
    }
    if (drag.tool !== "pen" || drag.placing)
      frame = requestAnimationFrame(drawFrame)
  }

  /**
   * Closes a polygon still being clicked out and keeps it, if it has the three
   * corners a shape needs; with fewer it is left for the caller to drop.
   */
  function closePolygon() {
    const drag = shapeDrag
    if (
      drag?.tool !== "polygon" ||
      drag.ended ||
      (drag.points?.length ?? 0) < 3
    )
      return
    endPolygon(drag)
    drawShapeDrag()
  }

  /** Ends a polygon at its first corner, to be kept as the next frame draws. */
  function endPolygon(drag: NonNullable<typeof shapeDrag>) {
    drag.point = drag.anchor
    drag.ended = true
  }

  /** A drag that draws a selection band rather than a shape. */
  const isBand = (drag: NonNullable<typeof shapeDrag>) =>
    drag.tool === "objectSelect" || !!drag.nodeBox

  /** Drops a shape drag, its layer drawn as it was. */
  function dropShapeDrag() {
    const drag = shapeDrag
    if (!drag) return
    shapeDrag = undefined
    forgetGestureInput()
    publish({
      penNodes: [],
      vectorSelection: snapshot.vectorSelection,
      vectorHandleHeld: false,
    })
    if (isBand(drag)) showSelection(selection)
    const layer = doc && findNodeIn(doc.layers, drag.layerId)
    if (layer?.kind === "vector") drawScene(layer.id, layer.scene)
    if (snapshot.status === "ready") render()
  }

  /** Hands the renderer whatever pixels each layer's surface has gained. */
  function uploadLayers() {
    if (!renderer || !doc) return
    const target = renderer
    const document = doc
    const upload = (node: LayerNode) => {
      if (node.mask) target.uploadMask(node.mask.id, node.mask.surface)
      if (node.kind === "group") {
        node.children.forEach(upload)
        return
      }
      if (node.kind === "vector") {
        // A shape being dragged out is shown in its layer as it goes.
        drawScene(
          node.id,
          shapeDrag?.layerId === node.id && shapeDrag.preview
            ? shapeDrag.preview
            : node.scene
        )
        return
      }
      const layer = node
      // A layer rasterised, by command or by redo, is drawn from its pixels.
      target.setVectorScene(layer.id, null)
      // Hashed before the upload clears the mark: these texels are exactly
      // what the GPU is about to hold, so the first stroke over them knows
      // what it covered without reading anything back.
      if (layer.surface.tileCount() > 0 && layer.surface.dirtyBounds()) {
        history?.recordUpload(layer.id, layer.surface.tiles(), {
          width: document.width,
          height: document.height,
        })
        contentBounds.growTiles(layer.id, layer.surface.tiles())
      }
      target.uploadLayer(layer.id, layer.surface)
    }
    document.layers.forEach(upload)
  }

  /**
   * Tells the compositor what the stack is now. The renderer compares the plan
   * against the one in force and rebuilds the two caches only when it differs,
   * so this is safe to call after any command and costs nothing after most of
   * them (D19).
   */
  function syncComposition() {
    if (!renderer || !doc) return
    renderer.setComposition(planComposite(doc, { highlight }))
  }

  /** The stack as the snapshot carries it: settings, never pixels. */
  function describeLayers(document: PaintDocument) {
    const describe = (node: LayerNode): LayerSummary => {
      const mask = node.mask
        ? Object.freeze({ id: node.mask.id, enabled: node.mask.enabled })
        : undefined
      if (node.kind === "group") {
        const { children, mask: _mask, ...settings } = node
        return Object.freeze({
          ...settings,
          ...(mask ? { mask } : {}),
          children: Object.freeze(children.map(describe)),
        })
      }
      if (node.kind === "vector") {
        const { scene, mask: _mask, ...settings } = node
        return Object.freeze({
          ...settings,
          objects: scene.objects.length,
          ...(mask ? { mask } : {}),
        })
      }
      const { surface: _surface, mask: _mask, ...settings } = node
      // A placed image is described as movable only while the original it
      // would be re-rendered from is actually here. The tree keeps naming
      // that original either way — a machine that holds it is unaffected —
      // but a panel must not offer a control that can only fail.
      const placed =
        settings.placed && assets.has(settings.placed.asset.id)
          ? settings.placed
          : undefined
      return Object.freeze({
        ...settings,
        ...(placed ? { placed } : { placed: undefined }),
        ...(mask ? { mask } : {}),
      })
    }
    return {
      layers: Object.freeze(document.layers.map(describe)),
      activeLayerId: document.activeLayerId,
      paintingMask: document.paintingMask,
      guides: Object.freeze([...document.guides]),
    }
  }

  /** Every layer command needs the document, and none can make one. */
  function requireDocument(): PaintDocument {
    if (!doc) throw new Error("The graphics device is not ready.")
    return doc
  }

  /** Where the pen is painting: the layer itself, or the mask over it. */
  function paintTargetId(document: PaintDocument): string {
    const layer = activeLayer(document)
    return document.paintingMask && layer.mask ? layer.mask.id : layer.id
  }

  /**
   * Every id a node owns, itself and everything under it: layers, masks, and
   * the groups whose caches the renderer holds under their own id.
   */
  function nodeIdsOf(node: LayerNode): string[] {
    const ids =
      node.kind === "group"
        ? [node.id, ...node.children.flatMap(nodeIdsOf)]
        : [node.id]
    return node.mask ? [...ids, node.mask.id] : ids
  }

  /**
   * Records one discrete layer operation against the tree it was performed on,
   * so undoing it is a structure to restore plus, for an operation that
   * destroyed or copied pixels, the tiles to put back.
   */
  function recordOperation(
    label: string,
    before: DocumentStructure,
    operation?: OperationPixels
  ) {
    history?.recordOperation(
      label,
      { before, after: captureStructure(requireDocument()) },
      operation
    )
  }

  /**
   * What every layer command does after mutating the document: new surfaces
   * reach the GPU, the caches catch up, React hears about the structure, and
   * the frame that shows it is drawn.
   */
  function applyLayerChange() {
    const document = requireDocument()
    if (shapeDrag) {
      const target = findNodeIn(document.layers, shapeDrag.layerId)
      if (
        target?.kind !== "vector" ||
        target.locked ||
        document.activeLayerId !== shapeDrag.layerId ||
        document.paintingMask
      )
        dropShapeDrag()
    }
    uploadLayers()
    syncComposition()
    const layer = activeLayer(document)
    const ids =
      layer.kind === "vector"
        ? snapshot.vectorSelection.filter((id) =>
            layer.scene.objects.some((o) => o.id === id)
          )
        : []
    publish({ ...describeLayers(document), vectorSelection: ids })
    if (snapshot.status === "ready") render()
  }

  // The selection (07). History names each one it made by key, so undoing a
  // selection step is the tree plus the key to go back to; the masks are
  // immutable and share their tiles, which keeps every one of them cheap.
  let selection: SelectionMask | null = null
  let selectionKey: string | null = null
  const selections = new Map<string, SelectionMask>()
  let nextSelectionKey = 0
  /**
   * A selection tool's gesture in progress, in document pixels: a drag for
   * the marquees and the freehand lasso, a run of clicks for the polygonal
   * one (09), which outlives each pen-up until the outline is closed.
   */
  let marquee:
    | {
        shape: "rect" | "ellipse"
        anchor: Point
        point: Point
        mode: SelectionMode
        ended: boolean
      }
    | { shape: "lasso"; points: Point[]; mode: SelectionMode; ended: boolean }
    /** The move-outline tool (11): the selection dragged, pixels left put. */
    | { shape: "move"; anchor: Point; point: Point; ended: boolean }
    | {
        shape: "polygon"
        points: Point[]
        mode: SelectionMode
        /** The pen is down, placing the last vertex. */
        placing: boolean
        /** When the last vertex went down, for telling a double-click. */
        clickedAt: number
        /**
         * The click that closes the outline, which takes effect as the pen
         * lifts so the rest of its gesture is not read as a stroke.
         */
        closing?: "commit" | "drop"
      }
    | undefined
  /** Shift and Alt/Option, as the pen last reported them. */
  let shiftHeld = false
  let wand: WandOptions = DEFAULT_WAND
  let altHeld = false
  /** Ctrl, which locks a node drag to one axis. */
  let ctrlHeld = false
  /**
   * Shift chose the combine mode as the pen went down, so it is not also a
   * constraint until it has been let go and pressed again — the way a
   * marquee is both added and squared in every editor the hand learned on.
   */
  let shiftLatched = false
  const constrained = () => shiftHeld && !shiftLatched
  /** How near the first vertex, in backing pixels, a click closes a polygon. */
  const CLOSE_RADIUS = 8
  // How far the ants have marched. They move on a timer of their own, which
  // runs only while there is a selection to outline.
  let antsPhase = 0
  let antsTimer: ReturnType<typeof setInterval> | undefined
  const ANTS_INTERVAL_MS = 120

  /**
   * What the screen and the snapshot show; history is not touched. `draw`
   * is off where the caller is mid-way through replacing the document and
   * draws once it is whole.
   */
  function showSelection(mask: SelectionMask | null, draw = true) {
    selection = mask
    renderer?.setSelection(mask)
    publish({
      selection: mask ? Object.freeze({ bounds: mask.bounds }) : null,
    })
    if (mask && !antsTimer && !disposed)
      antsTimer = setInterval(() => {
        antsPhase = (antsPhase + 1) % 8
        // A frame of drawing already presents the ants where they are now.
        if (frame !== undefined || snapshot.status !== "ready") return
        try {
          render()
        } catch (error) {
          fail(error)
        }
      }, ANTS_INTERVAL_MS)
    if (!mask && antsTimer) {
      clearInterval(antsTimer)
      antsTimer = undefined
    }
    if (draw && snapshot.status === "ready") render()
  }

  /** Makes `mask` the selection as one undo step. */
  function commitSelection(label: string, mask: SelectionMask | null) {
    if (sameSelection(mask, selection)) {
      // Nothing changed, so not a step; a drag's preview is put back.
      showSelection(selection)
      return
    }
    const document = requireDocument()
    const key = mask ? `selection-${++nextSelectionKey}` : null
    if (mask) selections.set(key!, mask)
    history?.recordOperation(
      label,
      {
        before: { ...captureStructure(document), selection: selectionKey },
        after: { ...captureStructure(document), selection: key },
      },
      undefined
    )
    selectionKey = key
    showSelection(mask)
  }

  /**
   * Forgets every selection: the document it was drawn on is gone. Draws
   * nothing, since the caller is still putting the new document in place.
   */
  function resetSelection() {
    stopSelection()
    showSelection(null, false)
  }

  /** The same, with nothing drawn: for a teardown that has no frame to draw. */
  function stopSelection() {
    marquee = undefined
    selection = null
    selectionKey = null
    selections.clear()
    if (antsTimer) clearInterval(antsTimer)
    antsTimer = undefined
  }

  /** The shape a selection gesture outlines right now. */
  function marqueeShape(): SelectionMask | null {
    if (!marquee || !doc) return null
    if (marquee.shape === "move")
      return selection
        ? translateSelection(
            doc,
            selection,
            marquee.point.x - marquee.anchor.x,
            marquee.point.y - marquee.anchor.y
          )
        : null
    if (marquee.shape === "lasso" || marquee.shape === "polygon")
      return lassoSelection(doc, marquee.points)
    const box = dragRect(marquee.anchor, marquee.point, constrained())
    return marquee.shape === "rect"
      ? rectSelection(doc, box)
      : ellipseSelection(doc, box)
  }

  /** What the selection would become were the gesture to end now. */
  function marqueeMask(): SelectionMask | null {
    if (!marquee || !doc) return null
    if (marquee.shape === "move") return marqueeShape()
    return combineSelections(doc, selection, marqueeShape(), marquee.mode)
  }

  /** Shift adds, Alt/Option subtracts, both intersect (09). */
  function modeFromModifiers(): SelectionMode {
    if (shiftHeld && altHeld) return "intersect"
    if (shiftHeld) return "add"
    if (altHeld) return "subtract"
    return "replace"
  }

  /**
   * Straight-alpha RGBA8 of what the wand reads. The active layer's tiles are
   * premultiplied linear half floats; they are brought to the same footing as
   * the composite — display-encoded bytes — so a tolerance means the same
   * number of levels whichever is sampled.
   */
  async function wandPixels(): Promise<RenderedPixels | WandPixels> {
    const document = requireDocument()
    if (wand.sample === "composite") return await capturePixels()
    if (!renderer) throw new Error("The graphics device is not ready.")
    const { width, height } = document
    const coords = tilesCoveringRect({ x: 0, y: 0, width, height })
    const tiles = await renderer.readTiles(paintTargetId(document), coords)
    const data = new Uint8Array(width * height * 4)
    coords.forEach((coord, index) => {
      const texels = tiles[index]
      const span = intersectRect(tileBounds(coord), {
        x: 0,
        y: 0,
        width,
        height,
      })
      if (!span) return
      for (let y = span.y; y < span.y + span.height; y++)
        for (let x = span.x; x < span.x + span.width; x++) {
          const from =
            ((y - coord.y * TILE_SIZE) * TILE_SIZE + x - coord.x * TILE_SIZE) *
            4
          const to = (y * width + x) * 4
          const alpha = Math.min(
            1,
            Math.max(0, decodeFloat16(texels[from + 3]))
          )
          data[to + 3] = Math.round(alpha * 255)
          if (alpha === 0) continue
          for (let channel = 0; channel < 3; channel++)
            data[to + channel] = Math.round(
              encodeTransfer(decodeFloat16(texels[from + channel]) / alpha) *
                255
            )
        }
    })
    return { width, height, data }
  }

  /**
   * One click of the magic wand (10). Clicks are taken in turn, so a quick
   * shift-click combines with the selection the click before it made rather
   * than racing it; a document swapped out during the read is not selected in.
   */
  let wandQueue: Promise<void> = Promise.resolve()
  function selectWand(point: Point, mode: SelectionMode): Promise<void> {
    const run = wandQueue.then(async () => {
      const document = doc
      const pixels = await wandPixels()
      if (disposed || !doc || doc !== document) return
      const shape = wandSelection(pixels, point, wand.tolerance)
      // A click off the canvas picks nothing: a replacing wand lets go of the
      // selection there, as a replacing marquee's click does.
      const mask = combineSelections(doc, selection, shape, mode)
      commitSelection(mask ? "select" : "deselect", mask)
    })
    wandQueue = run.catch(() => {})
    return run
  }

  /** Ends a selection gesture, its outline becoming the selection. */
  function commitMarquee() {
    const moving = marquee?.shape === "move"
    const mask = marqueeMask()
    marquee = undefined
    forgetGestureInput()
    // A click without a drag is how a replacing marquee lets go of the
    // selection; adding or subtracting nothing leaves it as it was, and
    // intersecting with nothing empties it.
    if (moving) {
      // An outline dragged wholly off the canvas is let go of.
      commitSelection(mask ? "move selection" : "deselect", mask)
      return
    }
    commitSelection(mask ? "select" : "deselect", mask)
  }

  /**
   * Collects one dab, drawing early if the instance buffer would overflow.
   *
   * This is where the dynamics graph (D23) meets the renderer: the pen state
   * interpolated to this dab becomes a stamp context, the graph turns that
   * into a modulation, and the modulation scales the brush's own radius and
   * flow. Targets the stamp cannot yet express — tip angle, grain, scatter —
   * are evaluated all the same and land when their renderers do (D24).
   */
  function emitStamp(
    x: number,
    y: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ) {
    // The tracker was opened by the pen going down, so every dab advances it:
    // the first one has not moved from that point and so has no speed yet.
    const brush = activeBrush()
    const context = dynamics.next(x, y, pressure, tiltX, tiltY, time)
    evaluateDynamics(
      dynamicsForDevice(brush.dynamics, strokeSensesPressure),
      context,
      params
    )
    if (stampCount === MAX_STAMPS_PER_DRAW) flushStamps()
    const offset = stampCount * STAMP_STRIDE
    stamps[offset + STAMP.CENTER_X] = x
    stamps[offset + STAMP.CENTER_Y] = y
    const radius = brush.shape.radius * params.size
    stamps[offset + STAMP.RADIUS] = radius
    // Flow: the dab's own opacity, not the stroke's, which is applied once
    // when the buffer is composited (D27).
    stamps[offset + STAMP.OPACITY] = brush.rendering.flow * params.flow
    // Angle offsets the brush's own rotation and roundness scales its own
    // squash, which is what lets one dynamics list read the same on any tip.
    stamps[offset + STAMP.ANGLE] = brush.shape.angle + params.angle
    stamps[offset + STAMP.ROUNDNESS] = brush.shape.roundness * params.roundness
    // The brush's own grain depth is in the uniform; this is what the graph
    // does to it per dab, so a light touch can skim the paper (D24).
    stamps[offset + STAMP.GRAIN_DEPTH] = params.grainDepth
    stampCount++
    frameStamps++
    // What follows this dab, measured against the dab actually drawn rather
    // than against the brush at rest. A brush whose size is modulated would
    // otherwise keep laying dabs at its resting pitch: laid over, the pencil
    // put down more than twice as many overlapping dabs per pixel, and under
    // buildup that reads as tilt darkening the line rather than widening it.
    resampler.setSpacing(dabSpacing(brush, radius))
  }

  /**
   * Hands the renderer the brush's surface settings: the pixels behind its
   * texture ids, and the rim falloff the procedural dab is drawn with. Called
   * when the brush changes and when a renderer is created, since a renderer
   * starts with no textures and the brush may already name some.
   */
  function applyBrushTextures() {
    const brush = activeBrush()
    if (!renderer) return
    const grain = brush.grain
    // Feather is a uniform write and nothing more, so it is applied outside
    // the texture guard below: an editor's hardness slider must not be made
    // to re-upload the paper, and it must not be cached behind a key whose
    // other terms have not moved either.
    renderer.setFeather(brush.shape.feather)
    // Uploading a texture and rebuilding a bind group is real work, and
    // `setBrush` is what a dragged slider calls: a radius that changed must
    // not re-upload the paper the brush was already drawing on.
    const key = `${brush.shape.tipTextureId ?? ""}|${grain?.textureId ?? ""}|${grain?.scale ?? 1}|${grain?.depth ?? 0}|${grain?.movement ?? 0}`
    if (key === appliedTextures) return
    appliedTextures = key
    renderer.setTip(
      brush.shape.tipTextureId
        ? (textures.get(brush.shape.tipTextureId) ?? null)
        : null
    )
    renderer.setGrain(grain ? (textures.get(grain.textureId) ?? null) : null, {
      scale: grain?.scale ?? 1,
      depth: grain?.depth ?? 0,
      movement: grain?.movement ?? 0,
    })
  }

  function flushStamps() {
    if (stampCount === 0) return
    renderer?.stamp(stamps, stampCount)
    stampCount = 0
  }

  /**
   * One frame of drawing: drain everything the pen reported, stabilize it,
   * resample it by arc length, stamp, present. React is never told.
   */
  /** Hoisted so draining allocates no closure on any frame of a stroke. */
  function consumeSample(
    screenX: number,
    screenY: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number
  ) {
    // The pen reports where it is on screen; everything downstream — the
    // stabilizer, the resampler, the dabs — works in document pixels, so the
    // view is inverted here and nowhere else. This is what puts the mark
    // under the pen at any zoom, rotation and flip.
    let x = toDocX(screenX, screenY)
    let y = toDocY(screenX, screenY)
    if (opening) {
      // The line is chosen once, where the pen lands, and holds for the
      // whole stroke however far the hand wanders from it.
      const chosen = assistLine({
        x,
        y,
        guides: guidesVisible && snapping ? requireDocument().guides : [],
        guideReach: guideReach(),
        edge: straightEdge,
        fromLast: fromLastPoint ? lastStrokeEnd : null,
      })
      assist.begin(chosen?.line ?? null)
      if (chosen) {
        x = chosen.start.x
        y = chosen.start.y
      }
    } else {
      // Before the stabilizer, so the string is pulled along the line and
      // not across it. Only position moves: pressure and tilt stay the
      // pen's own (17).
      const onLine = assist.filter(x, y)
      x = onLine.x
      y = onLine.y
    }
    rawX = x
    rawY = y
    rawPressure = pressure
    rawTiltX = tiltX
    rawTiltY = tiltY
    rawTime = time
    if (frameObserver && frameOldestSample === null)
      frameOldestSample = strokeOrigin + time
    if (opening) {
      opening = false
      stabilizer.begin(x, y)
      resampler.begin(x, y, pressure, tiltX, tiltY, time, emitStamp)
      return
    }
    // Only position is stabilized: what the pen reported belongs to the sample
    // it was reported with, wherever the pulled string put the mark.
    const point = stabilizer.filter(x, y)
    resampler.extend(point.x, point.y, pressure, tiltX, tiltY, time, emitStamp)
  }

  /**
   * Puts the stored document back: the tree, then its pixels, straight into
   * the GPU surfaces they were read out of (§9.3). Tiles are named by content
   * hash, so nothing here has to decide whether what the device holds is
   * current — an immutable tile cannot be stale.
   *
   * Answers whether this session may write over what it just read. A stored
   * manifest owns its dimensions, so reopening it in any viewport restores
   * the same tile grid and remains safe to save.
   */
  async function restoreDocument(): Promise<boolean> {
    const target = renderer
    const past = history
    let document = doc
    const store = documents
    if (!target || !past || !document || !store) return true
    cloudBehind = false
    fullyLoaded = Promise.resolve()
    // A line from the last point means one in this document.
    lastStrokeEnd = null
    pendingTiles.clear()
    unsyncedWhileLoading = false
    // Bound once, here, so the batch loader below reads a hash and writes a
    // tile without repeating a non-null assertion at every call: TypeScript's
    // narrowing above does not reach into a closure defined further down.
    const readTile = store.readTile.bind(store)
    const writeTiles = target.writeTiles.bind(target)
    const recordUpload = past.recordUpload.bind(past)
    let stored = await persistence?.load()
    // Nothing on this device — a different machine may hold the document — or
    // this device's own copy is older than what a flush from elsewhere has
    // since put in the cloud (18: reopening picks up remote changes without a
    // manual refresh). Either way the cloud is read back from, merging only
    // the hashes this device does not already hold.
    if (options.cloud && options.persistence) {
      const remote = options.cloud.remote
      // A network problem here is the cloud being unreachable, not the
      // document being unreadable: this device's own local copy (if any) is
      // still shown and still safe to paint on and save (§9.2/18 — an outage
      // must not stop work, only the replication of it).
      const onCloudError = options.cloud.onError ?? (() => {})
      const meta = await remote.documentMeta().catch((error) => {
        onCloudError(error)
        return null
      })
      const newerElsewhere =
        meta !== null &&
        meta.structure !== null &&
        meta.updatedAt > (stored?.updatedAt ?? -Infinity)
      // The other way round: this device holds strokes a flush never
      // delivered, or the cloud has the strokes but never got their preview —
      // both what a session torn down mid-sync leaves behind. Nothing else
      // would send them until the next stroke, so this session does, once
      // the document is fully back.
      cloudBehind =
        meta !== null &&
        ((!!stored && meta.updatedAt < stored.updatedAt) ||
          (meta.structure !== null && meta.previewVersion === undefined))
      if (disposed) return true
      if (!stored || newerElsewhere)
        await hydrateFromRemote({
          documentId: options.persistence.documentId,
          remote,
          local: store,
        }).catch(onCloudError)
      if (disposed) return true
      stored = await persistence?.load()
    }
    if (!stored || disposed) return true
    // Only tiles successfully read from this device are ours to name as
    // removed later. A manifest can outlive one of its blobs; treating that
    // missing blob as an erase would delete its still-valid cloud row.
    const loadedOnOpen = new Map<string, TileRef[]>()
    const seedLoadedTiles = () =>
      cloudSync?.seedKnown(
        [...loadedOnOpen].map(([surfaceId, tiles]) => ({ surfaceId, tiles }))
      )
    if (stored.width !== document.width || stored.height !== document.height) {
      validateDocumentSize(stored)
      for (const id of structureSurfaceIds(captureStructure(document)))
        releaseSurface(id)
      setDocumentSize({ width: stored.width, height: stored.height })
      document = requireDocument()
      applyView()
    }
    // The seeded canvas this session opened on is not part of the document
    // that was stored, and neither is the upload that recorded it.
    past.clear()
    for (const id of structureSurfaceIds(captureStructure(document)))
      releaseSurface(id)
    // A document saved with pixels its tree does not name opens with a layer
    // for them, rather than leaving them on disk behind a blank canvas.
    const structure = parseSavedScenes(
      adoptStrandedSurfaces(stored.structure, stored.surfaces)
    )
    reserveIds(structureSurfaceIds(structure))
    restoreStructure(document, structure)
    // The originals before the pixels: they are small beside a document's
    // tiles, and a picture that opened without its original would be one the
    // artist could see and not move (06). One missing from the device is a
    // picture that can still be shown — the tiles are the document — and not
    // moved until it is fetched again.
    await Promise.all(
      structureAssets(structure).map(async (ref) => {
        if (assets.has(ref.id)) return
        const bytes = await store.readAsset(ref.id)
        if (bytes) assets.set(ref.id, Object.freeze({ ...ref, bytes }))
      })
    )
    if (disposed) return true
    const canvas = { width: document.width, height: document.height }

    // A tile is a file read and an inflate, so a batch is asked for together
    // rather than one at a time, and reads a surface's own texels into the
    // GPU surface they were read out of.
    async function loadTiles(
      surface: SurfaceTiles,
      refs: readonly TileRef[]
    ): Promise<void> {
      if (refs.length === 0) return
      const texels = await Promise.all(refs.map((tile) => readTile(tile.hash)))
      if (disposed) return
      // A tile the manifest names but the device has lost is a hole in the
      // document rather than the end of the restore.
      const loaded = refs.filter((_, position) => texels[position] !== null)
      if (loaded.length > 0)
        loadedOnOpen.set(surface.surfaceId, [
          ...(loadedOnOpen.get(surface.surfaceId) ?? []),
          ...loaded,
        ])
      const tiles = refs.flatMap((tile, position) =>
        texels[position]
          ? [{ x: tile.x, y: tile.y, texels: texels[position]! }]
          : []
      )
      if (tiles.length === 0) return
      writeTiles(surface.surfaceId, tiles)
      // These texels are exactly what the GPU now holds, so the index history
      // keeps — and the next manifest written from it — starts out true.
      recordUpload(surface.surfaceId, tiles, canvas)
      contentBounds.growTiles(surface.surfaceId, tiles)
    }

    // The visible region resolves first (18): every surface's own tiles are
    // ordered by distance from the viewport's centre, and only the near ones
    // are awaited before the canvas is shown. The rest load in the
    // background, in the same near-to-far order, so a document with many
    // tiles is paintable long before the last of them is in.
    const center = {
      x: tileIndexForPixel(canvas.width / 2),
      y: tileIndexForPixel(canvas.height / 2),
    }
    const proximityOrder = (tiles: readonly TileRef[]): TileRef[] =>
      [...tiles].sort((a, b) => {
        const distanceA = (a.x - center.x) ** 2 + (a.y - center.y) ** 2
        const distanceB = (b.x - center.x) ** 2 + (b.y - center.y) ** 2
        return distanceA - distanceB
      })
    // Roughly a 5x5 block of tiles around the centre: enough to fill the
    // middle of the view immediately without holding up the first frame on a
    // document that may have thousands of tiles behind it.
    const IMMEDIATE_TILES = 25
    const BACKGROUND_BATCH = 8

    const background: { surface: SurfaceTiles; tiles: TileRef[] }[] = []
    for (const surface of stored.surfaces) {
      const ordered = proximityOrder(surface.tiles)
      await loadTiles(surface, ordered.slice(0, IMMEDIATE_TILES))
      if (disposed) return true
      const rest = ordered.slice(IMMEDIATE_TILES)
      if (rest.length > 0) {
        background.push({ surface, tiles: rest })
        pendingTiles.set(
          surface.surfaceId,
          new Map(rest.map((tile) => [tileKey(tile.x, tile.y), tile]))
        )
      }
    }
    await past.settle()
    // Vector layers have no tiles to load: they are drawn from their scenes.
    for (const layer of leafLayers(document.layers))
      if (layer.kind === "vector") drawScene(layer.id, layer.scene)
    syncComposition()
    publish(describeLayers(document))
    if (background.length > 0) {
      publish({ loading: true })
      fullyLoaded = (async () => {
        for (const { surface, tiles } of background) {
          for (let index = 0; index < tiles.length; index += BACKGROUND_BATCH) {
            if (disposed) return
            const batch = tiles.slice(index, index + BACKGROUND_BATCH)
            await loadTiles(surface, batch)
            if (disposed) return
            const pending = pendingTiles.get(surface.surfaceId)
            for (const tile of batch) pending?.delete(tileKey(tile.x, tile.y))
            if (pending?.size === 0) pendingTiles.delete(surface.surfaceId)
            await past.settle()
            syncComposition()
            publish(describeLayers(document))
            if (snapshot.status === "ready") render()
          }
        }
        if (disposed) return
        seedLoadedTiles()
        publish({ loading: false })
        if (unsyncedWhileLoading) {
          unsyncedWhileLoading = false
          flushScheduler?.touch()
          publishSyncStatus()
        }
      })()
    } else seedLoadedTiles()

    return true
  }

  /**
   * Draws what the pen has sent into the stroke buffer, and once the pen has
   * lifted, the tail and the whole mark into its layer. Presenting is left
   * to the frame.
   */
  function landStroke() {
    samples.drain(consumeSample)
    // A stroke that ended before its opening sample was drained drew nothing.
    if (!stroking && !opening) {
      landing = false
      // The string is released on pen-up, so the mark reaches where the pen
      // lifted instead of stopping a pull radius short of it.
      resampler.extend(
        rawX,
        rawY,
        rawPressure,
        rawTiltX,
        rawTiltY,
        rawTime,
        emitStamp
      )
      resampler.end(emitStamp)
      flushStamps()
      lastStrokeEnd = { x: rawX, y: rawY }
      // The whole mark is in the buffer now, so it goes into the layer once,
      // at the stroke's opacity (D27).
      const region = renderer?.endStroke()
      // One stroke, one step. The region the mark landed in is read back off
      // the GPU after the frame, never during one.
      if (region && doc) {
        history?.recordStroke(paintTargetId(doc), region)
        contentBounds.grow(paintTargetId(doc), region)
        invalidateThumbnailsOf(paintTargetId(doc))
      }
    }
    flushStamps()
  }

  function drawFrame(timestamp: number) {
    frame = undefined
    const cpuStart = frameObserver ? performance.now() : 0
    frameStamps = 0
    frameOldestSample = null
    if (shapeDrag) {
      drawShapeDrag()
      return
    }
    if (vectorErase) {
      drawVectorErase()
      return
    }
    if (marquee) {
      drawMarquee()
      return
    }
    if (isVectorTool(tool)) {
      samples.clear()
      return
    }
    landStroke()
    try {
      if (snapshot.status === "ready") render()
    } catch (error) {
      fail(error)
      return
    }
    if (frameObserver) reportFrame(timestamp, cpuStart)
    if (stroking) frame = requestAnimationFrame(drawFrame)
  }

  /**
   * One frame of a selection drag: the pen's latest position outlines the
   * shape, shown by its ants until the pen lifts and it becomes the selection.
   */
  function drawMarquee() {
    const drag = marquee!
    samples.drain((x, y) => {
      const point = { x: toDocX(x, y), y: toDocY(x, y) }
      if (drag.shape === "lasso") {
        const last = drag.points[drag.points.length - 1]
        if (last.x !== point.x || last.y !== point.y) drag.points.push(point)
      } else if (drag.shape === "polygon") {
        if (drag.placing) drag.points[drag.points.length - 1] = point
      } else drag.point = point
    })
    if (drag.shape !== "polygon" && drag.ended) {
      commitMarquee()
      return
    }
    // Until the gesture outlines something, what is selected stays shown.
    // A moved outline has nowhere to be shown once it is off the canvas.
    renderer?.setSelection(
      marqueeShape() || drag.shape === "move" ? marqueeMask() : selection
    )
    try {
      if (snapshot.status === "ready") render()
    } catch (error) {
      fail(error)
      return
    }
    // Between clicks a polygon waits for the next one, not for a frame.
    if (drag.shape !== "polygon" || drag.placing)
      frame = requestAnimationFrame(drawFrame)
  }

  /**
   * What the pen reported for a gesture that has ended is not a stroke's to
   * draw, and a frame still waiting for it would take it for one.
   */
  function forgetGestureInputFrame() {
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  function forgetGestureInput() {
    samples.clear()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
  }

  /** Abandons a selection gesture, the selection left as it was. */
  function dropMarquee() {
    if (!marquee) return
    marquee = undefined
    forgetGestureInput()
    showSelection(selection)
  }

  /**
   * One click of the polygonal lasso: a new vertex, or — on the first vertex
   * or a double-click — the outline closed and made the selection.
   */
  /**
   * Where a click lands on a polygon being clicked out: back on its first
   * corner once it has three, or on its last corner again within a
   * double-click. Both polygon tools close by the same rule, each at its reach.
   */
  function polygonClick(
    points: readonly Point[],
    point: Point,
    clickedAt: number,
    time: number,
    reach: number
  ) {
    const near = (other: Point) =>
      Math.hypot(point.x - other.x, point.y - other.y) <= reach
    return {
      onFirst: points.length >= 3 && near(points[0]),
      doubled:
        time - clickedAt <= DOUBLE_CLICK_MS && near(points[points.length - 1]),
    }
  }

  function clickPolygon(point: Point, time: number) {
    if (!marquee || marquee.shape !== "polygon") {
      marquee = {
        shape: "polygon",
        points: [point],
        mode: modeFromModifiers(),
        placing: true,
        clickedAt: time,
      }
      shiftLatched = shiftHeld
      scheduleFrame()
      return
    }
    const polygon = marquee
    const { onFirst, doubled } = polygonClick(
      polygon.points,
      point,
      polygon.clickedAt,
      time,
      CLOSE_RADIUS * Math.hypot(toDoc[0], toDoc[1])
    )
    if (onFirst || doubled) {
      // Too few corners to hold any area: the outline is dropped rather than
      // made the selection, so a stray double-click never deselects.
      polygon.closing = polygon.points.length < 3 ? "drop" : "commit"
      return
    }
    polygon.points.push(point)
    polygon.placing = true
    polygon.clickedAt = time
    scheduleFrame()
  }

  /**
   * Closes one frame's timing once the GPU says the frame is done. Read after
   * the fence rather than after submission, because submission only means the
   * work was handed over — the pixel the pen is waiting for is not on screen
   * until the queue has drained.
   */
  function reportFrame(timestamp: number, cpuStart: number) {
    const observer = frameObserver
    const queue = device?.queue
    if (!observer || !queue) return
    const cpuMs = performance.now() - cpuStart
    const stamps = frameStamps
    const oldest = frameOldestSample
    void queue.onSubmittedWorkDone().then(() => {
      if (frameObserver !== observer) return
      observer({
        start: timestamp,
        cpuMs,
        stamps,
        latencyMs: oldest === null ? null : performance.now() - oldest,
      })
    })
  }

  function scheduleFrame() {
    if (frame === undefined && !disposed)
      frame = requestAnimationFrame(drawFrame)
  }

  let lastNodeClick: NodeClick | undefined
  /** Counts arrow presses, so a held key's nudges are one step, two presses two. */
  let nodeKeyRun = 0

  function snapVectorPoint(point: Point, layerId: string): Point {
    if (!snapping || altHeld) return point
    const snap = resolveSnap(
      { ...point, width: 0, height: 0 },
      snapTargetsBesides(layerId),
      6 / snapshot.view.zoom
    )
    return { x: point.x + snap.dx, y: point.y + snap.dy }
  }

  /** What a node drag to where it is now makes of the layer's scene. */
  function nodeDragEdits(
    drag: NonNullable<typeof shapeDrag>,
    scene: VectorScene
  ): SceneCommand[] {
    return dragNodes({
      scene,
      grab: drag.node!,
      nodes: snapshot.vectorNodes,
      point: drag.point,
      modifiers: { ctrl: ctrlHeld, alt: altHeld, shift: shiftHeld },
    })
  }

  /** Screen pixels the pointer travels before a press on a node drags it. */
  const NODE_DRAG_THRESHOLD = 3

  function beginNodeDrag(layer: VectorLayer, point: Point, time: number) {
    const press = pressNode({
      scene: layer.scene,
      selection: snapshot.vectorSelection,
      nodes: snapshot.vectorNodes,
      shift: shiftHeld,
      point,
      reach: 6 / snapshot.view.zoom,
      time,
      lastClick: lastNodeClick,
    })
    if (
      press.selection.length !== snapshot.vectorSelection.length ||
      press.selection.some((id) => !snapshot.vectorSelection.includes(id))
    )
      setVectorSelection(press.selection)
    lastNodeClick = press.lastClick
    if (press.kind === "grab" || press.kind === "box") {
      publish({
        vectorNodes: press.nodes,
        vectorHandleHeld: press.kind === "grab" && isHandle(press.grab.part),
      })
      shapeDrag = {
        layerId: layer.id,
        tool: "node",
        anchor: point,
        point: press.kind === "grab" ? press.at : point,
        ended: false,
        ...(press.kind === "grab"
          ? {
              node: press.grab,
              nodeAt: press.at,
              ctrlClick: ctrlHeld,
            }
          : { nodeBox: true as const }),
      }
      scheduleFrame()
      return
    }
    if (press.kind === "split") {
      publish({ vectorNodes: [] })
      editScene(
        layer.id,
        [
          {
            type: "update",
            id: press.objectId,
            patch: { geometry: press.geometry },
          },
        ],
        "add node"
      )
    }
    publish({ vectorNodes: press.nodes })
  }

  /**
   * Where a node-tool rubber band ends: a click on empty canvas lets go of
   * every path, as it always has; a band selects the nodes inside it.
   */
  function endNodeBox(drag: NonNullable<typeof shapeDrag>) {
    const region = boxSelection(drag.anchor, drag.point)
    if (!Array.isArray(region)) {
      if (!shiftHeld) {
        setVectorSelection([])
        publish({ vectorNodes: [] })
      }
      return
    }
    publish({
      vectorNodes: boxNodes(
        snapshot.vectorPaths,
        snapshot.vectorNodes,
        region,
        shiftHeld
      ),
    })
  }

  function beginStroke(
    screenX: number,
    screenY: number,
    pressure: number,
    tiltX: number,
    tiltY: number,
    time: number,
    origin: number,
    sensesPressure: boolean
  ) {
    if (snapshot.status !== "ready" || !doc) return
    // The last stroke lands before the pen starts anything else: a marquee
    // or shape skips the frame that would land it, and a new stroke would
    // take its tail for its own.
    landLiftedStroke()
    if (isSelectionTool(tool)) {
      // The selection belongs to the document, so a locked or image layer
      // does not stop one being drawn.
      const anchor = {
        x: toDocX(screenX, screenY),
        y: toDocY(screenX, screenY),
      }
      if (tool === "polygonLasso") {
        clickPolygon(anchor, origin)
        return
      }
      if (tool === "magicWand") {
        void selectWand(anchor, modeFromModifiers()).catch(() => {
          publish({
            problem: {
              action: "retry",
              message: "That area could not be selected. Try again.",
            },
          })
        })
        return
      }
      if (tool === "moveSelection") {
        // Nothing selected, nothing to move.
        if (!selection) return
        marquee = { shape: "move", anchor, point: anchor, ended: false }
        scheduleFrame()
        return
      }
      const mode = modeFromModifiers()
      shiftLatched = shiftHeld
      marquee =
        tool === "lasso"
          ? { shape: "lasso", points: [anchor], mode, ended: false }
          : {
              shape: tool === "rectSelect" ? "rect" : "ellipse",
              anchor,
              point: anchor,
              mode,
              ended: false,
            }
      scheduleFrame()
      return
    }
    if (isVectorTool(tool)) {
      cancelVectorTransform()
      // Shapes go onto a vector layer, never into paint or a mask.
      const layer = activeLayer(doc)
      if (layer.kind !== "vector" || layer.locked || doc.paintingMask) return
      const anchor = {
        x: toDocX(screenX, screenY),
        y: toDocY(screenX, screenY),
      }
      if (tool === "node") {
        beginNodeDrag(layer, anchor, origin)
        return
      }
      if (tool === "pen") {
        const point = snapVectorPoint(anchor, layer.id)
        if (shapeDrag?.tool === "pen") {
          const first = shapeDrag.nodes![0]
          if (
            shapeDrag.nodes!.length >= 2 &&
            Math.hypot(anchor.x - first.x, anchor.y - first.y) <
              6 / snapshot.view.zoom
          ) {
            shapeDrag.closed = true
            shapeDrag.ended = true
            shapeDrag.placing = false
          } else {
            shapeDrag.nodes!.push({
              ...point,
              in: null,
              out: null,
              type: "cusp",
            })
            shapeDrag.placing = true
            shapeDrag.point = point
          }
        } else
          shapeDrag = {
            layerId: layer.id,
            tool,
            anchor: point,
            point,
            nodes: [{ ...point, in: null, out: null, type: "cusp" }],
            placing: true,
            ended: false,
          }
        publish({ penNodes: [...shapeDrag.nodes!] })
        scheduleFrame()
        return
      }
      if (tool === "pressure") {
        stabilizer.begin(anchor.x, anchor.y)
        const points: PressurePoint[] = []
        const path = createStrokeResampler(2)
        path.begin(
          anchor.x,
          anchor.y,
          pressure,
          tiltX,
          tiltY,
          time,
          (x, y, pressure) => points.push({ x, y, pressure })
        )
        shapeDrag = {
          layerId: layer.id,
          tool,
          anchor,
          point: anchor,
          ended: false,
          pressurePoints: points,
          pressureResampler: path,
          pressureTail: { ...anchor, pressure, tiltX, tiltY, time },
        }
        scheduleFrame()
        return
      }
      // Shift squares the shape for as long as it is held.
      shiftLatched = false
      if (tool === "polygon" && shapeDrag?.tool === "polygon") {
        const points = shapeDrag.points!
        // A double-click places its corner with the first click and closes
        // with the second, as a click back on the first corner does.
        const { onFirst, doubled } = polygonClick(
          points,
          anchor,
          shapeDrag.clickedAt!,
          time,
          6 / snapshot.view.zoom
        )
        if (points.length >= 3 && (onFirst || doubled)) endPolygon(shapeDrag)
        else if (!doubled) {
          points.push(anchor)
          shapeDrag.point = anchor
          shapeDrag.clickedAt = time
        }
      } else
        shapeDrag = {
          layerId: layer.id,
          tool,
          points: tool === "polygon" ? [anchor] : undefined,
          clickedAt: tool === "polygon" ? time : undefined,
          anchor,
          point: anchor,
          ended: false,
        }
      scheduleFrame()
      return
    }
    // A locked layer is one the painter has said not to touch, and the pen is
    // the one place that has to be told so.
    // An image or vector layer refuses it too, unless the stroke is going to
    // its mask: its pixels are drawn from a picture or from shapes.
    const layer = activeLayer(doc)
    // The eraser on a vector layer erases its shapes, not pixels it has none
    // of: by a mark kept with them, or whole; on its mask it erases the mask
    // as anywhere else.
    if (
      tool === "eraser" &&
      layer.kind === "vector" &&
      !layer.locked &&
      !(doc.paintingMask && layer.mask)
    ) {
      cancelVectorTransform()
      const radius = eraser.shape.radius
      vectorErase =
        snapshot.vectorEraser === "object"
          ? {
              mode: "object",
              layerId: layer.id,
              scene: layer.scene,
              eraser: objectEraser(layer.scene, radius),
              ended: false,
            }
          : {
              mode: "pixel",
              layerId: layer.id,
              scene: layer.scene,
              id: nextObjectId(layer.scene),
              points: [],
              fit: createPressureFit(radius * 2, undefined, fitTolerance()),
              fed: 0,
              style: {
                fill: null,
                stroke: {
                  // Never seen: the mark's alpha is all it uses.
                  color: "#000000",
                  opacity: eraser.rendering.opacity,
                  width: radius * 2,
                  cap: "round",
                  join: "round",
                },
              },
              ended: false,
            }
      samples.push(screenX, screenY, pressure, tiltX, tiltY, time)
      scheduleFrame()
      return
    }
    const drawnFrom = layer.kind === "vector" || layer.image
    if (layer.locked || (drawnFrom && !(doc.paintingMask && layer.mask))) return
    // The artist is painting, so the canvas shows what they are painting on.
    if (highlight) {
      highlight = undefined
      syncComposition()
    }
    // The opening pen state is read in document space too, so a mapping onto
    // position means the same thing at any view.
    const x = toDocX(screenX, screenY)
    const y = toDocY(screenX, screenY)
    const brush = activeBrush()
    strokeOrigin = origin
    // Per stroke, not per session: the next mark may come from another device.
    strokeSensesPressure = sensesPressure
    // Stroke opacity is applied once, at composite, so it is decided once,
    // here — from the pen state the stroke opened with. Nothing derived from
    // movement is known yet, so a mapping onto `opacity` reads what the pen
    // reported and not how it was moved; per-dab response is what `flow` is
    // for. Opening the tracker here is also what makes the first dab's own
    // context an advance rather than a restart.
    evaluateDynamics(
      dynamicsForDevice(brush.dynamics, sensesPressure),
      dynamics.begin(x, y, pressure, tiltX, tiltY, time, ++strokeSeed),
      strokeParams
    )
    // Dabs land in the stroke buffer, not the layer, until the pen lifts.
    renderer?.beginStroke({
      accumulation: brush.rendering.accumulation,
      opacity: brush.rendering.opacity * strokeParams.opacity,
      mode: tool === "eraser" ? "erase" : "paint",
    })
    stroking = true
    opening = true
    // Shift at pen-down rules a line on from where the last stroke lifted.
    fromLastPoint = shiftHeld
    // Pushed as the pen reported it: the buffer carries screen pixels and the
    // frame loop maps every sample the same way.
    samples.push(screenX, screenY, pressure, tiltX, tiltY, time)
    scheduleFrame()
  }

  /**
   * Drops the mark in flight without compositing it. A navigation gesture
   * that began as a stroke ends this way: what the artist wanted was to move
   * the canvas, not to leave a dot on it.
   */
  function cancelStroke() {
    if (shapeDrag) {
      dropShapeDrag()
      return
    }
    if (vectorErase) {
      dropVectorErase()
      return
    }
    if (marquee) {
      // A polygon loses only the vertex the gesture was placing.
      if (marquee.shape === "polygon" && marquee.points.length > 1) {
        if (marquee.placing) marquee.points.pop()
        marquee.placing = false
        marquee.closing = undefined
      } else marquee = undefined
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
      samples.clear()
      // Back to what was selected before the drag began.
      if (marquee)
        renderer?.setSelection(marqueeShape() ? marqueeMask() : selection)
      else showSelection(selection)
      if (marquee && snapshot.status === "ready") render()
      return
    }
    if (!stroking && !opening) return
    stroking = false
    opening = false
    landing = false
    // The frame already scheduled would see a stroke that has just ended and
    // flush its tail into the layer, which is the very mark being taken back.
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    stampCount = 0
    samples.clear()
    renderer?.cancelStroke()
    if (snapshot.status === "ready") render()
  }

  function endStroke() {
    if (shapeDrag) {
      if (shapeDrag.tool === "pen" && !shapeDrag.ended) {
        // Drain the final drag samples before the next click changes its anchor.
        forgetGestureInputFrame()
        drawShapeDrag()
        if (shapeDrag) {
          shapeDrag.placing = false
          publish({ penNodes: [...shapeDrag.nodes!] })
        }
        forgetGestureInput()
        return
      }
      if (shapeDrag.tool === "polygon" && !shapeDrag.ended) return
      shapeDrag.ended = true
      // A node band settles which nodes are selected the moment it is let
      // go, as a click on empty canvas always has, not a frame later.
      if (shapeDrag.nodeBox) {
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = undefined
        drawShapeDrag()
        return
      }
      scheduleFrame()
      return
    }
    if (vectorErase) {
      vectorErase.ended = true
      scheduleFrame()
      return
    }
    if (marquee) {
      if (marquee.shape === "polygon") {
        if (marquee.closing) {
          if (marquee.closing === "drop") dropMarquee()
          else commitMarquee()
          return
        }
        marquee.placing = false
      } else marquee.ended = true
      scheduleFrame()
      return
    }
    if (!stroking) return
    // The tail is flushed by the next frame, so the stroke reaches the point
    // the pen actually lifted from rather than stopping a sample short.
    stroking = false
    landing = true
    scheduleFrame()
    // An eraser removes ink rather than using it, so it never counts.
    if (snapshot.tool !== "eraser")
      options.onStrokeCommitted?.(snapshot.color.hex)
  }

  /**
   * Lands a lifted stroke now rather than on the frame it waits for, so a
   * command sent as the pen lifts — dropping the selection, switching layer —
   * applies after the stroke, as the artist made them. The frame already
   * scheduled still presents it. The one place the stroke pipeline draws
   * outside the frame (architecture §6.2).
   */
  function landLiftedStroke() {
    if (!landing) return
    landing = false
    landStroke()
  }

  /**
   * A released shape or node-tool gesture finishes on the next frame; a
   * command arriving before then would otherwise be undone by it, as a Tab
   * straight after a node click once was.
   */
  function landEndedShapeDrag() {
    if (!shapeDrag?.ended) return
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    drawShapeDrag()
  }

  function render(): GPUTexture {
    if (!device || !context || !renderer)
      throw new Error("The graphics device is not ready.")
    const texture = context.getCurrentTexture()
    renderer.render(texture.createView(), { ants: antsPhase })
    return texture
  }

  /**
   * Wide gamut needs a display that can show it and a swap chain that can
   * present it. Configuring is the only honest test of the second, so an
   * unsupported colour space falls back rather than failing to start.
   */
  function configureOutput(
    target: GPUCanvasContext,
    acquired: GPUDevice
  ): OutputColorSpace {
    const configuration = {
      device: acquired,
      format,
      alphaMode: "opaque",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    } as const
    const displaySupportsP3 =
      globalThis.matchMedia?.("(color-gamut: p3)").matches ?? false
    const chosen = chooseOutputColorSpace({
      displaySupportsP3,
      gpuSupportsP3: displaySupportsP3 && acceptsP3(target, configuration),
    })
    target.configure({ ...configuration, colorSpace: chosen })
    return chosen
  }

  /** Whether this swap chain will take a P3 configuration at all. */
  function acceptsP3(
    target: GPUCanvasContext,
    configuration: GPUCanvasConfiguration
  ): boolean {
    try {
      target.configure({ ...configuration, colorSpace: "display-p3" })
      return true
    } catch {
      return false
    }
  }

  async function initialize() {
    publish({ status: "initializing", error: null, problem: null })
    try {
      const gpu = navigator.gpu
      if (!gpu) {
        publish({ status: "unavailable" })
        return
      }
      const adapter = await gpu.requestAdapter()
      if (disposed) return
      if (!adapter) {
        publish({ status: "unavailable" })
        return
      }
      const acquired = await adapter.requestDevice()
      if (disposed) {
        acquired.destroy()
        return
      }
      device = acquired
      void acquired.lost.then(() => recoverDevice(acquired))
      acquired.addEventListener("uncapturederror", (event) => {
        if (device === acquired) fail(event.error)
      })
      context = canvas.getContext("webgpu") as GPUCanvasContext | null
      if (!context) throw new Error("Could not create a WebGPU canvas context.")
      format = gpu.getPreferredCanvasFormat()
      acquired.pushErrorScope("validation")
      const colorSpace = configureOutput(context, acquired)
      const target = createRenderer(acquired, {
        format,
        outputColorSpace: colorSpace,
        background: BACKGROUND,
        workspaceBackground: WORKSPACE_BACKGROUND,
        ink: BRUSH_COLOR,
        feather: BRUSH_FEATHER,
      })
      renderer = target
      target.setRasterMagnification(snapshot.rasterMagnification)
      const local = options.persistence
      const store = local
        ? createDocumentStore(local.blobs ?? createLocalBlobStore())
        : undefined
      documents = store
      history = createDocumentHistory({
        bridge: {
          readTiles: (id, coords) => target.readTiles(id, coords),
          writeTiles: (id, tiles) => {
            target.writeTiles(id, tiles)
            contentBounds.growTiles(id, tiles)
            // Undo and redo land here, and may not change the structure.
            invalidateThumbnailsOf(id)
          },
        },
        // The oldest tiles leave memory for the browser's own filesystem, so
        // a session's history is bounded by disk rather than by the tab (D21).
        budgetBytes: options.history?.budgetBytes,
        store: createTileStore({
          hotBytes: options.history?.hotBytes ?? DEFAULT_HOT_BYTES,
          warmBytes: options.history?.warmBytes ?? DEFAULT_WARM_BYTES,
          spill: createOpfsSpill(),
        }),
        onChange: () => publishHistory(),
        onError: fail,
        // Every route a pixel takes into the document — a stroke, a layer
        // operation, an undo — ends here, which is why the write to disk hangs
        // off the commit rather than off the pen (§9.2).
        onCommit: () => {
          // Recording lands after the stroke that caused it, so this is when
          // a layer is first known to hold something — or, erased, nothing.
          invalidateChangedHoldings()
          if (!restored) return
          // A step landing on top of a restore on trial is the artist painting
          // over it: the trial is over, and undoing that step later lands on
          // a restore they have made theirs, not on a preview.
          if (
            restoreStep !== undefined &&
            !applyingRestore &&
            !revertingRestore &&
            history?.topStep() !== restoreStep
          ) {
            restoreStep = undefined
            publishHistory()
          }
          if (restoreOnTrial()) {
            publishSyncStatus()
            return
          }
          if (snapshot.loading) unsyncedWhileLoading = true
          void persistence?.save()
          // Scheduling is a timer reset, not a network call, so this never
          // costs a stroke a frame (§9.2's "off the interactive path").
          committedSinceOpen = true
          flushScheduler?.touch()
          // A fresh commit changes what a flush would upload, so whatever
          // "fully-synced" meant a moment ago no longer applies.
          publishSyncStatus()
        },
      })
      if (local && store) {
        const past = history
        persistence = createDocumentPersistence({
          documentId: local.documentId,
          store,
          // The texels come out of the store history is already holding them
          // in, so undo and the local cache share one copy of every tile (D21).
          tiles: (hash) => past.store.get(hash),
          // The originals placed images are re-rendered from, held for the
          // session and written beside the tiles (06).
          assets: async (id) => assetFor(id).bytes,
          snapshot: () => {
            const structure = structureForSave()
            return {
              width: snapshot.width,
              height: snapshot.height,
              structure,
              // Tiles still loading are on disk already and belong to the
              // document; history just has not been handed them yet.
              surfaces: withPendingTiles(past.tileIndex(), structure),
              assets: writableAssets(structure),
            }
          },
          onError: (error) => {
            local.onError?.(error)
            publish({ problem: explainFailure(error, "storage") })
          },
        })

        if (options.cloud) {
          const cloud = options.cloud
          cloudSync = createCloudSync({
            remote: cloud.remote,
            // Same tile source and tile index as local persistence: the
            // upload set is exactly what disk already holds (D14).
            tiles: (hash) => past.store.get(hash),
            assets: async (id) => assetFor(id).bytes,
            snapshot: () => {
              // Scenes travel inside the tree; the backend files them as
              // records of their own (20). Their pixels — a cache of the
              // scenes — are never in the tile index, so never go up.
              const structure = structureForSave()
              return {
                structure,
                surfaces: past.tileIndex(),
                assets: writableAssets(structure),
              }
            },
            // capturePixels presents through the renderer's one display-transform
            // pass. PNG encoding and scaling happen after the GPU readback,
            // off the stroke frame and only when the flush scheduler fires.
            preview: async () => encodePreview(await capturePixels()),
            onPreview: cloud.onPreview,
            // A flush that fails — an outage, a dropped response — is not the
            // document failing: the stroke is already safe on disk, and
            // `status()` staying "saved-locally" already says truthfully that
            // it has not left this device yet (18). The next idle tick, tab
            // hide or explicit save tries again.
            onError: (error) => {
              cloud.onError?.(error)
              publish({ problem: explainFailure(error, "upload") })
            },
            onStatusChange: () => {
              publishSyncStatus()
              // Also told after dispose, while a last flush finishes, which
              // is when a host no longer subscribed to the snapshot needs it.
              if (cloudSync) cloud.onSyncStatus?.(cloudSync.status())
            },
          })
          flushScheduler = createFlushScheduler({
            // An idle timer set by earlier strokes can come due mid-preview.
            flush: () => {
              if (!restoreOnTrial() && !snapshot.loading)
                void cloudSync?.flush()
            },
            idleMs: cloud.idleMs ?? DEFAULT_CLOUD_IDLE_MS,
          })
        }
      }
      // A new renderer holds no textures, whatever the brush was told before.
      appliedTextures = undefined
      applyBrushTextures()
      publish({ outputColorSpace: colorSpace })
      // Re-published rather than assigned, because the snapshot's colour is
      // encoded for the output space and this is where that space is decided:
      // on a wide-gamut display the ink chosen before initialization would
      // otherwise still be described in sRGB.
      setInk(
        ink[3] > 0
          ? ([ink[0] / ink[3], ink[1] / ink[3], ink[2] / ink[3]] as const)
          : ([0, 0, 0] as const),
        ink[3]
      )
      resize()
      // Whatever this device already holds of the document replaces the empty
      // canvas before a single frame of it is shown. A restore that cannot be
      // completed leaves saving switched off — writing over work this session
      // failed to read would be worse than not saving it — and says so.
      // A restore that fails outright leaves saving switched off: writing
      // over work this session could not read would be worse than not saving.
      restored = await restoreDocument()
      publishSyncStatus()
      render()
      const error = await acquired.popErrorScope()
      if (disposed || device !== acquired) return
      if (error) throw new Error(error.message)
      // The host may have resized the canvas while validation was pending.
      render()
      publish({ status: "ready" })
      if (cloudBehind && restored)
        void fullyLoaded.then(() => {
          if (!disposed && device === acquired) flushScheduler?.flushNow()
        })
      // Input is attached only once there is something to draw into.
      if (!detachSampler && canvas instanceof HTMLCanvasElement) {
        detachSampler = attachPointerSampler(
          canvas,
          samples,
          {
            begin: beginStroke,
            end: endStroke,
            modifiers: (shift, alt, ctrl) => {
              shiftHeld = shift
              altHeld = alt
              ctrlHeld = ctrl
              if (!shift) shiftLatched = false
            },
            // A colour that could not be read is a colour the artist did not
            // get. It says so and leaves the session standing: the eyedropper
            // touches no pixel of the artwork, so nothing it fails at is work.
            sample: (x, y) => {
              void sampleColor(x, y).catch(() => {
                publish({
                  problem: {
                    action: "retry",
                    message: "That colour could not be read. Try again.",
                  },
                })
              })
            },
          },
          {
            pressureCurve: () => pressureCurve,
            tiltEnabled: () => tiltEnabled,
            // With a selection tool, Alt/Option subtracts (09) rather than
            // sampling.
            altSamples: () => !isSelectionTool(tool) && !isVectorTool(tool),
          }
        )
        // Navigation is input too, and it belongs to the same canvas. Holding
        // it here rather than in the host is what keeps the pen, the present
        // pass and the snapshot agreeing about where the canvas is (D28).
        detachGestures = attachViewGestures(canvas, {
          pan: (dx, dy) =>
            setView(panView(view, toBackingX(dx), toBackingY(dy))),
          zoom: (factor, anchor) =>
            setView(
              zoomView(view, factor, {
                anchor: { x: toBackingX(anchor.x), y: toBackingY(anchor.y) },
                viewport: viewportExtent(),
              })
            ),
          // A twist is continuous: it snaps at the cardinal angles like any
          // other rotation, which is what `rotateView` does by default.
          rotate: (radians) => setView(rotateView(view, radians)),
          cancelStroke,
        })
      }
    } catch (error) {
      fail(error)
    }
  }

  /**
   * The one place the ink changes, whether it came from the picker or from the
   * eyedropper. Painting is premultiplied linear light; the snapshot carries
   * the display-encoded value instead, because that is what a swatch has to
   * paint and what a hex field has to say.
   */
  function setInk(
    working: readonly [number, number, number],
    alpha = 1,
    /**
     * The display-encoded value, when the caller already has an exact one.
     * The eyedropper does: it read those bytes off the canvas, and deriving
     * them back through the matrices would return a colour a hair away from
     * the pixel the artist actually pointed at.
     */
    encoded?: readonly [number, number, number]
  ) {
    // Every colour arriving here is display-referred and therefore in gamut,
    // but the primaries matrices are published rounded to seven decimals, so
    // their rows do not sum to exactly one: white comes back as 1.0000001 in
    // red. Unclamped, that hair trips the renderer's own bounds check and the
    // artist simply cannot pick white — from the picker or the eyedropper.
    const bounded = [0, 1, 2].map((channel) =>
      Math.min(1, Math.max(0, working[channel]))
    ) as [number, number, number]
    ink = [bounded[0] * alpha, bounded[1] * alpha, bounded[2] * alpha, alpha]
    renderer?.setInk(ink)
    // The snapshot reports the ink that was actually taken, not the one asked
    // for, so a swatch and a hex field never describe a colour the brush is
    // not carrying.
    const [red, green, blue] =
      encoded ?? displayTransform(bounded, snapshot.outputColorSpace)
    publish({
      color: Object.freeze({
        red,
        green,
        blue,
        alpha,
        colorSpace: snapshot.outputColorSpace,
        hex: workingToHex(bounded),
      }),
    })
    applySelectedStyle(snapshot.color.hex)
  }

  /**
   * Reads one presented pixel. Eyedropping is an explicit interaction, so its
   * one-pixel asynchronous readback is outside the frame-critical paint path.
   */
  async function sampleColor(x: number, y: number): Promise<EngineColor> {
    if (snapshot.status !== "ready" || !device)
      throw new Error("The graphics device is not ready.")
    // What is read is the *presented* pixel, so the bounds are the swap
    // chain's and not the document's. Clamping to the document instead lets an
    // origin outside the texture through whenever the artwork is larger than
    // the window it is being viewed in — which is the ordinary case, and which
    // WebGPU answers with a validation error rather than a clamp of its own.
    const presented = viewportExtent()
    const pixelX = Math.min(presented.width - 1, Math.max(0, Math.floor(x)))
    const pixelY = Math.min(presented.height - 1, Math.max(0, Math.floor(y)))
    const acquired = device
    // WebGPU requires 256-byte row alignment even for a single RGBA8 texel.
    const buffer = acquired.createBuffer({
      size: 256,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    // Scoped, so that a readback this function gets wrong is a colour the
    // artist did not get rather than a session they lost: without the scope
    // the validation error reaches `uncapturederror`, which treats every
    // arrival as a dead device and tears the engine down.
    acquired.pushErrorScope("validation")
    try {
      const texture = render()
      const encoder = acquired.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture, origin: { x: pixelX, y: pixelY } },
        { buffer, bytesPerRow: 256 },
        { width: 1, height: 1 }
      )
      acquired.queue.submit([encoder.finish()])
      await buffer.mapAsync(GPUMapMode.READ)
      const mapped = new Uint8Array(buffer.getMappedRange(), 0, 4)
      const red = (format === "bgra8unorm" ? mapped[2] : mapped[0]) / 255
      const green = mapped[1] / 255
      const blue = (format === "bgra8unorm" ? mapped[0] : mapped[2]) / 255
      const alpha = mapped[3] / 255
      const decoded = [red, green, blue].map(decodeTransfer) as [
        number,
        number,
        number,
      ]
      const working =
        snapshot.outputColorSpace === "srgb" ? srgbToWorking(decoded) : decoded
      setInk(working, alpha, [red, green, blue])
      return snapshot.color
    } finally {
      buffer.destroy()
      const invalid = await acquired.popErrorScope()
      if (invalid && !disposed && device === acquired)
        throw new Error(invalid.message)
    }
  }

  /**
   * The artwork as pixels, rendered into a target of its own. Not gated on
   * the engine being ready, because a disposed engine still captures the
   * preview of its last flush before its device goes (see `dispose`).
   */
  async function capturePixels(): Promise<RenderedPixels> {
    if (!device) throw new Error("The graphics device is not ready.")
    const { width, height } = snapshot
    const acquired = device
    const bytesPerRow = Math.ceil((width * 4) / 256) * 256
    const buffer = acquired.createBuffer({
      size: bytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
    const output = acquired.createTexture({
      size: { width, height },
      format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    try {
      // The artwork is what was painted, not how it is being looked at, so
      // it is drawn at its own size rather than through the view (D28), into
      // a target of its own: the visible swap-chain frame is never replaced
      // while its asynchronous readback completes. A layer picked out in the
      // list is how it is being looked at too, so it is drawn without that.
      renderer?.renderArtwork(
        output.createView(),
        highlight && doc ? planComposite(doc) : undefined
      )
      const encoder = acquired.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture: output },
        { buffer, bytesPerRow },
        { width, height }
      )
      acquired.queue.submit([encoder.finish()])
      await buffer.mapAsync(GPUMapMode.READ)
      const mapped = new Uint8Array(buffer.getMappedRange())
      const data = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++) {
        data.set(
          mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
          y * width * 4
        )
        if (y % 32 === 31)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      if (format === "bgra8unorm") {
        for (let y = 0; y < height; y++) {
          const end = (y + 1) * width * 4
          for (let i = y * width * 4; i < end; i += 4)
            [data[i], data[i + 2]] = [data[i + 2], data[i]]
          if (y % 32 === 31)
            await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      }
      return { width, height, data, colorSpace: snapshot.outputColorSpace }
    } finally {
      buffer.destroy()
      output.destroy()
    }
  }

  const engine: Engine = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async dispatch(command) {
      if (disposed) return
      landLiftedStroke()
      landEndedShapeDrag()
      if (filterSession && !FILTER_PASSTHROUGH.has(command.type)) cancelFilter()
      switch (command.type) {
        case "initialize":
          if (snapshot.status === "ready") return
          await startInitialization()
          break
        case "resize":
          if (
            ![command.width, command.height, command.devicePixelRatio].every(
              Number.isFinite
            ) ||
            command.width < 0 ||
            command.height < 0 ||
            command.devicePixelRatio <= 0
          ) {
            throw new Error(
              "Viewport dimensions must be non-negative and density must be positive and finite."
            )
          }
          viewport = command
          try {
            resize()
            if (snapshot.status === "ready") render()
          } catch (error) {
            fail(error)
          }
          break
        case "setBrush": {
          const wanted = [command.tipTextureId, command.grain?.textureId]
          if (
            brushTurn ||
            (options.resolveTexture &&
              wanted.some((id) => id && !textures.get(id)))
          ) {
            const turn = (brushTurn ?? Promise.resolve()).then(() =>
              resolveBrushTextures(wanted)
            )
            const settled = turn.catch(() => {})
            brushTurn = settled
            try {
              await turn
            } finally {
              if (brushTurn === settled) brushTurn = undefined
            }
            if (disposed) return
          }
          for (const value of [command.opacity, command.flow])
            if (
              value !== undefined &&
              (!Number.isFinite(value) || value < 0 || value > 1)
            )
              throw new Error(
                "Brush opacity and flow must be finite values in [0, 1]."
              )
          for (const value of [command.radius, command.spacing])
            if (value !== undefined && (!Number.isFinite(value) || value <= 0))
              throw new Error("Brush radius and spacing must be positive.")
          // Zero is a hard edge, which is a brush an artist may well want, so
          // feather is the one width here that is allowed to be nothing.
          if (
            command.feather !== undefined &&
            (!Number.isFinite(command.feather) || command.feather < 0)
          )
            throw new Error("Brush feather must be zero or more.")
          if (
            command.roundness !== undefined &&
            (!Number.isFinite(command.roundness) ||
              command.roundness <= 0 ||
              command.roundness > 1)
          )
            throw new Error("Brush roundness must be in (0, 1].")
          if (command.angle !== undefined && !Number.isFinite(command.angle))
            throw new Error("Brush angle must be finite.")
          if (command.dynamics) validateDynamics(command.dynamics)
          // Textures are named, not carried, so a name that resolves to
          // nothing is caught here rather than silently drawing untextured.
          if (command.tipTextureId && !textures.get(command.tipTextureId))
            throw new Error(
              `No texture is registered as ${command.tipTextureId}.`
            )
          if (command.grain) {
            validateGrain(command.grain)
            if (!textures.get(command.grain.textureId))
              throw new Error(
                `No texture is registered as ${command.grain.textureId}.`
              )
          }
          const grain =
            command.grain === undefined
              ? brush.grain
              : (command.grain ?? undefined)
          if (command.id !== undefined && !command.id)
            throw new Error("A brush id must not be empty.")
          const next: Brush = {
            ...brush,
            id: command.id ?? brush.id,
            name: command.name ?? brush.name,
            shape: {
              ...brush.shape,
              radius: command.radius ?? brush.shape.radius,
              feather: command.feather ?? brush.shape.feather,
              spacing: command.spacing ?? brush.shape.spacing,
              roundness: command.roundness ?? brush.shape.roundness,
              angle: command.angle ?? brush.shape.angle,
            },
            rendering: {
              accumulation:
                command.accumulation ?? brush.rendering.accumulation,
              opacity: command.opacity ?? brush.rendering.opacity,
              flow: command.flow ?? brush.rendering.flow,
            },
            // Cloned on the way in: the engine owns its brush, and a caller
            // mutating the list it passed must not change a stroke in flight.
            dynamics: command.dynamics
              ? structuredClone(command.dynamics)
              : brush.dynamics,
          }
          // Absent rather than present-and-null — and absent rather than
          // present-and-undefined, which is a key that survives a
          // `structuredClone` into every copy of the brush the snapshot
          // publishes. Both would stop a brush being exactly the JSON it
          // round-trips as (D23).
          const tip =
            command.tipTextureId === undefined
              ? brush.shape.tipTextureId
              : (command.tipTextureId ?? undefined)
          if (tip) next.shape.tipTextureId = tip
          else delete next.shape.tipTextureId
          if (grain) next.grain = { ...grain }
          else delete next.grain
          // Spacing is fixed for the life of a resampler, so a brush that
          // changes it needs a new one. Never mid-stroke: the pen is up.
          if (tool === "brush" && brushSpacing(next) !== brushSpacing(brush))
            resampler = createStrokeResampler(brushSpacing(next))
          brush = next
          applyBrushTextures()
          if (snapshot.status === "ready") render()
          publish({ brush: Object.freeze(cloneBrush(next)) })
          break
        }
        case "registerTexture": {
          if (!command.id) throw new Error("A texture needs an id.")
          // `register` validates the pixels; ids are ours to check. A texture
          // arriving from a file or another machine is input, so it is
          // rejected here rather than at the point a stroke wants it.
          textures.register(command.id, command.texture)
          publish({ textures: Object.freeze(textures.ids()) })
          // The brush in the hand may already name this texture — a document
          // reopened before its assets arrived — so what it draws with is
          // reapplied rather than waiting for the next edit.
          applyBrushTextures()
          break
        }
        case "addLayer": {
          const before = captureStructure(requireDocument())
          addLayer(requireDocument())
          recordOperation("add layer", before)
          applyLayerChange()
          break
        }
        case "addVectorLayer": {
          const before = captureStructure(requireDocument())
          addVectorLayer(requireDocument())
          recordOperation("add vector layer", before)
          applyLayerChange()
          break
        }
        case "closePolygon":
          closePolygon()
          break
        case "finishPenPath":
          if (shapeDrag?.tool === "pen") {
            shapeDrag.ended = true
            shapeDrag.placing = false
            scheduleFrame()
          }
          break
        case "editVectorNode": {
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const { geometry, node } = editNode(
            layer.scene,
            command.objectId,
            command.edit
          )
          editScene(
            layer.id,
            [{ type: "update", id: command.objectId, patch: { geometry } }],
            "edit node"
          )
          publish({ vectorNodes: [node] })
          break
        }
        case "deleteVectorNode": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edit = deleteNodes(layer.scene, snapshot.vectorNodes, {
            refit: command.refit ?? true,
          })
          if (!edit) break
          editScene(layer.id, edit.edits, "delete nodes")
          const removed = new Set(
            edit.edits.flatMap((e) => (e.type === "remove" ? [e.id] : []))
          )
          publish({
            vectorNodes: edit.nodes,
            vectorSelection: snapshot.vectorSelection.filter(
              (id) => !removed.has(id)
            ),
          })
          break
        }
        case "insertVectorNodes": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edit = insertNodes(layer.scene, snapshot.vectorNodes)
          if (!edit) {
            publish({
              problem: { action: "retry", message: CANNOT_INSERT },
            })
            break
          }
          editScene(layer.id, edit.edits, "insert nodes")
          publish({ vectorNodes: edit.nodes, problem: nodeProblemGone() })
          break
        }
        case "breakVectorNodes": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edit = breakNodes(
            layer.scene,
            snapshot.vectorNodes,
            objectIds(layer.scene)
          )
          if (!edit) {
            publish({
              problem: { action: "retry", message: CANNOT_BREAK },
            })
            break
          }
          editScene(layer.id, edit.edits, "break nodes")
          publish({
            vectorNodes: [],
            vectorSelection: [...snapshot.vectorSelection, ...edit.added],
            problem: nodeProblemGone(),
          })
          break
        }
        case "joinVectorNodes": {
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const mode = command.segment ? "segment" : "merge"
          // Picked nodes say which ends only while the node tool is held.
          const ends = joinableEnds(
            layer.scene.objects,
            snapshot.tool === "node" ? snapshot.vectorNodes : [],
            snapshot.vectorSelection,
            mode
          )
          if (!ends) break
          const edit = joinNodes(layer.scene, ends, mode)
          if (!edit) break
          editScene(layer.id, edit.edits, "join nodes")
          publish({
            vectorNodes: edit.nodes,
            vectorSelection: snapshot.vectorSelection.filter(
              (id) => !edit.removed.includes(id)
            ),
          })
          break
        }
        case "deleteVectorSegments": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edit = deleteSegments(
            layer.scene,
            snapshot.vectorNodes,
            objectIds(layer.scene)
          )
          if (!edit) break
          editScene(layer.id, edit.edits, "delete segments")
          publish({
            vectorNodes: [],
            vectorSelection: [
              ...snapshot.vectorSelection.filter(
                (id) => !edit.removed.includes(id)
              ),
              ...edit.added,
            ],
          })
          break
        }
        case "setVectorNodeType": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edit = nodeCommand(
            layer.scene,
            snapshot.vectorNodes,
            command.nodeType
          )
          if (edit) {
            editScene(layer.id, edit.edits, "edit node")
            publish({ vectorNodes: edit.nodes })
          }
          break
        }
        case "setVectorSegmentShape": {
          if (!snapshot.vectorNodes.length) break
          dropShapeDrag()
          const layer = selectedVectorLayer()
          const edits = segmentCommand(
            layer.scene,
            snapshot.vectorNodes,
            command.shape
          )
          if (edits) editScene(layer.id, edits, `make ${command.shape}`)
          break
        }
        case "nudgeVectorNodes": {
          if (tool !== "node" || !snapshot.vectorNodes.length) break
          if (shapeDrag?.node) break
          const layer = selectedVectorLayer()
          const edits = moveNodes(layer.scene, snapshot.vectorNodes, {
            x: command.dx,
            y: command.dy,
          })
          if (!command.repeat) nodeKeyRun++
          editScene(layer.id, edits, "nudge nodes", `nudge-nodes:${nodeKeyRun}`)
          break
        }
        case "transformVectorNodes": {
          if (tool !== "node" || !snapshot.vectorNodes.length) break
          if (shapeDrag?.node) break
          const layer = selectedVectorLayer()
          const edits = transformNodes(
            layer.scene,
            snapshot.vectorNodes,
            command.transform
          )
          // Its own run, so a held scale never joins a nudge before it.
          if (!command.repeat) nodeKeyRun++
          editScene(
            layer.id,
            edits,
            "transform nodes",
            `transform-nodes:${nodeKeyRun}`
          )
          break
        }
        case "stepVectorNode":
          if (tool !== "node") break
          publish({
            vectorNodes: stepNode(
              snapshot.vectorPaths,
              snapshot.vectorNodes,
              command.direction
            ),
          })
          break
        case "editVectorLayer":
          editScene(command.id, command.commands, "edit shapes")
          break
        case "selectVectorObjects": {
          cancelVectorTransform()
          const layer = selectedVectorLayer()
          setVectorSelection(
            layer.scene.objects
              .filter((o) => !o.erase && command.ids.includes(o.id))
              .map((o) => o.id)
          )
          break
        }
        case "selectVectorRegion":
          selectVectorRegion(command.region, command.additive)
          break
        case "deleteVectorObjects":
          cancelVectorTransform()
          editScene(
            selectedVectorLayer().id,
            snapshot.vectorSelection.map((id) => ({ type: "remove", id })),
            "delete objects"
          )
          publish({ vectorSelection: [] })
          break
        case "duplicateVectorObjects": {
          cancelVectorTransform()
          const layer = selectedVectorLayer()
          let scene = layer.scene
          const commands: SceneCommand[] = []
          const ids: string[] = []
          for (const original of layer.scene.objects.filter((o) =>
            snapshot.vectorSelection.includes(o.id)
          )) {
            const id = nextObjectId(scene)
            const [a, b, c, d, e, f] = original.transform
            const add: SceneCommand = {
              type: "add",
              object: {
                ...original,
                id,
                transform: [a, b, c, d, e + 10, f + 10],
              },
            }
            commands.push(add)
            ids.push(id)
            scene = applySceneEdit(scene, [add]).scene
          }
          editScene(layer.id, commands, "duplicate objects")
          publish({ vectorSelection: ids })
          break
        }
        case "reorderVectorObjects": {
          cancelVectorTransform()
          const layer = selectedVectorLayer()
          const chosen = layer.scene.objects.filter((o) =>
            snapshot.vectorSelection.includes(o.id)
          )
          if (command.to === "back") chosen.reverse()
          editScene(
            layer.id,
            chosen.map((o) => ({
              type: "reorder",
              id: o.id,
              index:
                command.to === "front" ? layer.scene.objects.length - 1 : 0,
            })),
            "reorder objects"
          )
          break
        }
        case "beginVectorTransform":
          await beginVectorTransform()
          break
        case "adjustVectorPlacement": {
          const transform = vectorTransform
          if (!transform || !snapshot.vectorTransform)
            throw new Error("No objects are being transformed.")
          const box = transform.box
          const m = affineFromPlacement(command.placement, {
            width: Math.max(1, box.width),
            height: Math.max(1, box.height),
          })
          adjustVectorTransform(
            [
              m[0],
              m[1],
              m[2],
              m[3],
              m[4] - m[0] * box.x - m[2] * box.y,
              m[5] - m[1] * box.x - m[3] * box.y,
            ],
            false
          )
          publish({
            vectorTransform: {
              ...snapshot.vectorTransform,
              placement: command.placement,
            },
          })
          break
        }
        case "adjustVectorTransform":
          adjustVectorTransform(
            command.matrix,
            command.snap ?? snapshot.snapping
          )
          break
        case "commitVectorTransform":
          commitVectorTransform()
          break
        case "cancelVectorTransform":
          cancelVectorTransform()
          break
        case "alignVectorObjects": {
          const document = requireDocument()
          const layer = selectedVectorLayer()
          const box = objectsBounds(layer.scene, snapshot.vectorSelection)
          const within =
            command.to === "canvas"
              ? { x: 0, y: 0, width: document.width, height: document.height }
              : selection?.bounds
          if (!box || !within) break
          await beginVectorTransform()
          const placement = {
            x: box.x + box.width / 2,
            y: box.y + box.height / 2,
            width: box.width,
            height: box.height,
            rotation: 0,
            flipX: false,
            flipY: false,
          }
          const aligned = alignedPlacement(placement, command.anchor, within)
          adjustVectorTransform(
            [1, 0, 0, 1, aligned.x - placement.x, aligned.y - placement.y],
            false
          )
          commitVectorTransform()
          break
        }
        case "setShapeStyle": {
          const width = command.strokeWidth ?? snapshot.shapeStyle.strokeWidth
          if (!Number.isFinite(width) || width <= 0)
            throw new Error("A stroke width must be positive and finite.")
          for (const color of [command.fillColor, command.strokeColor])
            if (color !== undefined && !parseHex(color))
              throw new Error("A shape colour must be hex.")
          if (
            command.strokeCap &&
            !["butt", "round", "square"].includes(command.strokeCap)
          )
            throw new Error("Invalid stroke cap.")
          if (
            command.strokeJoin &&
            !["miter", "round", "bevel"].includes(command.strokeJoin)
          )
            throw new Error("Invalid stroke join.")
          // With objects selected, the options edit them, and what the tool
          // gives a new shape is left as it was.
          if (snapshot.vectorSelection.length) {
            applySelectedStyle(undefined, command)
            break
          }
          publish({
            shapeStyle: Object.freeze({
              fill: command.fill ?? snapshot.shapeStyle.fill,
              stroke: command.stroke ?? snapshot.shapeStyle.stroke,
              strokeWidth: width,
              strokeCap: command.strokeCap ?? snapshot.shapeStyle.strokeCap,
              strokeJoin: command.strokeJoin ?? snapshot.shapeStyle.strokeJoin,
              fillColor: command.fillColor ?? snapshot.shapeStyle.fillColor,
              strokeColor:
                command.strokeColor ?? snapshot.shapeStyle.strokeColor,
            }),
          })
          break
        }
        case "setVectorBrushTaper": {
          const share = (t: number | undefined, was: number) => {
            if (t === undefined) return was
            if (!Number.isFinite(t) || t < 0 || t > MAX_TAPER)
              throw new Error("A taper is a share of the stroke, 0 to 0.5.")
            return t
          }
          const was = snapshot.vectorBrushTaper
          publish({
            vectorBrushTaper: Object.freeze({
              start: share(command.start, was.start),
              end: share(command.end, was.end),
            }),
          })
          break
        }
        case "setVectorBrushPressure":
          publish({ vectorBrushPressure: command.pressure === true })
          break
        case "setVectorEraser":
          if (command.mode !== "pixel" && command.mode !== "object")
            throw new Error("A vector eraser takes pixels or objects.")
          cancelStroke()
          publish({ vectorEraser: command.mode })
          break
        case "placeImage": {
          const document = requireDocument()
          const canvas = { width: document.width, height: document.height }
          // A file keeps its own bytes; loose pixels are encoded into some, so
          // that either way the layer ends up holding an original it can be
          // re-rendered from.
          const file = command.file ?? (await encodeGivenPixels(command.image))
          const asset = await rememberAsset(file)
          const before = captureStructure(document)
          const id = addLayer(document)
          if (command.name) setLayer(document, id, { name: command.name })
          const layer = findRasterLayer(document, id)
          layer.image = true
          const placement = placementFor(command, asset, canvas)
          if (!validPlacement(placement, canvas))
            throw new Error("That is not a placement an image can be put at.")
          layer.placed = { asset: assetRef(asset), placement }
          // Drawn by the renderer, exactly as every later adjustment of it
          // will be. One renderer of placements rather than two: a second one
          // here would resample differently, and cancelling a transform —
          // which redraws the placement the picture was picked up at — would
          // not give back the pixels it started with.
          await drawPlacement(id, asset, placement)
          // Recording reads back what was just drawn and is not waited for:
          // the picture is already on screen, and the step, the thumbnail and
          // the save all follow from the recording in their own time. Undo
          // settles history before it acts, so a step still being recorded
          // cannot be stepped past.
          recordOperation("place image", before, {
            readback: [{ surfaceId: id, region: placementBounds(placement) }],
            canvas,
          })
          applyLayerChange()
          break
        }
        case "beginImageTransform":
          await beginImageTransformOf(command.id)
          break
        case "adjustImageTransform":
          adjustImageTransformTo(command.placement)
          break
        case "commitImageTransform":
          await commitTransform()
          break
        case "cancelImageTransform":
          await cancelTransform()
          break
        case "beginLayerTransform":
          await beginLayerTransformOf(command.id)
          break
        case "adjustLayerTransform":
          adjustLayerTransformTo(command.placement)
          break
        case "commitLayerTransform":
          await commitLayerTransform()
          break
        case "cancelLayerTransform":
          await cancelLayerTransform()
          break
        case "alignLayer":
          await alignLayer(command.id, command.anchor, command.to)
          break
        case "flipLayer": {
          // Mid-transform, a flip is one more adjustment of it.
          if (imageTransform?.layerId === command.id) {
            adjustImageTransformTo(
              flippedPlacement(imageTransform.placement, command.axis)
            )
            break
          }
          if (layerTransform?.layerId === command.id) {
            adjustLayerTransformTo(
              flippedPlacement(layerTransform.placement, command.axis)
            )
            break
          }
          await beginLayerTransformOf(command.id)
          const session = layerTransform as typeof layerTransform
          if (!session) break
          adjustLayerTransformTo(
            flippedPlacement(session.placement, command.axis)
          )
          await commitLayerTransform()
          break
        }
        case "addGroup": {
          const before = captureStructure(requireDocument())
          addGroup(requireDocument(), command.ids)
          recordOperation("group layers", before)
          applyLayerChange()
          break
        }
        case "duplicateLayer":
          {
            const document = requireDocument()
            const before = captureStructure(document)
            const source = findLayer(document, command.id)
            const copyId = duplicateLayer(document, command.id)
            const copy = findLayer(document, copyId)
            renderer?.duplicateLayer(command.id, copyId)
            contentBounds.copy(command.id, copyId)
            // The copy's pixels were copied with it, so they are already a
            // drawing of the scene it shares with its source.
            const drawn = drawnScenes.get(command.id)
            if (drawn) {
              drawnScenes.set(copyId, drawn)
              renderer?.setVectorScene(
                copyId,
                vectorDraws(drawn, undefined, screenDetail)
              )
            }
            if (source.mask && copy.mask)
              renderer?.duplicateLayer(source.mask.id, copy.mask.id)
            // The copy's pixels are the source's, so history holds one copy of
            // them however many times a layer is duplicated.
            recordOperation("duplicate layer", before, {
              copied: [
                { from: command.id, to: copyId },
                ...(source.mask && copy.mask
                  ? [{ from: source.mask.id, to: copy.mask.id }]
                  : []),
              ],
              // A copy brought back by redo comes back empty, and is given
              // its objects again.
              ...(copy.kind === "vector" && copy.scene.objects.length
                ? {
                    scenes: [
                      {
                        layerId: copyId,
                        forward: copy.scene.objects.map((object) => ({
                          type: "add" as const,
                          object,
                        })),
                        inverse: [],
                      },
                    ],
                  }
                : {}),
            })
          }
          applyLayerChange()
          break
        case "removeLayer":
          cancelVectorTransform()
          {
            // A picture being moved that is then thrown away: the transform
            // has nowhere to land, and a commit would put the pixels back.
            if (imageTransform?.layerId === command.id) {
              closeTransform(imageTransform)
              imageTransform = undefined
              publish({ imageTransform: null })
            }
            if (layerTransform?.layerId === command.id) abandonLayerTransform()
            const document = requireDocument()
            const before = captureStructure(document)
            const removed = removeLayer(document, command.id)
            const ids = nodeIdsOf(removed)
            // Recorded before the textures go: the pixels themselves are in
            // the tile store, which is what putting the layer back reads from.
            recordOperation("remove layer", before, {
              removed: ids,
              scenes: sceneRemovals(removed),
            })
            for (const id of ids) releaseSurface(id)
          }
          applyLayerChange()
          break
        case "clearDocument": {
          cancelVectorTransform()
          dropShapeDrag()

          if (imageTransform) closeTransform(imageTransform)
          imageTransform = undefined
          publish({ imageTransform: null })
          abandonLayerTransform()
          const previous = requireDocument()
          for (const id of structureSurfaceIds(captureStructure(previous)))
            releaseSurface(id)
          history?.clear()
          doc = createBlankDocument({
            width: previous.width,
            height: previous.height,
          })
          resetSelection()
          // The view is how the artist is looking, not what is on the
          // canvas: clearing the pixels leaves the zoom and pan alone.
          applyLayerChange()
          restored = true
          void persistence?.save()
          committedSinceOpen = true
          flushScheduler?.touch()
          break
        }
        case "selectLayer":
          cancelVectorTransform()
          publish({ vectorSelection: [] })
          selectLayer(requireDocument(), command.id)
          applyLayerChange()
          break
        case "moveLayer": {
          const before = captureStructure(requireDocument())
          moveLayer(
            requireDocument(),
            command.id,
            command.index,
            command.parentId
          )
          recordOperation("move layer", before)
          applyLayerChange()
          break
        }
        case "addMask": {
          const before = captureStructure(requireDocument())
          addMask(requireDocument(), command.id)
          recordOperation("add mask", before)
          applyLayerChange()
          break
        }
        case "selectMask":
          selectMask(requireDocument(), command.id)
          applyLayerChange()
          break
        case "setMaskEnabled": {
          const before = captureStructure(requireDocument())
          setMaskEnabled(requireDocument(), command.id, command.enabled)
          recordOperation("enable mask", before)
          applyLayerChange()
          break
        }
        case "removeMask": {
          const document = requireDocument()
          const before = captureStructure(document)
          const mask = removeMask(document, command.id)
          recordOperation("remove mask", before, { removed: [mask.id] })
          releaseSurface(mask.id)
          applyLayerChange()
          break
        }
        case "beginFilter": {
          const document = requireDocument()
          const layer = findLayer(document, command.id)
          if (layer.kind !== "raster" || layer.locked || layer.image) break
          if (!history?.occupiedTiles(layer.id).length) break
          // The layer's own pixels are what is filtered, so it is made the
          // pen's target: the compositor then reads its surface live, and
          // every preview shows without rebuilding a cache.
          selectLayer(document, layer.id)
          applyLayerChange()
          if (!renderer?.beginFilter(layer.id)) break
          filterSession = {
            layerId: layer.id,
            filter: defaultFilter(command.kind),
          }
          publish({ filter: { ...filterSession } })
          break
        }
        case "previewFilter": {
          if (!filterSession) break
          filterSession.filter = normalizeFilter(command.filter)
          renderer?.previewFilter(filterSession.filter)
          publish({ filter: { ...filterSession } })
          if (snapshot.status === "ready") render()
          break
        }
        case "applyFilter": {
          const session = filterSession
          if (!session) break
          if (isIdentityFilter(session.filter)) {
            cancelFilter()
            break
          }
          filterSession = undefined
          // The preview already is the result: drawn once more so what is
          // kept is these settings even if the last preview was skipped.
          const region = renderer?.previewFilter(session.filter)
          renderer?.endFilter(true)
          publish({ filter: null })
          if (!region) break
          const document = requireDocument()
          recordOperation(
            FILTER_LABELS[session.filter.kind].toLowerCase(),
            captureStructure(document),
            {
              readback: [{ surfaceId: session.layerId, region }],
            }
          )
          await history?.settle()
          invalidateThumbnailsOf(session.layerId)
          applyLayerChange()
          break
        }
        case "cancelFilter":
          cancelFilter()
          break
        case "clearLayer": {
          const document = requireDocument()
          const layer = findLayer(document, command.id)
          if (layer.kind === "vector" && !layer.locked) {
            cancelVectorTransform()
            const ids =
              layer.id === snapshot.activeLayerId
                ? snapshot.vectorSelection
                : []
            editScene(
              layer.id,
              layer.scene.objects
                .filter((o) => !ids.length || ids.includes(o.id))
                .map((o) => ({ type: "remove", id: o.id })),
              "clear objects"
            )
            publish({ vectorSelection: [] })
            break
          }
          // A locked layer is not to be touched, and a placed image's pixels
          // are rendered from its file, so neither is cleared. A vector
          // layer's are drawn from its shapes, which clearing does not (yet)
          // take away.
          if (layer.kind !== "raster" || layer.locked || layer.image) break
          // Clearing nothing is not a step worth undoing.
          if (!history?.occupiedTiles(layer.id).length) break
          if (selection) {
            // With a selection, only what is selected goes (08). The pixels
            // change on the GPU first; the step reads them back against what
            // history still holds, like a stroke.
            const region = renderer?.clearSelected(layer.id)
            if (!region) break
            recordOperation("clear selection", captureStructure(document), {
              readback: [{ surfaceId: layer.id, region }],
            })
            await history.settle()
            invalidateThumbnailsOf(layer.id)
            applyLayerChange()
            break
          }
          // Replacing with no tiles at all is what empty means; the step keeps
          // what was there, so undo puts it back.
          recordOperation("clear layer", captureStructure(document), {
            replaced: [{ surfaceId: layer.id, tiles: [] }],
            canvas: { width: document.width, height: document.height },
          })
          // History empties the GPU tiles from its queue, so the frame that
          // shows the clear has to wait for it or it draws the marks again.
          await history.settle()
          applyLayerChange()
          break
        }
        case "rasteriseLayer": {
          cancelVectorTransform()

          if (shapeDrag?.layerId === command.id) dropShapeDrag()
          const document = requireDocument()
          const layer = findLayer(document, command.id)
          if (layer.kind !== "vector")
            throw new Error(`${layer.name} is not a vector layer.`)
          const before = captureStructure(document)
          // The GPU already holds the scene drawn; that drawing is what the
          // paint layer starts as, read back into history as the step's
          // pixels so it is saved and synced like any paint.
          drawScene(layer.id, layer.scene)
          const drawn = unionOf(layer.scene.objects.map(objectBounds))
          const region =
            drawn &&
            intersectRect(drawn, {
              x: 0,
              y: 0,
              width: document.width,
              height: document.height,
            })
          // Undo brings the vector layer back empty with the tree, then puts
          // its objects back; redo has nothing to do to a scene that is gone.
          const scenes = sceneRemovals(layer)
          rasteriseLayer(document, layer.id)
          drawnScenes.delete(layer.id)
          recordOperation("rasterise layer", before, {
            scenes,
            ...(region ? { readback: [{ surfaceId: layer.id, region }] } : {}),
          })
          await history?.settle()
          invalidateThumbnailsOf(layer.id)
          applyLayerChange()
          break
        }
        case "makeLayerPaintable": {
          // Converting mid-transform keeps what the artist was looking at:
          // the adjustment lands as its own step, and the conversion follows
          // it. The other way round would hand the pen the picture as it was
          // before the move and lose the move with no way back to it.
          if (imageTransform?.layerId === command.id) await commitTransform()
          const document = requireDocument()
          const before = captureStructure(document)
          makeLayerPaintable(document, command.id)
          recordOperation("make image paintable", before)
          applyLayerChange()
          break
        }
        case "setLayer": {
          if (command.locked && vectorTransform?.layerId === command.id)
            cancelVectorTransform()
          const { type: _type, id, ...patch } = command
          const before = captureStructure(requireDocument())
          setLayer(requireDocument(), id, patch)
          // A dragged slider is one act, however many commands it sends, so a
          // run of changes to the same fields of the same layer is one step.
          recordOperation("layer settings", before, {
            coalesceAs: `${id}:${Object.keys(patch).sort().join(",")}`,
          })
          applyLayerChange()
          break
        }
        case "highlightLayer": {
          const next = command.id ?? undefined
          if (next === highlight) break
          highlight = next
          if (!doc) break
          syncComposition()
          if (snapshot.status === "ready") render()
          break
        }
        case "selectShape": {
          const box = {
            x: command.x,
            y: command.y,
            width: command.width,
            height: command.height,
          }
          if (!Object.values(box).every(Number.isFinite))
            throw new Error("A selection must be finite.")
          const document = requireDocument()
          const shape =
            command.shape === "rect"
              ? rectSelection(document, box)
              : ellipseSelection(document, box)
          const mask = combineSelections(
            document,
            selection,
            shape,
            command.mode ?? "replace"
          )
          commitSelection(mask ? "select" : "deselect", mask)
          break
        }
        case "selectLasso": {
          if (
            !command.points.every(
              (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
            )
          )
            throw new Error("A selection must be finite.")
          const document = requireDocument()
          const mask = combineSelections(
            document,
            selection,
            lassoSelection(document, command.points),
            command.mode ?? "replace"
          )
          commitSelection(mask ? "select" : "deselect", mask)
          break
        }
        case "selectWand": {
          if (!Number.isFinite(command.x) || !Number.isFinite(command.y))
            throw new Error("A selection must be finite.")
          if (snapshot.status !== "ready")
            throw new Error("The graphics device is not ready.")
          await selectWand(
            { x: command.x, y: command.y },
            command.mode ?? "replace"
          )
          break
        }
        case "setWandOptions": {
          const tolerance = command.tolerance ?? wand.tolerance
          if (!Number.isFinite(tolerance))
            throw new Error("A tolerance must be finite.")
          const sample = command.sample ?? wand.sample
          if (sample !== "layer" && sample !== "composite")
            throw new Error(`Not a wand sample: ${sample}`)
          wand = Object.freeze({
            tolerance: Math.round(Math.min(255, Math.max(0, tolerance))),
            sample,
          })
          publish({ wand })
          break
        }
        case "selectAll":
          // With the node tool, every node of the paths being edited.
          if (tool === "node" && snapshot.vectorPaths.length) {
            publish({ vectorNodes: allNodes(snapshot.vectorPaths) })
            break
          }
          commitSelection("select all", selectAll(requireDocument()))
          break
        case "abandonSelectionGesture":
          // The node tool lets go of its nodes first, then of the paths.
          if (tool === "node" && snapshot.vectorNodes.length) {
            dropShapeDrag()
            publish({ vectorNodes: [] })
            break
          }
          dropShapeDrag()
          cancelVectorTransform()
          publish({ vectorSelection: [] })
          dropMarquee()
          break
        case "deselect":
          requireDocument()
          commitSelection("deselect", null)
          break
        case "invertSelection":
          commitSelection(
            "invert selection",
            invertSelection(requireDocument(), selection)
          )
          break
        case "featherSelection": {
          if (!Number.isFinite(command.radius) || command.radius < 0)
            throw new Error("A feather radius must be finite and not negative.")
          const document = requireDocument()
          if (!selection) break
          // A feather that would leave nothing selected is not taken: the
          // artist asked for softer edges, not for the selection to go.
          const mask = featherSelection(document, selection, command.radius)
          if (mask) commitSelection("feather selection", mask)
          break
        }
        case "moveSelection": {
          if (!Number.isFinite(command.dx) || !Number.isFinite(command.dy))
            throw new Error("A selection can only be moved by a finite offset.")
          const document = requireDocument()
          if (!selection) break
          const mask = translateSelection(
            document,
            selection,
            command.dx,
            command.dy
          )
          commitSelection(mask ? "move selection" : "deselect", mask)
          break
        }
        case "copySelectionToLayer": {
          const document = requireDocument()
          // A group has no pixels of its own to copy, and a mask being
          // painted is not a layer's picture.
          if (
            !selection ||
            document.paintingMask ||
            findNodeIn(document.layers, document.activeLayerId)?.kind !==
              "raster"
          )
            break
          const source = activeLayer(document)
          const sourceId = source.id
          const before = captureStructure(document)
          const copyId = addLayer(document)
          setLayer(document, copyId, { name: `${source.name} copy` })
          // The layer reaches the GPU before its pixels are drawn into it.
          uploadLayers()
          const region = renderer?.copySelected(sourceId, copyId) ?? null
          recordOperation(
            "copy to layer",
            before,
            region ? { readback: [{ surfaceId: copyId, region }] } : undefined
          )
          if (region) {
            contentBounds.grow(copyId, region)
            await history?.settle()
            invalidateThumbnailsOf(copyId)
          }
          applyLayerChange()
          break
        }
        case "undo":
        case "redo": {
          if (vectorTransform) {
            cancelVectorTransform()
            break
          }
          if (!history) break
          // See `publishHistory`: only the revert itself may undo a trial.
          if (restoreRevertible() && !revertingRestore) break
          // Undo with an outline half drawn takes back the outline, not the
          // selection step beneath it.
          if (marquee) {
            if (command.type === "undo") dropMarquee()
            break
          }
          if (shapeDrag) {
            if (command.type === "undo") dropShapeDrag()
            break
          }
          // Undo during a drag means the adjustment being made, not the step
          // underneath it: the picture goes back to where it was picked up
          // and the stack is left alone.
          if (imageTransform) {
            await cancelTransform()
            break
          }
          if (layerTransform) {
            await cancelLayerTransform()
            break
          }
          const document = requireDocument()
          const previous = structureSurfaceIds(captureStructure(document))
          let restoredSelection: string | null | undefined
          const applied = await history[command.type](
            (structure) => {
              restoredSelection = structure.selection
              restoreStructure(document, structure)
              // Uploaded before the entry's tiles are written, so a layer that
              // came back cannot have its restored pixels overwritten by the
              // sparse surface it was originally seeded from.
              uploadLayers()
            },
            (changes, direction) =>
              applySceneChanges(document, changes, direction)
          )
          if (!applied) break
          const remaining = structureSurfaceIds(captureStructure(document))
          for (const id of previous) if (!remaining.has(id)) releaseSurface(id)
          if (restoredSelection !== undefined) {
            selectionKey = restoredSelection
            showSelection(
              restoredSelection === null
                ? null
                : (selections.get(restoredSelection) ?? null)
            )
          }
          applyLayerChange()
          break
        }
        case "panView":
          if (![command.dx, command.dy].every(Number.isFinite))
            throw new Error("Pan must be finite.")
          setView(panView(view, toBackingX(command.dx), toBackingY(command.dy)))
          break
        case "zoomView": {
          const anchor = command.anchor
          if (anchor && ![anchor.x, anchor.y].every(Number.isFinite))
            throw new Error("A zoom anchor must be finite.")
          setView(
            zoomView(
              view,
              command.factor,
              anchor
                ? {
                    anchor: {
                      x: toBackingX(anchor.x),
                      y: toBackingY(anchor.y),
                    },
                    viewport: viewportExtent(),
                  }
                : undefined
            )
          )
          break
        }
        case "rotateView":
          setView(
            rotateView(view, command.radians, {
              absolute: command.absolute,
              snap: command.snap,
            })
          )
          break
        case "flipView":
          setView(flipView(view))
          break
        case "fitView": {
          setView(
            fitCanvasView(
              view,
              extent(),
              viewportExtent(),
              backingOcclusion(command.occludedRight)
            )
          )
          break
        }
        case "resetView": {
          // Square is zoom 1, so the only thing reset has to decide is where
          // the middle is — and a covered strip moves it.
          const hidden = backingOcclusion(command.occludedRight)
          setView({ ...DEFAULT_VIEW, panX: hidden ? -hidden / 2 : 0 })
          break
        }
        case "setPressureCurve": {
          const next = command.curve ?? DEFAULT_PRESSURE_CURVE
          validatePressureCurve(next)
          pressureCurve = next
          publish({ pressureCurve: Object.freeze(next.map((p) => ({ ...p }))) })
          break
        }
        case "addGuide": {
          const document = requireDocument()
          const before = captureStructure(document)
          document.guides = addGuide(
            document.guides,
            command.axis,
            command.position
          ).guides
          recordOperation("add guide", before)
          publish(describeLayers(document))
          break
        }
        case "moveGuide": {
          const document = requireDocument()
          const guide = document.guides.find((g) => g.id === command.id)
          if (!guide)
            throw new Error(`No guide ${command.id} is in this document.`)
          // Put down where it was picked up is not a step.
          if (guide.position === command.position) break
          const before = captureStructure(document)
          document.guides = moveGuide(
            document.guides,
            command.id,
            command.position
          )
          recordOperation("move guide", before)
          publish(describeLayers(document))
          break
        }
        case "removeGuide": {
          const document = requireDocument()
          const next = removeGuide(document.guides, command.id)
          // Nothing to take away is not a step.
          if (next.length === document.guides.length) break
          const before = captureStructure(document)
          document.guides = next
          recordOperation("remove guide", before)
          publish(describeLayers(document))
          break
        }
        case "clearGuides": {
          const document = requireDocument()
          if (document.guides.length === 0) break
          const before = captureStructure(document)
          document.guides = []
          recordOperation("clear guides", before)
          publish(describeLayers(document))
          break
        }
        case "setGuidesVisible":
          guidesVisible = command.visible !== false
          publish({ guidesVisible })
          break
        case "setRulersVisible":
          publish({ rulersVisible: command.visible !== false })
          break
        case "setRasterMagnification": {
          if (!RASTER_MAGNIFICATIONS.includes(command.mode))
            throw new Error(`Unknown raster magnification: ${command.mode}`)
          renderer?.setRasterMagnification(command.mode)
          publish({ rasterMagnification: command.mode })
          if (snapshot.status === "ready") render()
          break
        }
        case "setStraightEdge": {
          const edge = command.edge
          if (
            edge &&
            ![edge.x, edge.y, edge.angle].every((value) =>
              Number.isFinite(value)
            )
          )
            throw new Error("A straight-edge must sit at a finite place.")
          straightEdge = edge
            ? Object.freeze({ x: edge.x, y: edge.y, angle: edge.angle })
            : null
          publish({ straightEdge })
          break
        }
        case "setSnapping":
          snapping = command.enabled !== false
          publish({ snapping })
          break
        case "setTiltEnabled": {
          tiltEnabled = command.enabled !== false
          publish({ tiltEnabled })
          break
        }
        case "setStabilization": {
          if (!Number.isFinite(command.strength))
            throw new Error("Stabilization strength must be finite.")
          stabilizer.setStrength(command.strength)
          publish({ stabilization: stabilizer.strength() })
          break
        }
        case "setEraser": {
          const next = eraserBrush(
            command.kind ??
              (eraser.id === "eraser:pressure" ? "pressure" : "solid"),
            command.radius ?? eraser.shape.radius,
            command.opacity ?? eraser.rendering.opacity
          )
          cancelStroke()
          eraser = next
          if (tool === "eraser") {
            resampler = createStrokeResampler(brushSpacing(eraser))
            applyBrushTextures()
          }
          if (snapshot.status === "ready") render()
          publish({ eraser: Object.freeze(cloneBrush(eraser)) })
          break
        }
        case "setTool":
          // A polygon clicked out far enough to be a shape is kept, not lost
          // with the tool; anything less is dropped with it.
          closePolygon()
          cancelStroke()
          // A lasso polygon half clicked out is dropped with the tool.
          dropMarquee()
          cancelVectorTransform()
          tool = command.tool
          resampler = createStrokeResampler(brushSpacing(activeBrush()))
          applyBrushTextures()
          if (snapshot.status === "ready") render()
          // A stroke left selected as it was drawn is let go with the tool
          // that drew it, so the next tool's options are its own; only the
          // tools that work on selected objects keep hold of them.
          publish(
            tool === "objectSelect" || tool === "node"
              ? { tool }
              : { tool, vectorSelection: [] }
          )
          break
        case "setColor": {
          if (!parseHex(command.hex))
            throw new Error(`Not a colour: ${command.hex}`)
          setInk(hexToWorking(command.hex))
          break
        }
      }
    },
    observeVectorControls(observer) {
      vectorControlObservers.add(observer)
      notifyVectorControls()
      return () => {
        vectorControlObservers.delete(observer)
      }
    },
    observeFrames(observer) {
      frameObserver = observer
    },
    async save() {
      // The same gate the commit hook uses: a session that could not read the
      // stored document does not get to write over it, however it is asked.
      // Nor does a preview that has not been kept.
      if (!restored || restoreOnTrial()) return

      await history?.settle()
      await persistence?.save()
      // A document still loading would sync without its unloaded tiles; the
      // sync is owed instead, and sent once they are all in.
      if (snapshot.loading) {
        unsyncedWhileLoading = true
        return
      }
      if (cloudSync) {
        flushScheduler?.flushNow()
        await cloudSync.settle()
      }
    },
    async restorePoints() {
      const remote = options.cloud?.remote
      return (await remote?.listVersions()) ?? []
    },
    async restoreVersion(versionId) {
      const remote = options.cloud?.remote
      const past = history
      const store = documents
      // The same gate `save` uses: a session that may not write over the
      // stored document may not rewrite it from its own past either.
      if (!restored || !remote || !past || !store) return false
      const document = requireDocument()

      const version = await remote.versionSnapshot(versionId)
      const texels = await loadVersionTiles({
        remote,
        local: store,
        hashes: version.tiles.map((tile) => tile.hash),
      })
      if (disposed) return false

      const bySurface = new Map<
        string,
        (TileCoord & { texels: Uint16Array })[]
      >()
      for (const tile of version.tiles) {
        // A tile neither held nor downloadable is a hole in the restored
        // state, not a failed restore (see `loadVersionTiles`).
        const pixels = texels.get(tile.hash)
        if (!pixels) continue
        const list = bySurface.get(tile.surfaceId) ?? []
        list.push({ x: tile.x, y: tile.y, texels: pixels })
        bySurface.set(tile.surfaceId, list)
      }

      const before = captureStructure(document)
      const previous = structureSurfaceIds(before)
      const replacement = [...bySurface].map(([surfaceId, tiles]) => ({
        surfaceId,
        tiles,
      }))
      // A restore point flushed with pixels its tree does not name brings
      // them back on a layer of their own, as reopening the document would.
      const structure = adoptStrandedSurfaces(version.structure, replacement)
      // Layers the version had that this session does not must exist before
      // their pixels are written, and their ids must not be handed out again.
      reserveIds(structureSurfaceIds(structure))
      restoreStructure(document, structure)
      // Uploaded before the replacement's tiles land, for the same reason undo
      // does it: a layer that came back must not have its restored pixels
      // overwritten by the sparse surface it was seeded from.
      uploadLayers()

      applyingRestore = true
      past.recordReplacement(
        "restore",
        { before, after: structure },
        replacement,
        { width: snapshot.width, height: snapshot.height }
      )
      try {
        await past.settle()
      } finally {
        applyingRestore = false
      }
      if (disposed) return false

      const remaining = structureSurfaceIds(captureStructure(document))
      for (const id of previous) if (!remaining.has(id)) releaseSurface(id)
      applyLayerChange()
      restoreStep = past.topStep()
      publishHistory()
      return true
    },
    canRevertRestore: restoreRevertible,
    async keepRestore() {
      // Ended first, because a save refuses while one is on trial; put back
      // if the save throws, so the preview is still one to keep or take back.
      const step = restoreStep
      restoreStep = undefined
      publishHistory()
      try {
        await this.save()
      } catch (error) {
        restoreStep = step
        publishHistory()
        throw error
      }
      // A failed upload does not throw — it is reported, and retried by the
      // next flush — so whether this reached the cloud is read back instead.
      return { synced: !cloudSync || cloudSync.status() === "fully-synced" }
    },
    async revertRestore() {
      if (!this.canRevertRestore()) return false
      revertingRestore = true
      try {
        await this.dispatch({ type: "undo" })
      } finally {
        revertingRestore = false
      }
      restoreStep = undefined
      publishHistory()
      return true
    },
    cloudMetrics: () => cloudSync?.metrics() ?? null,
    historyUsage: () => ({
      steps: history?.stepsBack() ?? 0,
      heldBytes: history?.bytes() ?? 0,
      residentBytes: history?.residentBytes() ?? 0,
      spilledBytes: history?.spilledBytes() ?? 0,
    }),
    async readPixels() {
      if (snapshot.status !== "ready")
        throw new Error("The graphics device is not ready.")
      return await capturePixels()
    },
    async readSelection() {
      if (snapshot.status !== "ready" || !renderer)
        throw new Error("The graphics device is not ready.")
      const data = await renderer.readSelection()
      return data
        ? { width: snapshot.width, height: snapshot.height, data }
        : null
    },
    async exportSvg(options) {
      if (snapshot.status !== "ready" || !history)
        throw new Error("The graphics device is not ready.")
      const past = history
      await past.settle()
      const document = requireDocument()
      // Freeze settings before PNG encoding yields to further edits.
      const copyNodes = (nodes: readonly LayerNode[]): LayerNode[] =>
        nodes.map((node) => {
          const mask = node.mask ? { ...node.mask } : undefined
          return node.kind === "group"
            ? { ...node, mask, children: copyNodes(node.children) }
            : { ...node, mask }
        })
      const captured = { ...document, layers: copyNodes(document.layers) }
      const surfaces = new Map(
        past.tileIndex().map((surface) => [surface.surfaceId, surface])
      )
      const images = new Map<string, string>()
      const prepare = async (nodes: readonly LayerNode[]): Promise<void> => {
        for (const node of nodes) {
          if (node.kind === "group") await prepare(node.children)
          if (node.kind === "raster" && options.raster === "embed")
            images.set(
              node.id,
              await svgPngImage(
                captured,
                surfaces.get(node.id),
                (hash) => past.store.get(hash),
                false
              )
            )
          if (node.mask?.enabled)
            images.set(
              node.mask.id,
              await svgPngImage(
                captured,
                surfaces.get(node.mask.id),
                (hash) => past.store.get(hash),
                true
              )
            )
        }
      }
      await prepare(captured.layers)
      return serializeSvg(captured, options, images)
    },
    async exportDocument() {
      if (snapshot.status !== "ready" || !history)
        throw new Error("The graphics device is not ready.")
      await history.settle()
      const surfaces = history.tileIndex()
      const exported = savedStructure(
        captureStructure(requireDocument(), { scenes: true }),
        surfaces
      )
      const manifest = {
        version: 1 as const,
        id: options.persistence?.documentId ?? "exported-document",
        name: "Untitled",
        width: snapshot.width,
        height: snapshot.height,
        structure: exported,
        surfaces,
        assets: structureAssets(exported),
        updatedAt: Date.now(),
      }
      return encodeVeluraFile(
        manifest,
        (hash) => history!.store.get(hash),
        async (id) => assetFor(id).bytes
      )
    },
    async importDocument(bytes) {
      if (snapshot.status !== "ready" || !renderer || !history)
        throw new Error("The graphics device is not ready.")
      const imported = await decodeVeluraFile(bytes)
      validateDocumentSize(imported.manifest)
      if (disposed) return
      const previous = doc
      if (!previous) throw new Error("The graphics device is not ready.")
      for (const id of structureSurfaceIds(captureStructure(previous)))
        releaseSurface(id)
      history.clear()
      doc = createDocument({
        width: imported.manifest.width,
        height: imported.manifest.height,
      })
      for (const id of structureSurfaceIds(captureStructure(doc)))
        releaseSurface(id)
      const structure = adoptStrandedSurfaces(
        imported.manifest.structure,
        imported.manifest.surfaces
      )
      reserveIds(structureSurfaceIds(structure))
      restoreStructure(doc, structure)
      // The originals travel in the backup, so an imported document's
      // pictures can be moved exactly as they could in the one exported.
      for (const ref of structureAssets(structure)) {
        const bytes = imported.assets.get(ref.id)
        if (bytes) assets.set(ref.id, Object.freeze({ ...ref, bytes }))
      }
      renderer.resize(imported.manifest.width, imported.manifest.height)
      drawnScenes.clear()
      const size = {
        width: imported.manifest.width,
        height: imported.manifest.height,
      }
      for (const surface of imported.manifest.surfaces) {
        const tiles = surface.tiles.map((ref) => ({
          x: ref.x,
          y: ref.y,
          texels: imported.tiles.get(ref.hash)!,
        }))
        renderer.writeTiles(surface.surfaceId, tiles)
        history.recordUpload(surface.surfaceId, tiles, size)
      }
      await history.settle()
      uploadLayers()
      syncComposition()
      view = DEFAULT_VIEW
      resetSelection()
      publish({
        width: imported.manifest.width,
        height: imported.manifest.height,
        view,
        ...describeLayers(doc),
      })
      applyView()
      render()
      restored = true
      await persistence?.save()
      if (cloudSync) {
        flushScheduler?.flushNow()
        await cloudSync.settle()
      }
    },
    sampleColor,
    attachThumbnail(id, canvas, onDrawn) {
      const view: ThumbnailView = { canvas, onDrawn }
      const views = thumbnailViews.get(id) ?? new Set()
      views.add(view)
      thumbnailViews.set(id, views)
      // A canvas that has just appeared is drawn now, unless the pen is down:
      // a preview that waited out the quiet window would open blank.
      if (stroking || opening) thumbnails.invalidate([id])
      else drawThumbnail(id, view)
      return () => {
        views.delete(view)
        if (views.size === 0) thumbnailViews.delete(id)
        view.context?.unconfigure()
      }
    },
    dispose() {
      if (disposed) return
      cancelVectorTransform()
      disposed = true
      stopSelection()
      thumbnails.dispose()
      thumbnailViews.clear()
      // A picture still held open by a transform that was never finished.
      if (imageTransform) closeTransform(imageTransform)
      imageTransform = undefined
      if (layerTransform)
        renderer?.closePlacedImage(layerImageId(layerTransform.layerId))
      layerTransform = undefined
      detachSampler?.()
      detachSampler = undefined
      detachGestures?.()
      detachGestures = undefined
      // A disposed engine has no frames to report, and holding the observer
      // would keep whatever it closes over alive with it.
      frameObserver = null
      // Leaving the canvas through the app is an unmount, not a pagehide: it
      // would otherwise cancel the idle flush that had not fired yet, or tear
      // the device out from under one mid-preview, leaving the cloud without
      // the latest strokes and the library without a picture of them. The
      // runtime is kept just long enough to finish that flush; nothing is
      // shown from it meanwhile, and the canvas is free for another engine.
      const sync = cloudSync
      const unsent =
        sync &&
        (sync.status() === "syncing" ||
          (committedSinceOpen && sync.status() !== "fully-synced"))
      if (
        restored &&
        sync &&
        unsent &&
        !restoreOnTrial() &&
        !snapshot.loading
      ) {
        if (frame !== undefined) cancelAnimationFrame(frame)
        frame = undefined
        context?.unconfigure()
        context = null
        void (async () => {
          await history?.settle()
          flushScheduler?.flushNow()
          await sync.settle()
        })().finally(release)
      } else release()
      publish({ status: "disposed" })
      vectorControlObservers.clear()
      listeners.clear()
    },
  }
  return engine
}
