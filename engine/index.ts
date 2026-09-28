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
  type OutputColorSpace,
  srgbToWorking,
} from "./color/display-transform"
import { hexToWorking, parseHex, workingToHex } from "./color/oklch"
import {
  activeLayer,
  addGroup,
  addLayer,
  addMask,
  createDocument,
  createBlankDocument,
  duplicateLayer,
  findLayer,
  type Layer,
  type LayerGroup,
  type LayerMask,
  type LayerNode,
  type LayerPatch,
  moveLayer,
  findNodeIn,
  groupContents,
  rasterLayers,
  makeLayerPaintable,
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
  type DocumentStructure,
  type NodeStructure,
  restoreStructure,
  savedStructure,
  structureAssets,
  structureSurfaceIds,
} from "./doc/structure"
import {
  centeredPlacement,
  type ImagePlacement,
  placementBounds,
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
  tileIndexForPixel,
  tileKey,
  unionRect,
} from "./doc/tile-grid"
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
import { createStrokeResampler } from "./geom/path"
import { createStabilizer } from "./geom/stabilizer"
import {
  createRenderer,
  MAX_STAMPS_PER_DRAW,
  type Renderer,
  type ThumbnailSubject,
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
  lassoSelection,
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
  screenToDoc,
  type ViewMatrix,
  zoomView,
} from "./view/view-transform"

export {
  docToScreen,
  invertMatrix,
  MAX_ZOOM,
  MIN_ZOOM,
  type ViewMatrix,
} from "./view/view-transform"
export { blendModes, type BlendMode } from "./shaders/blend-modes"
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

export type PaintTool = "brush" | "eraser"
/** Tools that draw out a selection (07) instead of making a mark. */
const SELECTION_TOOLS = [
  "rectSelect",
  "ellipseSelect",
  "lasso",
  "polygonLasso",
] as const
export type SelectionTool = (typeof SELECTION_TOOLS)[number]

export type { SelectionMode }

export const isSelectionTool = (tool: Tool): tool is SelectionTool =>
  (SELECTION_TOOLS as readonly Tool[]).includes(tool)
export type Tool = PaintTool | SelectionTool

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
  | { type: "selectAll" }
  | { type: "deselect" }
  /** Selects what was not selected; with nothing selected, everything. */
  | { type: "invertSelection" }
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
  /** The persistent tool in the hand; Alt/Option sampling never changes it. */
  tool: Tool
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
   * The document's selection (07), or null when nothing is selected. It
   * belongs to the document, not a layer, so it stays as layers are switched.
   */
  selection: SelectionSummary | null
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
}>

export type MaskSummary = Readonly<Omit<LayerMask, "surface">>
export type RasterLayerSummary = Readonly<
  Omit<Layer, "surface" | "mask"> & { mask?: MaskSummary }
>
export type GroupSummary = Readonly<
  Omit<LayerGroup, "children" | "mask"> & {
    mask?: MaskSummary
    children: readonly LayerSummary[]
  }
>
/** The recursive tree as the UI sees it: settings, never pixels. */
export type LayerSummary = RasterLayerSummary | GroupSummary

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
  tool: "brush",
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
  selection: null,
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
  } = {}
): Engine {
  let snapshot: EngineSnapshot = INITIAL_SNAPSHOT
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
        /** The original, decoded once for the whole drag (06). */
        open: OpenImage
        /** The tree before the transform, which is the step's "before". */
        structure: DocumentStructure
        /**
         * Everything the picture has covered since it was picked up, which is
         * the region the commit reads back: where it now is, and everywhere
         * it has been and left.
         */
        touched: PixelRect
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
  // The pen response curve is engine state rather than a sampler argument: it
  // outlives any one attachment, and the sampler reads it back per sample.
  let pressureCurve: Curve = DEFAULT_PRESSURE_CURVE
  // On unless the artist says otherwise: a pen that reports tilt should use
  // it, and a pen that does not already reads as upright.
  let tiltEnabled = true
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
      const layers =
        node.kind === "group" ? rasterLayers(node.children) : [node]
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
     * What a set of raster layers holds, from history's index of their tiles:
     * nothing at all, or the region their marks cover, trimmed to the tiles
     * still holding something so that erasing shrinks it again.
     */
    const holding = (ids: readonly string[]) => {
      const past = history
      if (!past) return { crop: framed(contentBounds.union(ids)) }
      const tiles = ids.flatMap((layerId) => past.occupiedTiles(layerId))
      if (tiles.length === 0) return { empty: true }
      const held = tileBox(tiles)
      const marked = contentBounds.union(ids)
      return {
        crop: framed((marked && intersectRect(marked, held)) ?? held),
      }
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
                ...holding(
                  rasterLayers(node.children).map((layer) => layer.id)
                ),
              }
            : { subject: { kind: "layer", id }, ...holding([id]) }
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
    stampCount = 0
    samples.clear()
    renderer?.destroy()
    renderer = undefined
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
    renderer?.setView(matrix)
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
      showTransform(layerId, placement)
    } finally {
      open.close()
      renderer?.closePlacedImage(layerId)
    }
  }

  /**
   * Shows a transform in progress without recording it. Mid-drag there is no
   * step to take back yet — the step is the whole drag — so these pixels go
   * to the GPU and history's index is left describing the picture as it was,
   * which is exactly the "before" the commit then records against.
   */
  /**
   * Shows a transform in progress without recording it.
   *
   * One textured quad, drawn by the renderer from the original it is holding
   * (06). Mid-drag there is no step to take back yet — the step is the whole
   * drag — so the GPU is told and history's index is left describing the
   * picture as it was, which is exactly the "before" the commit records
   * against.
   */
  function showTransform(layerId: string, placement: ImagePlacement) {
    if (!renderer) return
    renderer.drawPlacedImage({
      surfaceId: layerId,
      imageId: layerId,
      // The quad, not the box: which way round the picture is drawn inside
      // its corners is what a flip changes.
      corners: placementQuad(placement),
    })
    contentBounds.grow(layerId, placementBounds(placement))
    invalidateThumbnailsOf(layerId)
    if (snapshot.status === "ready") render()
  }

  /** What the host needs to draw the box and to say how much detail is left. */
  function describeTransform(): ImageTransformState | null {
    if (!imageTransform) return null
    const { layerId, placement, asset } = imageTransform
    return Object.freeze({
      layerId,
      placement,
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
    const structure = savedStructure(captureStructure(document), surfaces)
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
    const document = requireDocument()
    const canvas = { width: document.width, height: document.height }
    if (samePlacement(session.placement, session.start)) {
      // Picked up and put down: not a step, and nothing to re-render.
      closeTransform(session)
      publish({ imageTransform: null })
      return
    }
    // The drag drew the picture with the renderer, so the pixels this step
    // has to remember are the ones on the GPU. The region is everywhere the
    // picture has been since it was picked up, so the tiles it left behind
    // are recorded as the empty ones they now are.
    recordOperation("transform image", session.structure, {
      readback: [
        {
          surfaceId: session.layerId,
          region: unionRect(
            session.touched,
            placementBounds(session.placement)
          ),
        },
      ],
      canvas,
    })
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
    const document = requireDocument()
    setPlacement(document, session.layerId, session.start)
    if (!samePlacement(session.placement, session.start))
      showTransform(session.layerId, session.start)
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
      const layer = node
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
    uploadLayers()
    syncComposition()
    publish(describeLayers(document))
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
  let altHeld = false
  /**
   * Shift chose the combine mode as the pen went down, so it is not also a
   * constraint until it has been let go and pressed again — the way a
   * marquee is both added and squared in every editor the hand learned on.
   */
  let shiftLatched = false
  const constrained = () => shiftHeld && !shiftLatched
  /** How near the first vertex, in backing pixels, a click closes a polygon. */
  const CLOSE_RADIUS = 8
  const DOUBLE_CLICK_MS = 400
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
    return combineSelections(doc, selection, marqueeShape(), marquee.mode)
  }

  /** Shift adds, Alt/Option subtracts, both intersect (09). */
  function modeFromModifiers(): SelectionMode {
    if (shiftHeld && altHeld) return "intersect"
    if (shiftHeld) return "add"
    if (altHeld) return "subtract"
    return "replace"
  }

  /** Ends a selection gesture, its outline becoming the selection. */
  function commitMarquee() {
    const mask = marqueeMask()
    marquee = undefined
    forgetGestureInput()
    // A click without a drag is how a replacing marquee lets go of the
    // selection; adding or subtracting nothing leaves it as it was, and
    // intersecting with nothing empties it.
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
    const x = toDocX(screenX, screenY)
    const y = toDocY(screenX, screenY)
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
        target.releaseLayer(id)
      setDocumentSize({ width: stored.width, height: stored.height })
      document = requireDocument()
      applyView()
    }
    // The seeded canvas this session opened on is not part of the document
    // that was stored, and neither is the upload that recorded it.
    past.clear()
    for (const id of structureSurfaceIds(captureStructure(document)))
      target.releaseLayer(id)
    // A document saved with pixels its tree does not name opens with a layer
    // for them, rather than leaving them on disk behind a blank canvas.
    const structure = adoptStrandedSurfaces(stored.structure, stored.surfaces)
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

  function drawFrame(timestamp: number) {
    frame = undefined
    const cpuStart = frameObserver ? performance.now() : 0
    frameStamps = 0
    frameOldestSample = null
    if (marquee) {
      drawMarquee()
      return
    }
    samples.drain(consumeSample)
    // A stroke that ended before its opening sample was drained drew nothing.
    if (!stroking && !opening) {
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
    renderer?.setSelection(marqueeShape() ? marqueeMask() : selection)
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
    const reach = CLOSE_RADIUS * Math.hypot(toDoc[0], toDoc[1])
    const near = (other: Point) =>
      Math.hypot(point.x - other.x, point.y - other.y) <= reach
    const last = polygon.points[polygon.points.length - 1]
    const closes =
      (polygon.points.length >= 3 && near(polygon.points[0])) ||
      (time - polygon.clickedAt <= DOUBLE_CLICK_MS && near(last))
    if (closes) {
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
    // A locked layer is one the painter has said not to touch, and the pen is
    // the one place that has to be told so.
    // An image layer refuses it too, unless the stroke is going to its mask.
    const layer = activeLayer(doc)
    if (layer.locked || (layer.image && !(doc.paintingMask && layer.mask)))
      return
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
    scheduleFrame()
    // An eraser removes ink rather than using it, so it never counts.
    if (snapshot.tool !== "eraser")
      options.onStrokeCommitted?.(snapshot.color.hex)
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
            modifiers: (shift, alt) => {
              shiftHeld = shift
              altHeld = alt
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
            altSamples: () => !isSelectionTool(tool),
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
      // the export presents through the identity rather than the view (D28).
      renderer?.setView(IDENTITY_MATRIX)
      // A layer picked out in the list is how it is being looked at too.
      if (highlight && doc) renderer?.setComposition(planComposite(doc))
      // Preview/export rendering has its own target. It never replaces the
      // visible swap-chain frame while its asynchronous readback completes.
      renderer?.render(output.createView())
      const encoder = acquired.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture: output },
        { buffer, bytesPerRow },
        { width, height }
      )
      acquired.queue.submit([encoder.finish()])
      // Restore the interactive uniform before yielding to the browser. The
      // submitted export work is ordered before this queue write.
      applyView()
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
      // Also restore after an early failure before the normal restoration.
      applyView()
      syncComposition()
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
          const layer = findLayer(document, id)
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
        case "beginImageTransform": {
          const document = requireDocument()
          const layer = findLayer(document, command.id)
          if (layer.kind !== "raster" || !layer.image || !layer.placed)
            throw new Error(
              "Only a placed image can be moved, scaled or turned."
            )
          // A transform in flight on another layer is finished rather than
          // abandoned: the artist moved on, they did not undo.
          if (imageTransform && imageTransform.layerId !== command.id)
            await commitTransform()
          const asset = assetFor(layer.placed.asset.id)
          // Decoded and uploaded here, once. Every adjustment after this is a
          // textured quad: no decode, no canvas-sized conversion in
          // JavaScript, no tile upload — which is the difference between
          // dragging a six-megapixel photograph at three frames a second and
          // dragging it at the frame rate (06).
          const open = await imageCodec().open(asset)
          try {
            renderer?.openPlacedImage(command.id, open.source)
          } catch (error) {
            open.close()
            throw error
          }
          imageTransform = {
            layerId: command.id,
            start: layer.placed.placement,
            placement: layer.placed.placement,
            asset,
            open,
            structure: captureStructure(document),
            touched: placementBounds(layer.placed.placement),
          }
          publish({ imageTransform: describeTransform() })
          break
        }
        case "adjustImageTransform": {
          const document = requireDocument()
          const session = requireTransform()
          const canvas = { width: document.width, height: document.height }
          if (!validPlacement(command.placement, canvas))
            throw new Error("That is not a placement an image can be put at.")
          if (samePlacement(command.placement, session.placement)) break
          session.placement = command.placement
          setPlacement(document, session.layerId, command.placement)
          showTransform(session.layerId, command.placement)
          session.touched = unionRect(
            session.touched,
            placementBounds(command.placement)
          )
          publish({
            imageTransform: describeTransform(),
            ...describeLayers(document),
          })
          break
        }
        case "commitImageTransform":
          await commitTransform()
          break
        case "cancelImageTransform":
          await cancelTransform()
          break
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
            })
          }
          applyLayerChange()
          break
        case "removeLayer":
          {
            // A picture being moved that is then thrown away: the transform
            // has nowhere to land, and a commit would put the pixels back.
            if (imageTransform?.layerId === command.id) {
              closeTransform(imageTransform)
              imageTransform = undefined
              publish({ imageTransform: null })
            }
            const document = requireDocument()
            const before = captureStructure(document)
            const removed = removeLayer(document, command.id)
            const ids = nodeIdsOf(removed)
            // Recorded before the textures go: the pixels themselves are in
            // the tile store, which is what putting the layer back reads from.
            recordOperation("remove layer", before, { removed: ids })
            for (const id of ids) renderer?.releaseLayer(id)
          }
          applyLayerChange()
          break
        case "clearDocument": {
          if (imageTransform) closeTransform(imageTransform)
          imageTransform = undefined
          publish({ imageTransform: null })
          const previous = requireDocument()
          for (const id of structureSurfaceIds(captureStructure(previous)))
            renderer?.releaseLayer(id)
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
          renderer?.releaseLayer(mask.id)
          applyLayerChange()
          break
        }
        case "clearLayer": {
          const document = requireDocument()
          const layer = findLayer(document, command.id)
          // A locked layer is not to be touched, and a placed image's pixels
          // are rendered from its file, so neither is cleared.
          if (layer.locked || layer.image) break
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
        case "selectAll":
          commitSelection("select all", selectAll(requireDocument()))
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
        case "undo":
        case "redo": {
          if (!history) break
          // See `publishHistory`: only the revert itself may undo a trial.
          if (restoreRevertible() && !revertingRestore) break
          // Undo with an outline half drawn takes back the outline, not the
          // selection step beneath it.
          if (marquee) {
            if (command.type === "undo") dropMarquee()
            break
          }
          // Undo during a drag means the adjustment being made, not the step
          // underneath it: the picture goes back to where it was picked up
          // and the stack is left alone.
          if (imageTransform) {
            await cancelTransform()
            break
          }
          const document = requireDocument()
          const previous = structureSurfaceIds(captureStructure(document))
          let restoredSelection: string | null | undefined
          const applied = await history[command.type]((structure) => {
            restoredSelection = structure.selection
            restoreStructure(document, structure)
            // Uploaded before the entry's tiles are written, so a layer that
            // came back cannot have its restored pixels overwritten by the
            // sparse surface it was originally seeded from.
            uploadLayers()
          })
          if (!applied) break
          const remaining = structureSurfaceIds(captureStructure(document))
          for (const id of previous)
            if (!remaining.has(id)) renderer?.releaseLayer(id)
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
          cancelStroke()
          // A polygon half clicked out is dropped with the tool drawing it.
          dropMarquee()
          tool = command.tool
          resampler = createStrokeResampler(brushSpacing(activeBrush()))
          applyBrushTextures()
          if (snapshot.status === "ready") render()
          publish({ tool })
          break
        case "setColor": {
          if (!parseHex(command.hex))
            throw new Error(`Not a colour: ${command.hex}`)
          setInk(hexToWorking(command.hex))
          break
        }
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
      for (const id of previous)
        if (!remaining.has(id)) renderer?.releaseLayer(id)
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
    async exportDocument() {
      if (snapshot.status !== "ready" || !history)
        throw new Error("The graphics device is not ready.")
      await history.settle()
      const surfaces = history.tileIndex()
      const exported = savedStructure(
        captureStructure(requireDocument()),
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
        renderer.releaseLayer(id)
      history.clear()
      doc = createDocument({
        width: imported.manifest.width,
        height: imported.manifest.height,
      })
      for (const id of structureSurfaceIds(captureStructure(doc)))
        renderer.releaseLayer(id)
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
      disposed = true
      stopSelection()
      thumbnails.dispose()
      thumbnailViews.clear()
      // A picture still held open by a transform that was never finished.
      if (imageTransform) closeTransform(imageTransform)
      imageTransform = undefined
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
      listeners.clear()
    },
  }
  return engine
}
