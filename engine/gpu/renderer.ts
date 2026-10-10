import type { BrushGrain } from "../brush/brush"
import type { Accumulation } from "../brush/round-brush"
import { validateTexture, type GrayscaleTexture } from "../brush/texture"
import {
  type ColorMatrix,
  type OutputColorSpace,
  workingToOutputMatrix,
} from "../color/display-transform"
import {
  intersectRect,
  type PixelRect,
  TILE_CHANNELS,
  TILE_SIZE,
  TILE_TEXELS,
  type TileCoord,
  tileBounds,
  tileCoordFromKey,
  tileKey,
} from "../doc/tile-grid"
import {
  cacheKey,
  compositionKey,
  type CompositePlan,
  type CompositeItem,
} from "../doc/document"
import type { LinearColor, TiledLayer } from "../doc/tiled-layer"
import type { SelectionMask } from "../doc/selection"
import type { TiledMask } from "../doc/tiled-mask"
import { blendShader, type BlendMode } from "../shaders/blend-modes"
import { displayTransformShader } from "../shaders/display-transform"
import { surfaceCompositeShader } from "../shaders/surface-composite"
import {
  clearSelectionShader,
  copySelectionShader,
} from "../shaders/clear-selection"
import {
  blurKernel,
  MAX_BLUR_RADIUS,
  normalizeFilter,
  type Filter,
} from "../filters/filter"
import { filterShader } from "../shaders/filter"
import { marchingAntsShader } from "../shaders/marching-ants"
import { placedImageShader } from "../shaders/placed-image"
import { thumbnailShader } from "../shaders/thumbnail"
import { vectorShader } from "../shaders/vector"
import type { Bounds } from "../geom/tessellate"
import {
  IDENTITY_MATRIX,
  invertMatrix,
  type ViewMatrix,
} from "../view/view-transform"
import {
  DEFAULT_RASTER_MAGNIFICATION,
  samplesNearest,
  type RasterMagnification,
} from "../view/magnification"
import { createBufferedStroke, type StrokeMode } from "./buffered-stroke"
import { createDirectStroke } from "./direct-stroke"
import { LAYER_FORMAT, type Surface } from "./surface"

const BYTES_PER_TEXEL = TILE_CHANNELS * 2
/**
 * mat3x3 occupies three 16-byte columns, then one vec4 of background, then the
 * four floats the present pass needs to know about the stack it is showing,
 * then the view (D28) as a second mat3x3, the document's size, stroke mode,
 * and the workspace surrounding the document.
 */
const UNIFORM_BYTES = 160
/** Where the stroke opacity sits in that buffer: after matrix and background. */
const STROKE_OPACITY_OFFSET = 64
/**
 * The active layer's opacity, followed by the two flags saying whether each
 * cache exists. All three are written together, as one plan's answer.
 */
const ACTIVE_OPACITY_OFFSET = 68
/** The screen-to-document matrix of the view (D28): three 16-byte columns. */
const VIEW_OFFSET = 80
/** The document's size in pixels, which the view is inverted against. */
const DOC_SIZE_OFFSET = 128
/** Whether the in-flight stroke removes coverage instead of adding it. */
const STROKE_MODE_OFFSET = 136
/** The dark editor workspace visible beyond the document's bounds. */
const WORKSPACE_BACKGROUND_OFFSET = 144
/**
 * vec2 viewport, feather and the tip flag, one vec4 of ink, then the grain's
 * scale, depth and movement padded out to the 16-byte alignment a uniform
 * requires.
 */
const STAMP_UNIFORM_BYTES = 48
/** Where the tip flag sits in that buffer: after the viewport and feather. */
const USE_TIP_OFFSET = 12
/** Where the grain's scale, depth and movement sit: after the ink. */
const GRAIN_OFFSET = 32
/** Where the rim falloff sits: after the viewport. */
const FEATHER_OFFSET = 8
/** Where the selection flag sits: the last float, after the grain. */
const USE_SELECTION_OFFSET = 44
/** Greyscale, because a tip is coverage and grain is how much gets through. */
const TEXTURE_FORMAT: GPUTextureFormat = "r8unorm"
/**
 * Eight f32 composite controls, then the target-to-document matrix as three
 * 16-byte columns and the document's size, padded to the struct's alignment
 * (`engine/shaders/composite-space.wgsl`).
 */
const COMPOSITE_UNIFORM_BYTES = 96
/** The vector shader's chunk: a mat3x3 and two vec2s (`engine/shaders/vector.ts`). */
const VECTOR_UNIFORM_BYTES = 64
export {
  MAX_STAMPS_PER_DRAW,
  MAX_STAMPS_PER_STROKE,
  type StrokeMode,
} from "./buffered-stroke"

/**
 * What a layer-list thumbnail shows: a layer's own pixels, a mask's coverage,
 * or a group's children flattened together as the group would draw them.
 */
export type ThumbnailSubject =
  | { kind: "layer"; id: string }
  | { kind: "mask"; id: string }
  | { kind: "group"; item: CompositeItem }

/**
 * One object's fill or stroke as the renderer draws it (19): triangles from
 * `engine/geom/tessellate.ts`, the rule that turns them into coverage, and
 * the paint, premultiplied linear light.
 */
export type VectorDraw = {
  vertices: Float32Array
  rule: "nonzero" | "evenodd" | "union"
  color: readonly [number, number, number, number]
  bounds: Bounds
  /**
   * An eraser's mark: its coverage, times its alpha, is taken from what is
   * drawn under it rather than painted over it.
   */
  erase?: boolean
}

/**
 * The edge of the square a vector redraw is done in, a piece at a time. A
 * multisampled target the size of the document would be four times a
 * layer's size again; one this size is 32 MB whatever the document is.
 */
export const VECTOR_CHUNK = 1024

export interface Renderer {
  /** (Re)allocates every render target; layers must be uploaded again after. */
  resize(width: number, height: number): void
  /**
   * Gives a layer GPU storage, uploading the tiles its surface marked dirty
   * and clearing that mark. A layer that has never been uploaded and never
   * painted on holds no texture at all, which is what makes fifty empty
   * layers cost nothing.
   */
  uploadLayer(id: string, surface: TiledLayer): void
  /** Uploads sparse single-channel mask tiles into their GPU paint target. */
  uploadMask(id: string, surface: TiledMask): void
  /** Copies the authoritative GPU pixels into a new independent layer. */
  duplicateLayer(sourceId: string, copyId: string): void
  /** Frees a removed layer's storage. */
  releaseLayer(id: string): void
  /**
   * Sets what is composited and in what order (D19). Rebuilds the caches
   * under and over the active layer, and does nothing at all when the plan is
   * the one already in force — which is why painting, whose plan cannot
   * change, never rebuilds a cache.
   */
  setComposition(plan: CompositePlan): void
  /**
   * Opens a stroke: empties the stroke buffer and fixes how this stroke's dabs
   * combine and what the finished mark's opacity will be.
   */
  beginStroke(stroke: {
    accumulation: Accumulation
    opacity: number
    mode: StrokeMode
  }): void
  /**
   * Draws `count` dabs from `instances` into the stroke buffer, packed as
   * centre x, centre y, radius and opacity. The caller owns the array, reuses
   * it across frames, and draws before it exceeds `MAX_STAMPS_PER_DRAW`.
   */
  stamp(instances: Float32Array, count: number): void
  /**
   * Removes the last `count` dabs by replaying the stroke without them, which
   * is how mispredicted input will be taken back (D26). Returns false, having
   * changed nothing, if the stroke has outrun the log it replays from.
   */
  discardStamps(count: number): boolean
  /**
   * Sets the dab's shape: a greyscale tip texture sampled in stamp space, or
   * the procedural feathered disc when there is none (D24).
   */
  setTip(texture: GrayscaleTexture | null): void
  /**
   * Sets how soft the procedural dab's rim is, in pixels of falloff inside it.
   * A brush's own hardness (D23), so it outlives a resize as the ink does.
   */
  setFeather(feather: number): void
  /**
   * Sets the paper: the texture, and the settings a brush carries for it
   * (`BrushGrain` without the id the pixels were resolved from). All of them
   * are fixed for a stroke; the dynamics graph varies the bite per dab on top.
   */
  setGrain(texture: GrayscaleTexture | null, grain: GrainSettings): void
  /** Sets the premultiplied linear-light ink used by subsequent dabs. */
  setInk(color: LinearColor): void
  /**
   * Composites the stroke buffer into the active layer, once, at stroke
   * opacity. Returns the region the mark landed in, which is the region undo
   * has to remember, or null when the stroke drew nothing.
   */
  endStroke(): PixelRect | null
  /**
   * Abandons the stroke in flight: the buffer is emptied and nothing is
   * composited. This is what a navigation gesture starting mid-mark needs —
   * painting and navigating are different acts, and the half-drawn mark is
   * not one the artist asked for.
   */
  cancelStroke(): void
  /**
   * Takes a placed image's original onto the GPU, so that moving it is a
   * textured quad rather than a canvas-sized conversion in JavaScript (06).
   * Held until `closePlacedImage`; uploading the same id again replaces it.
   */
  openPlacedImage(
    id: string,
    image: ImageBitmap | HTMLCanvasElement | OffscreenCanvas
  ): void
  /**
   * Draws an opened original into a layer at a placement. The layer becomes
   * exactly this picture: whatever it held before, including the picture's
   * own previous position, is gone.
   */
  drawPlacedImage(options: {
    surfaceId: string
    imageId: string
    /** The quad's corners in document pixels, clockwise from its top left. */
    corners: readonly { x: number; y: number }[]
  }): void
  /**
   * Takes a snapshot of part of a layer's own pixels as a source to draw
   * through `drawPlacedImage`, for transforming a painted layer (13). The
   * snapshot is what every preview is drawn from, so however many
   * adjustments the artist makes the layer is resampled once. Answers
   * nothing; release it with `closePlacedImage`.
   */
  openLayerImage(id: string, surfaceId: string, region: PixelRect): void
  /**
   * Lifts what the selection covers of a layer (14): the layer scaled by the
   * coverage, cut to `region`, becomes a source to draw through
   * `drawPlacedImage`, and from then on every such draw lands over the layer
   * as it is with those pixels taken out — so a move leaves the vacated area
   * empty and a soft edge leaves its unselected share behind. The layer
   * itself is untouched until the first draw. Needs a selection.
   */
  openSelectionImage(id: string, surfaceId: string, region: PixelRect): void
  /**
   * Puts a layer snapshot back exactly where it was taken from, texel for
   * texel, over an emptied surface: what cancelling a layer transform is. A
   * lifted selection puts back the whole layer as it was lifted from.
   */
  restoreLayerImage(id: string, surfaceId: string): void
  /** Lets go of an original's texture. */
  closePlacedImage(id: string): void
  /**
   * Redraws `region` of a vector layer's surface from its objects (19): the
   * region becomes exactly `draws`, bottom first, antialiased, and the rest
   * of the surface is left alone. The caller passes what touches the region;
   * anything else is clipped away.
   */
  rasterizeVector(
    surfaceId: string,
    draws: readonly VectorDraw[],
    region: PixelRect
  ): void
  /**
   * Keeps a vector layer's whole scene as geometry, bottom first, or forgets
   * it with null (sharp-zoom 02). The screen draws the layer from this
   * through the view rather than sampling its pixels, so its edges are sharp
   * at any zoom; the pixels stay the document's own, and what export,
   * thumbnails and rasterising read.
   */
  setVectorScene(surfaceId: string, draws: readonly VectorDraw[] | null): void
  /**
   * Reads whole tiles back off a surface, zero-filled where they hang past the
   * canvas and where the surface holds nothing. Asynchronous and off the
   * interactive path: this runs on pen-up and on undo, never per frame (D30).
   */
  readTiles(id: string, coords: readonly TileCoord[]): Promise<Uint16Array[]>
  /** Puts whole tiles back onto a surface. Null texels clear the tile. */
  writeTiles(
    id: string,
    tiles: readonly (TileCoord & { texels: Uint16Array | null })[]
  ): void
  /**
   * How the document is placed on screen (D28), as the document-to-screen
   * affine, and the size of the screen it is placed on — the target `render`
   * draws into, until another size is given; the document's own until one
   * is. View state, never document pixels: the layers are untouched, and the
   * screen is composited through it (sharp-zoom 01).
   */
  setView(
    matrix: ViewMatrix,
    viewport?: { width: number; height: number }
  ): void
  /**
   * How raster pixels look magnified on screen (sharp-zoom 03): layers, masks
   * and the stroke are fetched nearest past the threshold in "pixels", and
   * filtered otherwise. Only the screen reads through the view, so export
   * and thumbnails never see it.
   */
  setRasterMagnification(mode: RasterMagnification): void
  /**
   * The document's selection (07), or null for none. Only the tiles that
   * changed since the last one are written, and no texture is held at all
   * while nothing is selected.
   */
  setSelection(mask: SelectionMask | null): void
  /**
   * The selection's coverage as the GPU holds it, one byte per document
   * pixel, top row first; null while nothing is selected. For tests and for
   * what will lift selected pixels, never per frame.
   */
  readSelection(): Promise<Uint8Array | null>
  /**
   * Empties a surface wherever the selection covers it, in proportion to the
   * coverage. Returns the region it touched, or null with nothing selected.
   */
  clearSelected(surfaceId: string): PixelRect | null
  /**
   * Starts a filter on one surface (18): keeps its pixels as they are, which
   * every preview starts from and a cancel puts back. False when the surface
   * holds nothing.
   */
  beginFilter(surfaceId: string): boolean
  /**
   * Redraws the filtering surface from what it held at the start, through
   * `filter` and within the selection. Answers the region that can differ.
   */
  previewFilter(filter: Filter): PixelRect | null
  /**
   * Ends the filter: kept, the surface holds the last preview; not kept, it
   * holds what it did before the filter began.
   */
  endFilter(keep: boolean): void
  /**
   * Starts a direct stroke on one surface (smudge 01, D41): a wet brush's,
   * which lays `lay`, or with null a smudge. Nothing is copied yet: each
   * tile is kept as it is when a dab first writes to it, which is what a
   * cancel puts back. False for a smudge when the surface holds nothing,
   * and so has nothing to smear.
   */
  beginDirect(surfaceId: string, lay: LinearColor | null): boolean
  /**
   * Draws `count` dabs (see `SMUDGE`) straight into the surface of the
   * direct stroke, each dragging in what lay one dab's travel behind it and
   * laying the stroke's colour by its flow. The first dab of a stroke has
   * nothing behind it to drag.
   */
  drawDirect(dabs: Float32Array, count: number): void
  /**
   * Ends the direct stroke: kept, the surface holds the mark and the region
   * it reached is returned; not kept, the surface holds what it did before.
   */
  endDirect(keep: boolean): PixelRect | null
  /**
   * Draws what the selection covers of one surface into another, in
   * proportion to the coverage (11). Returns the region it wrote, or null
   * with nothing selected or nothing there to copy.
   */
  copySelected(sourceId: string, targetId: string): PixelRect | null
  /**
   * Draws the document through the view. `overlay` is what goes over it on
   * screen and nowhere else: the selection's marching ants, marched `ants`
   * pixels along. A readback leaves it out.
   */
  render(view: GPUTextureView, overlay?: { ants: number }): void
  /**
   * Draws the document at its own size, unviewed, into a target that size:
   * the artwork as it exports, whatever the view. `plan`, when given, is
   * drawn in place of the one in force, which the screen keeps.
   */
  renderArtwork(view: GPUTextureView, plan?: CompositePlan): void
  /**
   * Draws one thumbnail into a small target, reading the surfaces the
   * compositor already holds: nothing crosses back to the CPU. Answers
   * whether the subject held any pixels; an empty one is left transparent.
   */
  drawThumbnail(
    target: GPUTextureView,
    size: { width: number; height: number },
    subject: ThumbnailSubject,
    /** The document region to show; the whole canvas when omitted. */
    crop?: PixelRect
  ): boolean
  destroy(): void
}

/**
 * How the paper is laid down, once the brush's texture id has been resolved to
 * pixels. The three travel together everywhere — brush, engine, renderer and
 * shader — so they travel as one value rather than as a widening list of
 * positional numbers.
 */
export type GrainSettings = Omit<BrushGrain, "textureId">

/**
 * Owns the layers' linear-light textures, the two flattened caches around the
 * active one (D19), the stroke buffer that dabs land in before the layer sees
 * them (D27), and the single display-transform pass.
 *
 * A layer's tiles are uploaded into a canvas-sized `rgba16float` texture,
 * allocated only for layers that hold something. That is affordable because
 * the caches mean an untouched layer is read once per structural change rather
 * than once per frame; per-layer sparse atlases (D-6.1) are what make a large
 * document with many *painted* layers fit, and they replace this allocation
 * without moving the seam — the compositor still sees below, active, above.
 */
export function createRenderer(
  device: GPUDevice,
  options: {
    format: GPUTextureFormat
    outputColorSpace: OutputColorSpace
    /** Opaque canvas backdrop, working-space linear. */
    background: readonly [number, number, number]
    /** Opaque workspace surrounding the canvas; defaults to the canvas backdrop. */
    workspaceBackground?: readonly [number, number, number]
    /** Premultiplied linear-light ink, and the dab rim falloff in pixels. */
    ink: readonly [number, number, number, number]
    feather: number
  }
): Renderer {
  const presentPipelines = new Map<BlendMode, GPURenderPipeline>()
  function presentPipeline(mode: BlendMode): GPURenderPipeline {
    const existing = presentPipelines.get(mode)
    if (existing) return existing
    const shader = device.createShaderModule({
      code: displayTransformShader(mode),
    })
    const pipeline = device.createRenderPipeline({
      label: `present:${mode}`,
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: options.format }],
      },
      primitive: { topology: "triangle-list" },
    })
    presentPipelines.set(mode, pipeline)
    return pipeline
  }
  const blendPipelines = new Map<BlendMode, GPURenderPipeline>()
  function blendPipeline(mode: BlendMode): GPURenderPipeline {
    const existing = blendPipelines.get(mode)
    if (existing) return existing
    const shader = device.createShaderModule({ code: blendShader(mode) })
    const pipeline = device.createRenderPipeline({
      label: `blend:${mode}`,
      layout: "auto",
      vertex: { module: shader, entryPoint: "vertexMain" },
      fragment: {
        module: shader,
        entryPoint: "fragmentMain",
        targets: [{ format: LAYER_FORMAT }],
      },
      primitive: { topology: "triangle-list" },
    })
    blendPipelines.set(mode, pipeline)
    return pipeline
  }

  /** What every present uniform starts as, before a view or a plan. */
  const presentDefaults = packUniform(
    workingToOutputMatrix(options.outputColorSpace),
    options.background,
    options.workspaceBackground ?? options.background
  )

  /** The stroke every brush draws, through the stroke buffer (D27). */
  const buffered = createBufferedStroke(device, {
    size: () => documentSize,
    buffer: () => stroke,
    binding: () => stampBindGroup,
    target: () => paintTarget,
    land(buffer, target, opacity, region, mode) {
      // A document surface into another, so through the artwork's space.
      artwork.compositeSurface(
        buffer,
        target,
        opacity,
        region,
        mode === "erase" ? erasePipeline : compositePipeline
      )
    },
    showOpacity(opacity) {
      for (const compositor of compositors)
        compositor.writePresent(
          STROKE_OPACITY_OFFSET,
          new Float32Array([opacity])
        )
    },
    showMode(mode) {
      for (const compositor of compositors)
        compositor.writePresent(
          STROKE_MODE_OFFSET,
          new Float32Array([mode === "erase" ? 1 : 0])
        )
    },
  })

  const compositeModule = device.createShaderModule({
    code: surfaceCompositeShader,
  })
  const compositeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: { sampleType: "float" },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: { type: "filtering" },
      },
    ],
  })
  const compositePipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [compositeBindGroupLayout],
  })
  const compositePipeline = device.createRenderPipeline({
    layout: compositePipelineLayout,
    vertex: { module: compositeModule, entryPoint: "vertexMain" },
    fragment: {
      module: compositeModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // A flattened surface goes over what is already there, premultiplied.
          blend: {
            color: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })
  const erasePipeline = device.createRenderPipeline({
    layout: compositePipelineLayout,
    vertex: { module: compositeModule, entryPoint: "vertexMain" },
    fragment: {
      module: compositeModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // Premultiplied destination-out: colour and alpha lose the same
          // coverage, so a later composite cannot reveal a fringe.
          blend: {
            color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })

  /**
   * One textured quad per adjustment of a placed image (06). The original is
   * held in an sRGB texture, so the transfer function is the hardware's and
   * the sampler does the resampling: what used to be a canvas-sized loop in
   * JavaScript is a draw call.
   */
  const placedImageModule = device.createShaderModule({
    code: placedImageShader,
  })
  const placedImagePipeline = device.createRenderPipeline({
    label: "placed image",
    layout: "auto",
    vertex: { module: placedImageModule, entryPoint: "vertexMain" },
    fragment: {
      module: placedImageModule,
      entryPoint: "fragmentMain",
      // No blending: the draw decides what the layer holds there, because a
      // placed image is the layer's whole content rather than a mark on it.
      targets: [{ format: LAYER_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  })
  /**
   * A lifted selection (14) is a mark on the layer rather than all of it, so
   * it goes over what the lift left: premultiplied source-over.
   */
  const floatingImagePipeline = device.createRenderPipeline({
    label: "floating selection",
    layout: "auto",
    vertex: { module: placedImageModule, entryPoint: "vertexMain" },
    fragment: {
      module: placedImageModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          blend: {
            color: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
            alpha: {
              srcFactor: "one",
              dstFactor: "one-minus-src-alpha",
              operation: "add",
            },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })
  /**
   * Four corners then the surface size. A `vec2` in a uniform array takes a
   * whole 16-byte slot, so the corners occupy 64 bytes and the size follows
   * them rather than sharing one.
   */
  const PLACED_IMAGE_UNIFORM_FLOATS = 20
  const placedImageUniform = device.createBuffer({
    size: PLACED_IMAGE_UNIFORM_FLOATS * 4,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const placedImageValues = new Float32Array(PLACED_IMAGE_UNIFORM_FLOATS)
  /**
   * Linear on both, and clamped: a reference is commonly shown larger than
   * its own resolution, and the edge must not wrap into the other side.
   */
  const placedImageSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  })
  /** Originals on the GPU, by asset id, while a transform holds them open. */
  const placedImages = new Map<
    string,
    {
      texture: GPUTexture
      bindGroup: GPUBindGroup
      /** A layer's own pixels: premultiplied linear already (13). */
      premultiplied: boolean
      /** Where a layer snapshot was taken from. */
      region?: PixelRect
      /**
       * A lifted selection's layer (14): as lifted, for a cancel, and with
       * the lifted pixels taken out, which every draw lands over.
       */
      lifted?: { original: Surface; base: Surface }
    }
  >()

  function placedImageBindGroup(
    texture: GPUTexture,
    pipeline: GPURenderPipeline = placedImagePipeline
  ) {
    return device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: placedImageUniform } },
        { binding: 1, resource: texture.createView() },
        { binding: 2, resource: placedImageSampler },
      ],
    })
  }

  const thumbnailModule = device.createShaderModule({ code: thumbnailShader })
  const thumbnailPipeline = device.createRenderPipeline({
    label: "thumbnail",
    layout: "auto",
    vertex: { module: thumbnailModule, entryPoint: "vertexMain" },
    fragment: {
      module: thumbnailModule,
      entryPoint: "fragmentMain",
      targets: [{ format: options.format }],
    },
    primitive: { topology: "triangle-list" },
  })
  // mat3x3, two vec2s, the mode, then the crop's origin and size, padded to
  // the struct's 16-byte size. The matrix leads, laid out as the present
  // uniform's is.
  const thumbnailValues = new Float32Array(24)
  thumbnailValues.set(
    packUniform(
      workingToOutputMatrix(options.outputColorSpace),
      options.background,
      options.background
    ).subarray(0, 12)
  )
  const thumbnailUniform = device.createBuffer({
    size: thumbnailValues.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const thumbnailSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  })

  /**
   * A brush with no texture still has to bind one, so the shader can sample
   * unconditionally: fully white is the identity for both. The tip is never
   * read while `useTip` is zero, and white grain lets every dab through whole.
   */
  function createWhiteTexture(): GPUTexture {
    const texture = device.createTexture({
      size: { width: 1, height: 1 },
      format: TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture },
      new Uint8Array([255]),
      { bytesPerRow: 1 },
      { width: 1, height: 1 }
    )
    return texture
  }

  function uploadTexture(source: GrayscaleTexture): GPUTexture {
    const texture = device.createTexture({
      size: {
        width: source.width,
        height: source.height,
        depthOrArrayLayers: source.frameCount ?? 1,
      },
      format: TEXTURE_FORMAT,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    device.queue.writeTexture(
      { texture },
      source.data,
      { bytesPerRow: source.width, rowsPerImage: source.height },
      {
        width: source.width,
        height: source.height,
        depthOrArrayLayers: source.frameCount ?? 1,
      }
    )
    return texture
  }

  // Linear filtering on both: a tip is magnified well past its own resolution
  // on a large dab, and grain is minified as the canvas zooms out.
  const tipSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
  })
  const grainSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "repeat",
  })
  let tipTexture = createWhiteTexture()
  let grainTexture = createWhiteTexture()
  // The brush's own, not the renderer's: it is set once from the options and
  // then owned by whatever brush is in the hand, so a resize must rewrite the
  // current value rather than the one this renderer was created with.
  let feather = options.feather
  /**
   * The dab's shape as the direct stroke reads it, kept in step with the tip
   * and the feather: `usesTip` says the texture is the shape, not the disc.
   */
  const tipShape = {
    texture: tipTexture,
    sampler: tipSampler,
    usesTip: false,
    feather,
  }

  const stampUniform = device.createBuffer({
    size: STAMP_UNIFORM_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  // The parts of the stamp uniform that belong to the brush rather than to the
  // surface: written once here so a brush that sets nothing still draws in ink
  // on a smooth surface, and rewritten by `setTip` and `setGrain`.
  device.queue.writeBuffer(
    stampUniform,
    0,
    new Float32Array([1, 1, feather, 0, ...options.ink, 1, 0, 0, 0])
  )
  let stampBindGroup: GPUBindGroup | undefined

  /** One texture per layer that holds something; absent layers hold none. */
  const surfaces = new Map<string, Surface>()
  let stroke: Surface | undefined
  let paintTarget: Surface | undefined
  let active: Surface | undefined
  /** A plan that has an active layer, which every plan applied must. */
  type ActivePlan = CompositePlan & { active: CompositeItem }
  /** The plan in force, which each compositor builds its caches from. */
  let plan: ActivePlan | undefined
  const clearSelectionModule = device.createShaderModule({
    code: clearSelectionShader,
  })
  const clearSelectionPipeline = device.createRenderPipeline({
    label: "clear selection",
    layout: "auto",
    vertex: { module: clearSelectionModule, entryPoint: "vertexMain" },
    fragment: {
      module: clearSelectionModule,
      entryPoint: "fragmentMain",
      targets: [
        {
          format: LAYER_FORMAT,
          // The eraser's blend: colour and alpha lose the same coverage.
          blend: {
            color: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
            alpha: { srcFactor: "zero", dstFactor: "one-minus-src-alpha" },
          },
        },
      ],
    },
    primitive: { topology: "triangle-list" },
  })
  const copySelectionModule = device.createShaderModule({
    code: copySelectionShader,
  })
  const copySelectionPipeline = device.createRenderPipeline({
    label: "copy selection",
    layout: "auto",
    vertex: { module: copySelectionModule, entryPoint: "vertexMain" },
    fragment: {
      module: copySelectionModule,
      entryPoint: "fragmentMain",
      targets: [{ format: LAYER_FORMAT }],
    },
    primitive: { topology: "triangle-list" },
  })
  const antsShader = device.createShaderModule({ code: marchingAntsShader })
  const antsPipeline = device.createRenderPipeline({
    label: "marching-ants",
    layout: "auto",
    vertex: { module: antsShader, entryPoint: "vertexMain" },
    fragment: {
      module: antsShader,
      entryPoint: "fragmentMain",
      targets: [{ format: options.format }],
    },
    primitive: { topology: "triangle-list" },
  })
  const antsUniform = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const antsValues = new Float32Array(4)
  /** Written over a tile the new selection no longer holds. */
  const EMPTY_SELECTION_TILE = new Uint8Array(TILE_TEXELS)
  let selection:
    | {
        texture: GPUTexture
        bindGroup: GPUBindGroup
        /** The coverage each tile was last written from, by identity. */
        tiles: Map<string, Uint8Array>
        /** The mask's own bounds: nothing outside them is selected. */
        bounds: PixelRect
      }
    | undefined
  function releaseSelection() {
    selection?.texture.destroy()
    selection = undefined
  }
  let width = 0
  let height = 0
  /** The same two, as the strokes read them: one object, so asking allocates nothing. */
  const documentSize = { width, height }
  // Vector layers (19): stencil-and-cover into a multisampled chunk, resolved
  // and copied into the layer. Made on first use; most documents never draw
  // a shape and should not pay for the targets.
  const VECTOR_SAMPLES = 4
  let vector:
    | {
        stencil: Record<VectorDraw["rule"], GPURenderPipeline>
        /** Cover by any count (nonzero, union), or by an odd one (evenodd). */
        cover: GPURenderPipeline
        coverOdd: GPURenderPipeline
        erase: GPURenderPipeline
        eraseOdd: GPURenderPipeline
        uniform: GPUBuffer
        bindGroup: GPUBindGroup
        color: GPUTextureView
        depth: GPUTextureView
        resolve: GPUTexture
        textures: GPUTexture[]
      }
    | undefined

  function vectorTargets() {
    if (vector) return vector
    const shader = device.createShaderModule({ code: vectorShader })
    const layout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    })
    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [layout],
    })
    const multisample = { count: VECTOR_SAMPLES }
    const stencilPipeline = (
      label: string,
      face: GPUStencilFaceState,
      back: GPUStencilFaceState = face
    ) =>
      device.createRenderPipeline({
        label: `vector-stencil:${label}`,
        layout: pipelineLayout,
        vertex: {
          module: shader,
          entryPoint: "stencilVertex",
          buffers: [
            {
              arrayStride: 8,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
              ],
            },
          ],
        },
        fragment: {
          module: shader,
          entryPoint: "stencilFragment",
          targets: [{ format: LAYER_FORMAT, writeMask: 0 }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
          format: "stencil8",
          stencilFront: face,
          stencilBack: back,
        },
        multisample,
      })
    const coverPipeline = (label: string, readMask: number, erase = false) =>
      device.createRenderPipeline({
        label: `vector-cover:${label}`,
        layout: pipelineLayout,
        vertex: {
          module: shader,
          entryPoint: "coverVertex",
          buffers: [
            {
              arrayStride: 24,
              attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x2" },
                { shaderLocation: 1, offset: 8, format: "float32x4" },
              ],
            },
          ],
        },
        fragment: {
          module: shader,
          entryPoint: "coverFragment",
          targets: [
            {
              format: LAYER_FORMAT,
              // Premultiplied "over": each object lands on those below it.
              // An eraser's mark is "destination out": those below lose what
              // it covers, and nothing of its own colour lands.
              blend: erase
                ? {
                    color: {
                      srcFactor: "zero",
                      dstFactor: "one-minus-src-alpha",
                    },
                    alpha: {
                      srcFactor: "zero",
                      dstFactor: "one-minus-src-alpha",
                    },
                  }
                : {
                    color: {
                      srcFactor: "one",
                      dstFactor: "one-minus-src-alpha",
                    },
                    alpha: {
                      srcFactor: "one",
                      dstFactor: "one-minus-src-alpha",
                    },
                  },
            },
          ],
        },
        primitive: { topology: "triangle-list" },
        depthStencil: {
          format: "stencil8",
          // Drawn where the count is not zero; and zeroed under the whole
          // quad either way, so the next object's count starts from nothing.
          stencilFront: {
            compare: "not-equal",
            passOp: "zero",
            failOp: "zero",
          },
          stencilBack: { compare: "not-equal", passOp: "zero", failOp: "zero" },
          stencilReadMask: readMask,
        },
        multisample,
      })
    const size = { width: VECTOR_CHUNK, height: VECTOR_CHUNK }
    const color = device.createTexture({
      size,
      format: LAYER_FORMAT,
      sampleCount: VECTOR_SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const depth = device.createTexture({
      size,
      format: "stencil8",
      sampleCount: VECTOR_SAMPLES,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    const resolve = device.createTexture({
      size,
      format: LAYER_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    })
    const uniform = device.createBuffer({
      size: VECTOR_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    vector = {
      stencil: {
        // Front faces count up and back faces down: the winding number.
        nonzero: stencilPipeline(
          "nonzero",
          { compare: "always", passOp: "increment-wrap" },
          { compare: "always", passOp: "decrement-wrap" }
        ),
        // Every crossing flips the low bit: the winding number's parity.
        evenodd: stencilPipeline("evenodd", {
          compare: "always",
          passOp: "invert",
        }),
        // A stroke's triangles overlap; any of them covering is enough.
        union: stencilPipeline("union", {
          compare: "always",
          passOp: "replace",
        }),
      },
      cover: coverPipeline("any", 0xff),
      coverOdd: coverPipeline("odd", 1),
      erase: coverPipeline("erase-any", 0xff, true),
      eraseOdd: coverPipeline("erase-odd", 1, true),
      uniform,
      bindGroup: device.createBindGroup({
        layout,
        entries: [{ binding: 0, resource: { buffer: uniform } }],
      }),
      color: color.createView(),
      depth: depth.createView(),
      resolve,
      textures: [color, depth, resolve],
    }
    return vector
  }

  /** A scene's draws on the GPU: every fill's triangles, and its cover quad. */
  type VectorBuffers = {
    draws: readonly VectorDraw[]
    triangles: GPUBuffer
    quads: GPUBuffer
    firsts: number[]
  }

  function uploadVectorDraws(draws: readonly VectorDraw[]): VectorBuffers {
    const drawn = draws.filter((draw) => draw.vertices.length >= 6)
    // Every fill's triangles in one buffer, and a covering quad per fill
    // in another: two uploads however many objects there are.
    const triangles = new Float32Array(
      drawn.reduce((total, draw) => total + draw.vertices.length, 0)
    )
    const quads = new Float32Array(drawn.length * 6 * 6)
    const firsts: number[] = []
    let offset = 0
    drawn.forEach((draw, index) => {
      triangles.set(draw.vertices, offset)
      firsts.push(offset / 2)
      offset += draw.vertices.length
      const { minX, minY, maxX, maxY } = draw.bounds
      const corners = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, minY],
        [maxX, maxY],
        [minX, maxY],
      ]
      corners.forEach(([x, y], corner) =>
        quads.set([x, y, ...draw.color], (index * 6 + corner) * 6)
      )
    })
    const buffer = (data: Float32Array) => {
      const created = device.createBuffer({
        size: Math.max(16, data.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
      if (data.byteLength) device.queue.writeBuffer(created, 0, data)
      return created
    }
    return {
      draws: drawn,
      triangles: buffer(triangles),
      quads: buffer(quads),
      firsts,
    }
  }

  function releaseVectorDraws(buffers: VectorBuffers) {
    // Destroying waits for the work already submitted against them.
    buffers.triangles.destroy()
    buffers.quads.destroy()
  }

  /**
   * Draws a scene into `area` of `texture` through `toTarget`, document
   * pixels to the texture's, a chunk at a time. `area` becomes exactly the
   * scene; the rest of the texture is left alone.
   */
  function drawVector(
    buffers: VectorBuffers,
    texture: GPUTexture,
    toTarget: ViewMatrix,
    area: PixelRect
  ) {
    const targets = vectorTargets()
    const [a, b, c, d, e, f] = toTarget
    // Where each draw's bounds land in the target: a box around the four
    // corners, which is the whole of it under rotation.
    const boxes = buffers.draws.map(({ bounds }) => {
      const xs: number[] = []
      const ys: number[] = []
      for (const x of [bounds.minX, bounds.maxX])
        for (const y of [bounds.minY, bounds.maxY]) {
          xs.push(a * x + c * y + e)
          ys.push(b * x + d * y + f)
        }
      return {
        minX: Math.min(...xs),
        minY: Math.min(...ys),
        maxX: Math.max(...xs),
        maxY: Math.max(...ys),
      }
    })
    for (let y = area.y; y < area.y + area.height; y += VECTOR_CHUNK)
      for (let x = area.x; x < area.x + area.width; x += VECTOR_CHUNK) {
        const piece = {
          x,
          y,
          width: Math.min(VECTOR_CHUNK, area.x + area.width - x),
          height: Math.min(VECTOR_CHUNK, area.y + area.height - y),
        }
        // Written before the submit that reads it, and the next chunk's
        // after: the queue keeps them in that order.
        device.queue.writeBuffer(
          targets.uniform,
          0,
          new Float32Array([
            ...packMatrix([a, b, c, d, e - x, f - y]),
            VECTOR_CHUNK,
            VECTOR_CHUNK,
            width,
            height,
          ])
        )
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: targets.color,
              resolveTarget: targets.resolve.createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 0 },
              loadOp: "clear",
              storeOp: "discard",
            },
          ],
          depthStencilAttachment: {
            view: targets.depth,
            stencilClearValue: 0,
            stencilLoadOp: "clear",
            stencilStoreOp: "discard",
          },
        })
        pass.setScissorRect(0, 0, piece.width, piece.height)
        pass.setBindGroup(0, targets.bindGroup)
        buffers.draws.forEach((draw, index) => {
          const box = boxes[index]
          if (
            box.maxX < piece.x ||
            box.maxY < piece.y ||
            box.minX > piece.x + piece.width ||
            box.minY > piece.y + piece.height
          )
            return
          pass.setPipeline(targets.stencil[draw.rule])
          pass.setStencilReference(draw.rule === "union" ? 1 : 0)
          pass.setVertexBuffer(0, buffers.triangles)
          pass.draw(draw.vertices.length / 2, 1, buffers.firsts[index])
          pass.setPipeline(
            draw.erase
              ? draw.rule === "evenodd"
                ? targets.eraseOdd
                : targets.erase
              : draw.rule === "evenodd"
                ? targets.coverOdd
                : targets.cover
          )
          pass.setStencilReference(0)
          pass.setVertexBuffer(0, buffers.quads)
          pass.draw(6, 1, index * 6)
        })
        pass.end()
        encoder.copyTextureToTexture(
          { texture: targets.resolve },
          { texture, origin: { x: piece.x, y: piece.y } },
          { width: piece.width, height: piece.height }
        )
        device.queue.submit([encoder.finish()])
      }
  }

  /**
   * Vector layers' scenes as geometry (sharp-zoom 02), by surface id, and a
   * version that moves whenever one is replaced, so a compositor can tell a
   * drawing of it is stale.
   */
  const vectorScenes = new Map<
    string,
    { buffers: VectorBuffers; version: number }
  >()
  let nextVectorVersion = 0

  function forgetVectorScene(id: string): boolean {
    const held = vectorScenes.get(id)
    if (!held) return false
    releaseVectorDraws(held.buffers)
    vectorScenes.delete(id)
    return true
  }

  /**
   * Bound where a cache does not exist, so the present bind group is always
   * complete. The shader is told not to read it, but a binding must resolve.
   */
  const placeholder = device.createTexture({
    size: { width: 1, height: 1 },
    format: LAYER_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
  })
  const placeholderView = placeholder.createView()
  /**
   * Document surfaces are read through the view (D28), so they are filtered
   * rather than fetched. Clamped, because the shader has already decided
   * that anything off the canvas is backdrop.
   */
  const viewSampler = device.createSampler({
    magFilter: "linear",
    minFilter: "linear",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  })
  /** Raster pixels as squares, when the view magnifies them (sharp-zoom 03). */
  const pixelSampler = device.createSampler({
    magFilter: "nearest",
    minFilter: "nearest",
    addressModeU: "clamp-to-edge",
    addressModeV: "clamp-to-edge",
  })
  let magnification: RasterMagnification = DEFAULT_RASTER_MAGNIFICATION

  /** An affine as the three 16-byte columns a WGSL `mat3x3` is laid out in. */
  function packMatrix([a, b, c, d, e, f]: ViewMatrix): number[] {
    return [a, b, 0, 0, c, d, 0, 0, e, f, 1, 0]
  }

  const SURFACE_USAGE =
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.COPY_SRC |
    GPUTextureUsage.RENDER_ATTACHMENT

  let nextSurfaceId = 0

  function allocateSurface(
    size: { width: number; height: number },
    document: boolean
  ): Surface {
    if (size.width === 0)
      throw new Error("The render target has not been sized.")
    const texture = device.createTexture({
      size,
      format: LAYER_FORMAT,
      usage: SURFACE_USAGE,
    })
    return {
      id: ++nextSurfaceId,
      texture,
      view: texture.createView(),
      document,
      // WebGPU zeroes a new texture, and zero is transparent black.
      empty: true,
    }
  }

  /** A document-sized surface: a layer, a mask, or scratch for one. */
  function createSurface(): Surface {
    return allocateSurface({ width, height }, true)
  }

  function ensureSurface(id: string): Surface {
    const existing = surfaces.get(id)
    if (existing) return existing
    const surface = createSurface()
    surfaces.set(id, surface)
    return surface
  }

  /**
   * Empties `target` wherever the selection covers it, in proportion to the
   * coverage (08). Answers the region it touched.
   */
  function drawClearSelected(target: Surface): PixelRect {
    const region = selection!.bounds
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.view, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(clearSelectionPipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: clearSelectionPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: selection!.texture.createView() }],
      })
    )
    pass.setScissorRect(region.x, region.y, region.width, region.height)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    return region
  }

  // The filter in progress (18): the surface it writes, and that surface as
  // it was when the filter began.
  let filtering: { target: Surface; original: Surface } | undefined
  let blurIntermediate: Surface | undefined
  const filterLayout = device.createBindGroupLayout({
    label: "filter",
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "uniform" },
      },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: {} },
      {
        binding: 4,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: "read-only-storage" },
      },
    ],
  })
  const filterModule = device.createShaderModule({ code: filterShader })
  const filterPipelines = Object.fromEntries(
    (["colourMain", "blurAcrossMain", "blurDownMain"] as const).map(
      (entryPoint) => [
        entryPoint,
        device.createRenderPipeline({
          label: `filter:${entryPoint}`,
          layout: device.createPipelineLayout({
            bindGroupLayouts: [filterLayout],
          }),
          vertex: { module: filterModule, entryPoint: "vertexMain" },
          fragment: {
            module: filterModule,
            entryPoint,
            targets: [{ format: LAYER_FORMAT }],
          },
          primitive: { topology: "triangle-list" },
        }),
      ]
    )
  ) as Record<
    "colourMain" | "blurAcrossMain" | "blurDownMain",
    GPURenderPipeline
  >
  const filterUniform = device.createBuffer({
    size: 32,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const filterKernel = device.createBuffer({
    size: 4 * (MAX_BLUR_RADIUS + 1),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  /** Bound for the selection while nothing is selected; the shader skips it. */
  const noSelection = device.createTexture({
    size: { width: 1, height: 1 },
    format: TEXTURE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })

  function endFilter(keep: boolean) {
    if (!filtering) return
    const { target, original } = filtering
    if (!keep) copySurface(original, target)
    original.texture.destroy()
    blurIntermediate?.texture.destroy()
    blurIntermediate = undefined
    filtering = undefined
  }

  /** The filter's settings and inputs, reading `between` as given. */
  function filterBindGroup(original: Surface, between: GPUTextureView) {
    return device.createBindGroup({
      layout: filterLayout,
      entries: [
        { binding: 0, resource: { buffer: filterUniform } },
        { binding: 1, resource: original.view },
        { binding: 2, resource: between },
        {
          binding: 3,
          resource: (selection?.texture ?? noSelection).createView(),
        },
        { binding: 4, resource: { buffer: filterKernel } },
      ],
    })
  }

  function drawFilter(filter: Filter): PixelRect {
    const { target, original } = filtering!
    const f = normalizeFilter(filter)
    const params = new ArrayBuffer(32)
    const ints = new Uint32Array(params)
    const floats = new Float32Array(params)
    ints[1] = selection ? 1 : 0
    if (f.kind === "hsl") {
      ints[0] = 0
      floats.set([f.hue / 360, f.saturation / 100, f.lightness / 100], 4)
    } else if (f.kind === "brightnessContrast") {
      ints[0] = 1
      floats.set([f.brightness / 200, 1 + f.contrast / 100], 4)
    } else {
      const kernel = blurKernel(f.radius)
      new Int32Array(params)[2] = kernel.length - 1
      device.queue.writeBuffer(filterKernel, 0, kernel)
    }
    device.queue.writeBuffer(filterUniform, 0, params)
    const region = selection ? selection.bounds : { x: 0, y: 0, width, height }
    if (f.kind === "blur") blurIntermediate ??= createSurface()
    const bindGroup = filterBindGroup(
      original,
      blurIntermediate?.view ?? placeholderView
    )
    const encoder = device.createCommandEncoder()
    const draw = (
      pipeline: GPURenderPipeline,
      view: GPUTextureView,
      group: GPUBindGroup,
      scissor: PixelRect
    ) => {
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view, loadOp: "load", storeOp: "store" }],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, group)
      pass.setScissorRect(scissor.x, scissor.y, scissor.width, scissor.height)
      pass.draw(3)
      pass.end()
    }
    if (f.kind === "blur") {
      // The across pass reaches above and below the region as far as the
      // down pass will read it.
      const reach = Math.ceil(f.radius)
      const top = Math.max(0, region.y - reach)
      const bottom = Math.min(height, region.y + region.height + reach)
      // The across pass writes `between`, which it must not also read.
      const acrossGroup = filterBindGroup(original, placeholderView)
      draw(
        filterPipelines.blurAcrossMain,
        blurIntermediate!.view,
        acrossGroup,
        {
          x: region.x,
          y: top,
          width: region.width,
          height: bottom - top,
        }
      )
      draw(filterPipelines.blurDownMain, target.view, bindGroup, region)
    } else {
      draw(filterPipelines.colourMain, target.view, bindGroup, region)
    }
    device.queue.submit([encoder.finish()])
    return region
  }

  /** The stroke that reads and writes its surface as it goes (D29). */
  const direct = createDirectStroke(device, {
    size: () => documentSize,
    tip: () => tipShape,
    selection: () => selection,
    noSelection,
  })

  /**
   * Draws what the selection covers of `source` into `target`, in
   * proportion to the coverage (11). Answers the region it wrote.
   */
  function drawCopySelected(source: Surface, target: Surface): PixelRect {
    const region = selection!.bounds
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.view, loadOp: "load", storeOp: "store" },
      ],
    })
    pass.setPipeline(copySelectionPipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: copySelectionPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: selection!.texture.createView() },
          { binding: 1, resource: source.view },
        ],
      })
    )
    pass.setScissorRect(region.x, region.y, region.width, region.height)
    pass.draw(3)
    pass.end()
    device.queue.submit([encoder.finish()])
    return region
  }

  /** A whole surface copied into another, texel for texel. */
  function copySurface(from: Surface, to: Surface) {
    const encoder = device.createCommandEncoder()
    encoder.copyTextureToTexture(
      { texture: from.texture },
      { texture: to.texture },
      { width, height }
    )
    device.queue.submit([encoder.finish()])
    to.empty = from.empty
  }

  /**
   * Empties a surface. A clear is a load operation, which a scissor rectangle
   * does not narrow, so this is always the whole surface — it runs when a
   * cache is rebuilt, never on a frame of drawing. The stroke buffer is
   * cleared by region instead, by the buffered stroke.
   */
  function clearSurface(surface: Surface) {
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: surface.view,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    })
    pass.end()
    device.queue.submit([encoder.finish()])
    surface.empty = true
  }

  /**
   * Where a compositor draws (sharp-zoom 01): a target of its own size, and
   * the affine taking a target pixel back to the document point under it.
   */
  type Space = { width: number; height: number; toDoc: ViewMatrix }

  /**
   * Flattens the stack into one target (D19), and presents it. There are two:
   * the screen, drawn through the view at the window's own resolution, and
   * the document at its own size, which export and group thumbnails read.
   * Layers, masks and the stroke are the document's and shared; everything a
   * compositor flattens is its own, in its own target, and is rebuilt when
   * its space moves as well as when the plan does. With `geometry`, vector
   * layers are drawn into it from their scenes wherever it is not the
   * document texel for texel (sharp-zoom 02); without, from their pixels.
   */
  function createCompositor({ geometry }: { geometry: boolean }) {
    let space: Space = { width: 0, height: 0, toDoc: IDENTITY_MATRIX }
    /** Whether document surfaces are resampled into this target. */
    let resampling = false
    /** What document surfaces are read through: filtered, or as pixels. */
    let docSampler = viewSampler
    // Vector layers drawn from their geometry into this target, and the
    // version of the scene each was drawn from: -1 once the space moves.
    const vectorSurfaces = new Map<
      string,
      { surface: Surface; version: number }
    >()
    const presentUniform = device.createBuffer({
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    device.queue.writeBuffer(presentUniform, 0, presentDefaults)
    const compositeUniform = device.createBuffer({
      size: COMPOSITE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    const compositeValues = new Float32Array(COMPOSITE_UNIFORM_BYTES / 4)
    // Bind groups hold views, so both are keyed by the surfaces they read and
    // forgotten whenever a texture they could hold is replaced.
    const readBindGroups = new Map<number, GPUBindGroup>()
    const blendBindGroups = new Map<string, GPUBindGroup>()
    // Chosen by the plan: a blend mode's pipeline is made when one is used.
    let pipeline: GPURenderPipeline | undefined
    // Everything under and over the active layer, flattened (D19). Undefined
    // when there is nothing on that side, which is a document of one layer.
    let below: Surface | undefined
    let above: Surface | undefined
    // Blend modes above the pen depend on its live pixels and cannot be
    // flattened independently. Normal-only upper stacks retain the
    // constant-cost path.
    let liveAbove: CompositeItem[] = []
    let activeItem: CompositeItem | undefined
    let blendScratch: Surface | undefined
    let frame: Surface | undefined
    let complexOutput: Surface | undefined
    let complexStages: CompositePlan["stages"]
    let stageBelow: (Surface | undefined)[] = []
    let stageAbove: (Surface | undefined)[] = []
    let stageClipBase: (Surface | undefined)[] = []
    let stageLiveAbove: boolean[] = []
    let stageFrames: Surface[] = []
    const groupCaches = new Map<string, Surface>()
    const validGroupCaches = new Set<string>()
    const coverageCaches = new Map<string, Surface>()
    let presentBindGroup: GPUBindGroup | undefined
    /** The plan applied. Undefined forces the next one to be applied in full. */
    let composition: string | undefined
    /** That plan as given, so a frame can tell it is still the one in force. */
    let applied: ActivePlan | undefined
    /** What the caches were built from, which is only part of that plan. */
    let cachedFrom: string | undefined

    function createTarget(): Surface {
      return allocateSurface(space, false)
    }

    /**
     * Writes where this compositor draws into both of its uniforms. Document
     * surfaces need resampling unless the target is the document itself,
     * texel for texel — which is the export, and an unnavigated screen.
     */
    function writeSpace() {
      const [a, b, c, d, e, f] = space.toDoc
      const resample =
        a !== 1 ||
        b !== 0 ||
        c !== 0 ||
        d !== 1 ||
        e !== 0 ||
        f !== 0 ||
        space.width !== width ||
        space.height !== height
      resampling = resample
      compositeValues[5] = resample ? 1 : 0
      // Target pixels per document pixel, whatever the turn or flip.
      const zoom = 1 / Math.hypot(a, b)
      const sampler = samplesNearest(magnification, zoom)
        ? pixelSampler
        : viewSampler
      if (sampler !== docSampler) {
        docSampler = sampler
        // Every bind group holds the sampler, and the caches were read
        // through the old one.
        forgetBindGroups()
        invalidate()
      }
      compositeValues.set(packMatrix(space.toDoc), 8)
      compositeValues[20] = width
      compositeValues[21] = height
      device.queue.writeBuffer(
        presentUniform,
        VIEW_OFFSET,
        new Float32Array(packMatrix(space.toDoc))
      )
      device.queue.writeBuffer(
        presentUniform,
        DOC_SIZE_OFFSET,
        new Float32Array([width, height])
      )
    }

    /** Lets go of every texture this compositor drew, and what read them. */
    function releaseTargets() {
      for (const surface of groupCaches.values()) surface.texture.destroy()
      groupCaches.clear()
      validGroupCaches.clear()
      for (const surface of coverageCaches.values()) surface.texture.destroy()
      coverageCaches.clear()
      for (const held of vectorSurfaces.values()) held.surface.texture.destroy()
      vectorSurfaces.clear()
      below?.texture.destroy()
      above?.texture.destroy()
      blendScratch?.texture.destroy()
      frame?.texture.destroy()
      for (const surface of stageFrames) surface.texture.destroy()
      below = undefined
      above = undefined
      blendScratch = undefined
      frame = undefined
      stageFrames = []
      complexOutput = undefined
      complexStages = undefined
      stageBelow = []
      stageAbove = []
      stageClipBase = []
      stageLiveAbove = []
      liveAbove = []
      activeItem = undefined
      presentBindGroup = undefined
      forgetBindGroups()
      invalidate()
    }

    function forgetBindGroups() {
      readBindGroups.clear()
      blendBindGroups.clear()
    }

    /** The caches were flattened from pixels that have since changed. */
    function invalidate() {
      composition = undefined
      cachedFrom = undefined
    }

    function readBindGroup(source: Surface): GPUBindGroup {
      const existing = readBindGroups.get(source.id)
      if (existing) return existing
      const created = device.createBindGroup({
        layout: compositeBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: compositeUniform } },
          { binding: 1, resource: source.view },
          { binding: 2, resource: docSampler },
        ],
      })
      readBindGroups.set(source.id, created)
      return created
    }

    /** Draws one surface over another at an opacity, optionally scissored. */
    function compositeSurface(
      source: Surface,
      destination: Surface,
      opacity: number,
      region?: PixelRect,
      selectedPipeline = compositePipeline
    ) {
      // The uniform is written per composite rather than per surface: these
      // passes are rare, and one buffer is cheaper than a bind group each.
      compositeValues[0] = opacity
      compositeValues[1] = 0
      compositeValues[2] = 0
      compositeValues[3] = 0
      compositeValues[4] = 0
      compositeValues[6] = source.document ? 1 : 0
      compositeValues[7] = 0
      device.queue.writeBuffer(compositeUniform, 0, compositeValues)
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: destination.view, loadOp: "load", storeOp: "store" },
        ],
      })
      pass.setPipeline(selectedPipeline)
      pass.setBindGroup(0, readBindGroup(source))
      if (region)
        pass.setScissorRect(region.x, region.y, region.width, region.height)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      destination.empty = false
    }

    function blendBindings(
      mode: BlendMode,
      source: Surface,
      maskId: string | undefined,
      clipBase: Surface | undefined,
      usesStroke: boolean
    ): GPUBindGroup {
      blendScratch ??= createTarget()
      const mask = maskId ? surfaces.get(maskId) : undefined
      const bindingKey = `${mode}:${source.id}:${mask?.id ?? 0}:${clipBase?.id ?? 0}:${usesStroke ? 1 : 0}`
      const existing = blendBindGroups.get(bindingKey)
      if (existing) return existing
      const bindings = device.createBindGroup({
        layout: blendPipeline(mode).getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: compositeUniform } },
          { binding: 1, resource: source.view },
          { binding: 2, resource: blendScratch.view },
          {
            binding: 3,
            resource: usesStroke ? stroke!.view : placeholderView,
          },
          { binding: 4, resource: mask?.view ?? placeholderView },
          { binding: 5, resource: clipBase?.view ?? placeholderView },
          { binding: 6, resource: docSampler },
        ],
      })
      blendBindGroups.set(bindingKey, bindings)
      return bindings
    }

    /** Snapshot the destination: WebGPU cannot sample a render attachment. */
    function blendSurface(
      source: Surface,
      destination: Surface,
      item: Pick<CompositeItem, "opacity" | "blend">,
      inFlight = false,
      maskId?: string,
      clipBase?: Surface,
      maskInFlight = false
    ) {
      blendScratch ??= createTarget()
      const pipeline = blendPipeline(item.blend)
      const bindings = blendBindings(
        item.blend,
        source,
        maskId,
        clipBase,
        inFlight || maskInFlight
      )
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: destination.texture },
        { texture: blendScratch.texture },
        { width: space.width, height: space.height }
      )
      compositeValues[0] = item.opacity
      compositeValues[1] = inFlight
        ? buffered.opacity()
        : maskInFlight
          ? -buffered.opacity()
          : 0
      compositeValues[2] = maskId && surfaces.has(maskId) ? 1 : 0
      compositeValues[3] = clipBase ? 1 : 0
      compositeValues[4] = buffered.mode() === "erase" ? 1 : 0
      compositeValues[6] = source.document ? 1 : 0
      compositeValues[7] = clipBase?.document ? 1 : 0
      device.queue.writeBuffer(compositeUniform, 0, compositeValues)
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          { view: destination.view, loadOp: "load", storeOp: "store" },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, bindings)
      pass.draw(3)
      pass.end()
      device.queue.submit([encoder.finish()])
      destination.empty = false
    }

    /** Whether a layer is drawn into this target from its geometry. */
    function fromGeometry(id: string): boolean {
      return geometry && resampling && vectorScenes.has(id)
    }

    /**
     * What a layer is composited from: its own pixels, or for a vector layer
     * on a magnified screen its scene drawn into this target through the
     * view, redrawn only when the scene or the view has moved since.
     */
    function layerSurface(id: string): Surface | undefined {
      const surface = surfaces.get(id)
      const scene = vectorScenes.get(id)
      if (!surface || !scene || !fromGeometry(id)) return surface
      let held = vectorSurfaces.get(id)
      if (!held) {
        held = { surface: createTarget(), version: -1 }
        vectorSurfaces.set(id, held)
      }
      if (held.version !== scene.version) {
        drawVector(
          scene.buffers,
          held.surface.texture,
          invertMatrix(space.toDoc),
          { x: 0, y: 0, width: space.width, height: space.height }
        )
        held.version = scene.version
        held.surface.empty = false
      }
      return held.surface
    }

    /** The active layer as it is composited. */
    function activeSource(): Surface {
      return (activeItem && layerSurface(activeItem.id)) ?? active!
    }

    function itemSurface(item: CompositeItem): Surface | undefined {
      if (item.kind !== "group") return layerSurface(item.id)
      const children = item.children ?? []
      const target = groupCaches.get(item.id) ?? createTarget()
      groupCaches.set(item.id, target)
      if (validGroupCaches.has(item.id))
        return target.empty ? undefined : target
      if (!target.empty) clearSurface(target)
      renderItems(children, target)
      validGroupCaches.add(item.id)
      return target.empty ? undefined : target
    }

    /**
     * A group flattened for its thumbnail, through the same caches the
     * compositor keeps, rebuilt from the layers as they stand. The
     * compositor's own bookkeeping is put back after: a group around the
     * active layer is never drawn from its cache while painting, so one built
     * here would go stale unnoticed, and it is a texture the compositor never
     * asked for.
     */
    function groupThumbnailSurface(item: CompositeItem): {
      surface: Surface | undefined
      release(): void
    } {
      const held = new Set(groupCaches.keys())
      const valid = new Set(validGroupCaches)
      // Every group under this one is rebuilt too: one around the active
      // layer is not kept current while painting, so its cache may be behind.
      validGroupCaches.clear()
      const surface = itemSurface(item)
      validGroupCaches.clear()
      for (const id of valid) validGroupCaches.add(id)
      return {
        surface,
        // Destroying a texture waits for work already submitted against it,
        // so this may run as soon as the pass reading it is on the queue.
        release() {
          for (const [id, cache] of groupCaches)
            if (!held.has(id)) {
              cache.texture.destroy()
              groupCaches.delete(id)
              forgetBindGroups()
            }
        },
      }
    }

    /** The alpha shape clipping reads, after the base item's mask and opacity. */
    function coverageSurface(
      item: CompositeItem,
      source: Surface,
      maskInFlight = false
    ): Surface {
      if (!item.maskId && item.opacity === 1 && !maskInFlight) return source
      const target = coverageCaches.get(item.id) ?? createTarget()
      coverageCaches.set(item.id, target)
      if (!target.empty) clearSurface(target)
      blendSurface(
        source,
        target,
        { opacity: item.opacity, blend: "normal" },
        false,
        item.maskId,
        undefined,
        maskInFlight
      )
      return target
    }

    function renderItems(
      items: readonly CompositeItem[],
      target: Surface,
      initialClipBase?: Surface
    ) {
      let clipBase = initialClipBase
      for (const item of items) {
        const source = itemSurface(item)
        if (!source) continue
        if (item.blend === "normal" && !item.maskId && !item.clip)
          compositeSurface(source, target, item.opacity)
        else
          blendSurface(
            source,
            target,
            item,
            false,
            item.maskId,
            item.clip ? clipBase : undefined
          )
        if (!item.clip) clipBase = coverageSurface(item, source)
      }
    }

    function prepareItems(
      items: readonly CompositeItem[],
      initialClipBase?: Surface
    ) {
      let clipBase = initialClipBase
      for (const item of items) {
        const source = itemSurface(item)
        if (!source) continue
        if (item.blend !== "normal" || item.maskId || item.clip)
          blendBindings(
            item.blend,
            source,
            item.maskId,
            item.clip ? clipBase : undefined,
            false
          )
        if (!item.clip) clipBase = coverageSurface(item, source)
      }
    }

    /**
     * Flattens one side of the stack into its cache, allocating the cache
     * only if there is anything to put in it. Layers with no texture have
     * never held a pixel, so they are skipped rather than drawn as transparent.
     */
    function buildCache(
      items: readonly CompositeItem[],
      cache: Surface | undefined
    ): Surface | undefined {
      const drawable = items.filter(
        (item) => item.kind === "group" || surfaces.has(item.id)
      )
      if (drawable.length === 0) {
        cache?.texture.destroy()
        return undefined
      }
      const target = cache ?? createTarget()
      if (!target.empty) clearSurface(target)
      renderItems(drawable, target)
      return target
    }

    function refreshPresentBindGroup() {
      if (!active || !stroke || !pipeline) return
      presentBindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: presentUniform } },
          {
            binding: 1,
            resource:
              complexOutput?.view ??
              frame?.view ??
              below?.view ??
              placeholderView,
          },
          { binding: 2, resource: frame ? placeholderView : active.view },
          { binding: 3, resource: frame ? placeholderView : stroke.view },
          { binding: 4, resource: above?.view ?? placeholderView },
          { binding: 5, resource: docSampler },
        ],
      })
    }

    /**
     * Brings the caches up to the plan, and does nothing at all when they
     * were built from this plan in this space already — which is why
     * painting, whose plan cannot change, never rebuilds a cache.
     */
    function apply(next: ActivePlan) {
      applied = next
      const key = compositionKey(next)
      if (key === composition) return
      composition = key
      validGroupCaches.clear()
      const plannedStages = next.stages
      const complex =
        !!plannedStages &&
        (plannedStages.length > 1 ||
          !!next.active.maskId ||
          next.active.clip ||
          next.paintTargetId !== next.active.id)
      if (complex) {
        complexStages = plannedStages
        liveAbove = []
        activeItem = { ...next.active }
        pipeline = presentPipeline("normal")
        stageBelow = complexStages!.map((stage, index) =>
          buildCache(stage.below, stageBelow[index])
        )
        stageClipBase = complexStages!.map((stage) => {
          const base = [...stage.below].reverse().find((item) => !item.clip)
          const source = base ? itemSurface(base) : undefined
          return base && source ? coverageSurface(base, source) : undefined
        })
        stageLiveAbove = complexStages!.map(
          (stage) =>
            stage.above[0]?.clip === true ||
            stage.above.some((item) => item.blend !== "normal")
        )
        stageAbove = complexStages!.map((stage, index) =>
          stageLiveAbove[index]
            ? undefined
            : buildCache(stage.above, stageAbove[index])
        )
        while (stageFrames.length < complexStages!.length)
          stageFrames.push(createTarget())
        complexOutput = stageFrames[complexStages!.length - 1]
        let source = activeSource()
        let sourceItem = activeItem
        for (let index = 0; index < complexStages!.length; index++) {
          const clipBase = sourceItem!.clip ? stageClipBase[index] : undefined
          blendBindings(
            sourceItem!.blend,
            source!,
            sourceItem!.maskId,
            clipBase,
            index === 0
          )
          if (stageLiveAbove[index]) {
            const aboveBase = sourceItem!.clip
              ? stageClipBase[index]
              : coverageSurface(
                  sourceItem!,
                  source!,
                  index === 0 && paintTarget !== active
                )
            prepareItems(complexStages![index].above, aboveBase)
          }
          source = stageFrames[index]
          sourceItem = complexStages![index].container ?? sourceItem
        }
        device.queue.writeBuffer(
          presentUniform,
          ACTIVE_OPACITY_OFFSET,
          new Float32Array([0, 1, 0])
        )
        refreshPresentBindGroup()
        return
      }
      complexStages = undefined
      complexOutput = undefined
      // Flattening is the expensive half, and most plans do not change what
      // goes into it: fading the active layer or selecting nothing new leaves
      // both caches exactly as they are.
      activeItem = { ...next.active }
      // A vector layer drawn from its geometry is in this target, where the
      // present pass cannot read it, so it is composited into the frame.
      const activeInTarget = fromGeometry(next.active.id)
      liveAbove =
        activeInTarget || next.above.some((item) => item.blend !== "normal")
          ? next.above.map((item) => ({ ...item }))
          : []
      if (liveAbove.length || activeInTarget) frame ??= createTarget()
      else {
        frame?.texture.destroy()
        frame = undefined
      }
      pipeline = presentPipeline(frame ? "normal" : next.active.blend)
      const caches = cacheKey(next)
      if (caches !== cachedFrom) {
        cachedFrom = caches
        below = buildCache(next.below, below)
        above = buildCache(frame ? [] : next.above, above)
      }
      device.queue.writeBuffer(
        presentUniform,
        ACTIVE_OPACITY_OFFSET,
        new Float32Array([
          frame ? 0 : next.active.opacity,
          frame || below ? 1 : 0,
          above ? 1 : 0,
        ])
      )
      refreshPresentBindGroup()
    }

    /**
     * Draws the plan into `view`, which is this compositor's target.
     * `overlay` is the selection's marching ants, marched `ants` pixels along.
     */
    function draw(
      view: GPUTextureView,
      overlay?: { ants: number },
      using: ActivePlan | undefined = plan
    ) {
      // A view that moved, or pixels a cache was flattened from, rebuild the
      // caches here: once per frame however many changes led up to it.
      if (using && (using !== applied || composition === undefined))
        apply(using)
      if (!presentBindGroup || !pipeline)
        throw new Error("No composition has been set to present.")
      if (complexStages) {
        let current = activeSource()
        let currentItem = activeItem!
        for (let index = 0; index < complexStages.length; index++) {
          const target = stageFrames[index]
          clearSurface(target)
          if (stageBelow[index]) compositeSurface(stageBelow[index]!, target, 1)
          blendSurface(
            current,
            target,
            currentItem,
            index === 0 && paintTarget === active,
            currentItem.maskId,
            currentItem.clip ? stageClipBase[index] : undefined,
            index === 0 && paintTarget !== active
          )
          if (stageLiveAbove[index]) {
            const aboveBase = currentItem.clip
              ? stageClipBase[index]
              : coverageSurface(
                  currentItem,
                  current,
                  index === 0 && paintTarget !== active
                )
            renderItems(complexStages[index].above, target, aboveBase)
          } else if (stageAbove[index]) {
            compositeSurface(stageAbove[index]!, target, 1)
          }
          current = target
          const container = complexStages[index].container
          if (container) currentItem = container
        }
        complexOutput = current
      } else if (frame) {
        clearSurface(frame)
        if (below) compositeSurface(below, frame, 1)
        blendSurface(activeSource(), frame, activeItem!, true)
        for (const item of liveAbove) {
          const source = itemSurface(item)
          if (source) blendSurface(source, frame, item)
        }
      }
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, presentBindGroup)
      pass.draw(3)
      if (overlay && selection) {
        antsValues[0] = overlay.ants
        device.queue.writeBuffer(antsUniform, 0, antsValues)
        pass.setPipeline(antsPipeline)
        pass.setBindGroup(0, selection.bindGroup)
        pass.draw(3)
      }
      pass.end()
      device.queue.submit([encoder.finish()])
    }

    return {
      presentUniform,
      compositeSurface,
      groupThumbnailSurface,
      apply,
      draw,
      invalidate,
      releaseTargets,
      /**
       * Moves the compositor to a new target. A new size reallocates every
       * texture it drew; any change at all rebuilds the caches on next draw.
       */
      setSpace(next: Space) {
        const resized =
          next.width !== space.width || next.height !== space.height
        const moved = next.toDoc.some(
          (value, index) => value !== space.toDoc[index]
        )
        space = next
        writeSpace()
        if (resized) releaseTargets()
        else if (moved) {
          for (const held of vectorSurfaces.values()) held.version = -1
          invalidate()
        }
      },
      /** Rewritten when the document is resized, which every space reads. */
      writeSpace,
      /** Writes part of the present uniform, at a byte offset. */
      writePresent(offset: number, values: Float32Array) {
        device.queue.writeBuffer(presentUniform, offset, values)
      },
      /** Drops what this compositor kept for one layer, if anything. */
      forget(id: string): boolean {
        const group = groupCaches.get(id)
        const coverage = coverageCaches.get(id)
        const drawn = vectorSurfaces.get(id)?.surface
        group?.texture.destroy()
        coverage?.texture.destroy()
        drawn?.texture.destroy()
        groupCaches.delete(id)
        validGroupCaches.delete(id)
        coverageCaches.delete(id)
        vectorSurfaces.delete(id)
        if (group || coverage || drawn) forgetBindGroups()
        return !!group || !!coverage || !!drawn
      },
      forgetBindGroups,
      destroy() {
        releaseTargets()
        presentUniform.destroy()
        compositeUniform.destroy()
      },
    }
  }

  /** Rebuilt whenever a texture is replaced: a bind group holds views, not ids. */
  function refreshStampBindGroup() {
    stampBindGroup = device.createBindGroup({
      layout: buffered.bindingLayout,
      entries: [
        { binding: 0, resource: { buffer: stampUniform } },
        { binding: 1, resource: tipSampler },
        { binding: 2, resource: grainSampler },
        {
          binding: 3,
          resource: tipTexture.createView({ dimension: "2d-array" }),
        },
        { binding: 4, resource: grainTexture.createView() },
        {
          binding: 5,
          resource: selection?.texture.createView() ?? placeholderView,
        },
      ],
    })
    device.queue.writeBuffer(
      stampUniform,
      USE_SELECTION_OFFSET,
      new Float32Array([selection ? 1 : 0])
    )
  }

  /** The screen, through the view: what the artist sees. */
  const screen = createCompositor({ geometry: true })
  /**
   * The document at its own size: the artwork as it exports, and where a group's
   * thumbnail is flattened in. It keeps nothing between uses.
   */
  const artwork = createCompositor({ geometry: false })
  const compositors = [screen, artwork]
  /** The window the screen compositor fills, once one has been given. */
  let viewport: { width: number; height: number } | undefined
  /** Screen pixels to document pixels. */
  let screenToDocument: ViewMatrix = IDENTITY_MATRIX

  /** Puts the screen where the view says, and the artwork at the document. */
  function placeCompositors() {
    screen.setSpace({
      width: viewport?.width ?? width,
      height: viewport?.height ?? height,
      toDoc: screenToDocument,
    })
    artwork.setSpace({ width, height, toDoc: IDENTITY_MATRIX })
  }

  /** Pixels some cache was flattened from have changed. */
  function invalidateCaches() {
    for (const compositor of compositors) compositor.invalidate()
  }

  return {
    resize(nextWidth, nextHeight) {
      releaseSelection()
      direct.invalidateBinding()
      direct.drop()
      for (const surface of surfaces.values()) surface.texture.destroy()
      surfaces.clear()
      for (const id of [...vectorScenes.keys()]) forgetVectorScene(id)
      stroke?.texture.destroy()
      active = undefined
      paintTarget = undefined
      // The caches are gone with the textures they flattened, so the next plan
      // rebuilds them even if it is the same plan.
      for (const compositor of compositors) compositor.releaseTargets()
      width = nextWidth
      height = nextHeight
      documentSize.width = nextWidth
      documentSize.height = nextHeight
      placeCompositors()
      // The view is the artist's and outlives the document's size; the
      // matrix both are measured against is rewritten all the same.
      for (const compositor of compositors) compositor.writeSpace()
      // The stroke buffer matches a layer texel for texel, so a dab lands at
      // the same pixel in both and the composite is a straight copy. Its
      // storage stays document-sized until the per-layer atlases (D-6.1); its
      // clears are already bounded to what each stroke painted (§6.2).
      stroke = createSurface()
      // Only the viewport changes with a resize; the tip flag, the ink and the
      // grain settings are the brush's and outlive it.
      device.queue.writeBuffer(
        stampUniform,
        0,
        new Float32Array([width, height, feather])
      )
      refreshStampBindGroup()
      buffered.resize()
    },
    uploadLayer(id, layer) {
      // A layer with no tiles has never held a pixel, and allocating a
      // canvas-sized texture to hold nothing is what would make a document of
      // fifty layers expensive. The active layer gets its storage from
      // `setComposition` instead, because it is about to be drawn into.
      if (!surfaces.has(id) && layer.tileCount() === 0) return
      const surface = ensureSurface(id)
      const dirty = layer.dirtyBounds()
      if (!surface.empty && !dirty) return
      const canvas = { x: 0, y: 0, width, height }
      let wrote = false
      for (const tile of layer.tiles()) {
        const bounds = tileBounds(tile)
        // Edge tiles hang past the canvas; upload only the visible sub-rect.
        const visible = intersectRect(bounds, canvas)
        if (!visible) continue
        if (!surface.empty && dirty && !intersectRect(bounds, dirty)) continue
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          tile.texels,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
        wrote = true
      }
      layer.clearDirty()
      // An upload that wrote nothing changes nothing: the surface is as empty
      // as it was, and the caches were built from pixels that still stand.
      if (!wrote) return
      surface.empty = false
      // A layer whose pixels arrived from outside a stroke may be inside a
      // cache, and the cache was flattened before they existed.
      invalidateCaches()
    },
    uploadMask(id, mask) {
      if (!surfaces.has(id) && mask.tileCount() === 0) return
      const surface = ensureSurface(id)
      const dirty = mask.dirtyBounds()
      if (!surface.empty && !dirty) return
      const canvas = { x: 0, y: 0, width, height }
      let wrote = false
      for (const tile of mask.tiles()) {
        const bounds = tileBounds(tile)
        const visible = intersectRect(bounds, canvas)
        if (!visible) continue
        if (!surface.empty && dirty && !intersectRect(bounds, dirty)) continue
        // Masks stay single-channel in the document. The current paint target
        // is RGBA, so expand only while uploading and put coverage in alpha.
        const rgba = new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
        for (let texel = 0; texel < tile.texels.length; texel++)
          rgba[texel * TILE_CHANNELS + 3] = tile.texels[texel]
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          rgba,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
        wrote = true
      }
      mask.clearDirty()
      if (!wrote) return
      surface.empty = false
      invalidateCaches()
    },
    duplicateLayer(sourceId, copyId) {
      const source = surfaces.get(sourceId)
      // An absent surface is an empty layer, which should stay allocation-free.
      if (!source) return
      const copy = ensureSurface(copyId)
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: source.texture },
        { texture: copy.texture },
        { width, height }
      )
      device.queue.submit([encoder.finish()])
      copy.empty = source.empty
    },
    releaseLayer(id) {
      forgetVectorScene(id)
      const released = surfaces.get(id)
      if (released) direct.drop(released)
      released?.texture.destroy()
      const releasedSurface = surfaces.delete(id)
      let releasedCache = false
      for (const compositor of compositors)
        releasedCache = compositor.forget(id) || releasedCache
      if (releasedSurface || releasedCache) {
        for (const compositor of compositors) compositor.forgetBindGroups()
        invalidateCaches()
      }
    },
    setComposition(next) {
      if (!stroke) throw new Error("The render target has not been sized.")
      if (!next.active) throw new Error("A composition needs an active layer.")
      plan = { ...next, active: next.active }
      // The active layer is drawn into, so it needs storage whether or not it
      // has ever held a pixel.
      active = ensureSurface(next.active.id)
      paintTarget = ensureSurface(next.paintTargetId ?? next.active.id)
      // The screen is brought up to the plan now, where a change of plan is
      // paid for; the artwork only when something reads it.
      screen.apply(plan)
    },
    beginStroke(options) {
      buffered.begin(options)
    },
    stamp(instances, count) {
      buffered.draw(instances, count)
    },
    setTip(texture) {
      if (texture) {
        validateTexture(texture)
        if ((texture.frameCount ?? 1) > device.limits.maxTextureArrayLayers)
          throw new Error(
            "The tip set exceeds the device's texture layer limit."
          )
      }
      tipTexture.destroy()
      tipTexture = texture ? uploadTexture(texture) : createWhiteTexture()
      tipShape.texture = tipTexture
      tipShape.usesTip = !!texture
      direct.invalidateBinding()
      device.queue.writeBuffer(
        stampUniform,
        USE_TIP_OFFSET,
        new Float32Array([texture ? 1 : 0])
      )
      refreshStampBindGroup()
    },
    setFeather(next) {
      if (!Number.isFinite(next) || next < 0)
        throw new Error("Brush feather must be a finite width of zero or more.")
      feather = next
      tipShape.feather = next
      device.queue.writeBuffer(
        stampUniform,
        FEATHER_OFFSET,
        new Float32Array([feather])
      )
    },
    setGrain(texture, { scale, depth, movement }) {
      if (texture && (texture.frameCount ?? 1) !== 1)
        throw new Error("Grain must be a single-frame texture.")
      if (!Number.isFinite(scale) || scale <= 0)
        throw new Error("Grain scale must be positive.")
      if (!Number.isFinite(depth) || depth < 0 || depth > 1)
        throw new Error("Grain depth must be a finite value in [0, 1].")
      if (!Number.isFinite(movement) || movement < 0 || movement > 1)
        throw new Error("Grain movement must be a finite value in [0, 1].")
      grainTexture.destroy()
      grainTexture = texture ? uploadTexture(texture) : createWhiteTexture()
      device.queue.writeBuffer(
        stampUniform,
        GRAIN_OFFSET,
        // A brush with no grain texture keeps a depth of zero whatever it
        // asked for: white paper bites nothing, and saying so is cheaper.
        new Float32Array([scale, texture ? depth : 0, movement])
      )
      refreshStampBindGroup()
    },
    setInk(color) {
      if (
        color.length !== 4 ||
        color.some(
          (channel) => !Number.isFinite(channel) || channel < 0 || channel > 1
        )
      )
        throw new Error("Ink must be a finite linear colour in [0, 1].")
      device.queue.writeBuffer(stampUniform, 16, new Float32Array(color))
    },
    discardStamps(count) {
      return buffered.discard(count)
    },
    cancelStroke() {
      buffered.end(false)
    },
    endStroke() {
      return buffered.end(true)
    },
    openPlacedImage(id, image) {
      this.closePlacedImage(id)
      const texture = device.createTexture({
        size: { width: image.width, height: image.height },
        // sRGB-encoded: sampling it returns linear light, which is the
        // per-pixel transfer function the CPU route spends a `pow` on.
        format: "rgba8unorm-srgb",
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.RENDER_ATTACHMENT,
      })
      // Straight from the decoded picture into the texture: the pixels never
      // come back to the CPU, which is the whole point of this path.
      device.queue.copyExternalImageToTexture(
        { source: image },
        { texture },
        { width: image.width, height: image.height }
      )
      placedImages.set(id, {
        texture,
        bindGroup: placedImageBindGroup(texture),
        premultiplied: false,
      })
    },
    openLayerImage(id, surfaceId, region) {
      this.closePlacedImage(id)
      const surface = ensureSurface(surfaceId)
      const texture = device.createTexture({
        size: { width: region.width, height: region.height },
        format: LAYER_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC,
      })
      // Texel for texel, on the GPU: the layer never crosses to the CPU.
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: surface.texture, origin: { x: region.x, y: region.y } },
        { texture },
        { width: region.width, height: region.height }
      )
      device.queue.submit([encoder.finish()])
      placedImages.set(id, {
        texture,
        bindGroup: placedImageBindGroup(texture),
        premultiplied: true,
        region,
      })
    },
    openSelectionImage(id, surfaceId, region) {
      this.closePlacedImage(id)
      if (!selection) throw new Error("Nothing is selected to lift.")
      const surface = ensureSurface(surfaceId)
      const original = createSurface()
      copySurface(surface, original)
      const base = createSurface()
      copySurface(surface, base)
      drawClearSelected(base)
      // The lifted pixels are drawn at their own place on a scratch surface,
      // then cut down to the region: the copy pass writes where it reads.
      const scratch = createSurface()
      clearSurface(scratch)
      drawCopySelected(surface, scratch)
      const texture = device.createTexture({
        size: { width: region.width, height: region.height },
        format: LAYER_FORMAT,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.COPY_DST |
          GPUTextureUsage.COPY_SRC,
      })
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: scratch.texture, origin: { x: region.x, y: region.y } },
        { texture },
        { width: region.width, height: region.height }
      )
      device.queue.submit([encoder.finish()])
      scratch.texture.destroy()
      placedImages.set(id, {
        texture,
        bindGroup: placedImageBindGroup(texture, floatingImagePipeline),
        premultiplied: true,
        region,
        lifted: { original, base },
      })
    },
    restoreLayerImage(id, surfaceId) {
      const image = placedImages.get(id)
      if (!image?.region) throw new Error(`No layer snapshot is open as ${id}.`)
      const surface = ensureSurface(surfaceId)
      if (image.lifted) {
        copySurface(image.lifted.original, surface)
        invalidateCaches()
        return
      }
      clearSurface(surface)
      const { region } = image
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToTexture(
        { texture: image.texture },
        { texture: surface.texture, origin: { x: region.x, y: region.y } },
        { width: region.width, height: region.height }
      )
      device.queue.submit([encoder.finish()])
      surface.empty = false
      invalidateCaches()
    },
    drawPlacedImage({ surfaceId, imageId, corners }) {
      const image = placedImages.get(imageId)
      if (!image) throw new Error(`No placed image is open as ${imageId}.`)
      const surface = ensureSurface(surfaceId)
      // A vec2 in a uniform array is padded to 16 bytes, so each corner takes
      // a slot of four floats and the surface size follows them.
      for (let index = 0; index < 4; index++) {
        placedImageValues[index * 4] = corners[index].x
        placedImageValues[index * 4 + 1] = corners[index].y
      }
      placedImageValues[16] = width
      placedImageValues[17] = height
      placedImageValues[18] = image.premultiplied ? 1 : 0
      device.queue.writeBuffer(placedImageUniform, 0, placedImageValues)
      // A lifted selection lands over the layer it was lifted from.
      if (image.lifted) copySurface(image.lifted.base, surface)
      const encoder = device.createCommandEncoder()
      // Cleared and drawn in one pass. The clear is the whole surface rather
      // than the region the picture covers, and it can be: a layer holding a
      // placed image holds that picture and nothing else, so wherever the
      // picture is not, the layer is empty — which is also what makes a move
      // leave nothing behind where it used to be.
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: surface.view,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: image.lifted ? "load" : "clear",
            storeOp: "store",
          },
        ],
      })
      pass.setPipeline(
        image.lifted ? floatingImagePipeline : placedImagePipeline
      )
      pass.setBindGroup(0, image.bindGroup)
      pass.draw(6)
      pass.end()
      device.queue.submit([encoder.finish()])
      surface.empty = false
      // These pixels may sit inside a cache that was flattened before them.
      invalidateCaches()
    },
    closePlacedImage(id) {
      const held = placedImages.get(id)
      if (!held) return
      held.texture.destroy()
      held.lifted?.original.texture.destroy()
      held.lifted?.base.texture.destroy()
      placedImages.delete(id)
    },
    rasterizeVector(surfaceId, draws, region) {
      const canvas = { x: 0, y: 0, width, height }
      const area = intersectRect(
        {
          x: Math.floor(region.x),
          y: Math.floor(region.y),
          width: Math.ceil(region.width),
          height: Math.ceil(region.height),
        },
        canvas
      )
      if (!area) return
      const surface = ensureSurface(surfaceId)
      const buffers = uploadVectorDraws(draws)
      try {
        drawVector(buffers, surface.texture, IDENTITY_MATRIX, area)
      } finally {
        releaseVectorDraws(buffers)
      }
      surface.empty = false
      // The active layer is read live; any other may be inside a cache that
      // was flattened before these pixels.
      if (surface !== active) {
        invalidateCaches()
      }
    },
    setVectorScene(surfaceId, draws) {
      const had = forgetVectorScene(surfaceId)
      if (draws)
        vectorScenes.set(surfaceId, {
          buffers: uploadVectorDraws(draws),
          version: ++nextVectorVersion,
        })
      if (!had && !draws) return
      // The active layer's drawing is checked each frame; any other may be
      // inside a cache, and one gaining or losing its scene changes how the
      // plan is composited.
      if (surfaces.get(surfaceId) !== active || had !== !!draws)
        invalidateCaches()
    },
    async readTiles(id, coords) {
      const surface = surfaces.get(id)
      const blank = () => new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
      // A surface with no texture has never held a pixel, so every tile of it
      // reads as transparent without asking the GPU anything.
      if (!surface || coords.length === 0) return coords.map(blank)
      const canvas = { x: 0, y: 0, width, height }
      const stride = TILE_SIZE * BYTES_PER_TEXEL
      const tileBytes = stride * TILE_SIZE
      const buffer = device.createBuffer({
        size: tileBytes * coords.length,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const encoder = device.createCommandEncoder()
        const regions = coords.map((coord) =>
          intersectRect(tileBounds(coord), canvas)
        )
        regions.forEach((visible, index) => {
          if (!visible) return
          encoder.copyTextureToBuffer(
            {
              texture: surface.texture,
              origin: { x: visible.x, y: visible.y },
            },
            {
              buffer,
              offset: index * tileBytes,
              bytesPerRow: stride,
              rowsPerImage: TILE_SIZE,
            },
            { width: visible.width, height: visible.height }
          )
        })
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const mapped = new Uint16Array(buffer.getMappedRange())
        return coords.map((_, index) => {
          const texels = blank()
          if (!regions[index]) return texels
          const start = (index * tileBytes) / 2
          texels.set(mapped.subarray(start, start + texels.length))
          return texels
        })
      } finally {
        buffer.destroy()
      }
    },
    writeTiles(id, tiles) {
      if (tiles.length === 0) return
      const surface = ensureSurface(id)
      const canvas = { x: 0, y: 0, width, height }
      const blank = new Uint16Array(TILE_SIZE * TILE_SIZE * TILE_CHANNELS)
      for (const tile of tiles) {
        const visible = intersectRect(tileBounds(tile), canvas)
        if (!visible) continue
        device.queue.writeTexture(
          { texture: surface.texture, origin: { x: visible.x, y: visible.y } },
          tile.texels ?? blank,
          { bytesPerRow: TILE_SIZE * BYTES_PER_TEXEL, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
      }
      surface.empty = false
      // These pixels may sit inside a cache that was flattened before them.
      invalidateCaches()
    },
    setRasterMagnification(mode) {
      if (mode === magnification) return
      magnification = mode
      for (const compositor of compositors) compositor.writeSpace()
    },
    setView(matrix, size) {
      screenToDocument = invertMatrix(matrix)
      if (size) viewport = { width: size.width, height: size.height }
      // Before the first resize there is no document to place.
      if (width > 0) placeCompositors()
    },
    setSelection(mask) {
      if (!mask) {
        if (!selection) return
        releaseSelection()
        // Dabs stop being clipped once nothing is selected.
        if (stampBindGroup) refreshStampBindGroup()
        direct.invalidateBinding()
        return
      }
      if (!selection) {
        if (width === 0)
          throw new Error("The render target has not been sized.")
        const texture = device.createTexture({
          size: { width, height },
          format: "r8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC,
        })
        selection = {
          texture,
          bindGroup: device.createBindGroup({
            layout: antsPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: screen.presentUniform } },
              { binding: 1, resource: texture.createView() },
              { binding: 2, resource: { buffer: antsUniform } },
            ],
          }),
          tiles: new Map(),
          bounds: mask.bounds,
        }
        // From the next dab on, the stroke is clipped to the new texture.
        refreshStampBindGroup()
        direct.invalidateBinding()
      }
      const canvas = { x: 0, y: 0, width, height }
      const write = (coord: TileCoord, coverage: Uint8Array) => {
        const visible = intersectRect(tileBounds(coord), canvas)
        if (!visible) return
        device.queue.writeTexture(
          {
            texture: selection!.texture,
            origin: { x: visible.x, y: visible.y },
          },
          coverage,
          { bytesPerRow: TILE_SIZE, rowsPerImage: TILE_SIZE },
          { width: visible.width, height: visible.height }
        )
      }
      const next = new Map<string, Uint8Array>()
      for (const tile of mask.tiles()) {
        const key = tileKey(tile.x, tile.y)
        next.set(key, tile.coverage)
        // Masks share the tiles an operation left alone, so an unchanged
        // tile is the same array and costs no upload.
        if (selection.tiles.get(key) !== tile.coverage)
          write(tile, tile.coverage)
      }
      for (const key of selection.tiles.keys())
        if (!next.has(key)) {
          write(tileCoordFromKey(key), EMPTY_SELECTION_TILE)
        }
      selection.tiles = next
      selection.bounds = mask.bounds
    },
    clearSelected(surfaceId) {
      if (!selection) return null
      const target = surfaces.get(surfaceId)
      if (!target || target.empty) return null
      return drawClearSelected(target)
    },
    beginFilter(surfaceId) {
      const target = surfaces.get(surfaceId)
      if (!target || target.empty) return false
      if (filtering) endFilter(false)
      const original = createSurface()
      copySurface(target, original)
      filtering = { target, original }
      return true
    },
    previewFilter(filter) {
      if (!filtering) return null
      return drawFilter(filter)
    },
    endFilter,
    beginDirect(surfaceId, lay) {
      // A wet brush may be the first thing to paint on its layer. The paint
      // target has its surface already, so nothing is allocated at pen-down.
      const target = lay ? ensureSurface(surfaceId) : surfaces.get(surfaceId)
      return !!target && direct.begin({ target, lay })
    },
    drawDirect(dabs, count) {
      direct.draw(dabs, count)
    },
    endDirect(keep) {
      return direct.end(keep)
    },
    copySelected(sourceId, targetId) {
      if (!selection) return null
      const source = surfaces.get(sourceId)
      if (!source || source.empty) return null
      const target = ensureSurface(targetId)
      const region = drawCopySelected(source, target)
      target.empty = false
      invalidateCaches()
      return region
    },
    async readSelection() {
      if (!selection) return null
      const bytesPerRow = Math.ceil(width / 256) * 256
      const buffer = device.createBuffer({
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      })
      try {
        const encoder = device.createCommandEncoder()
        encoder.copyTextureToBuffer(
          { texture: selection.texture },
          { buffer, bytesPerRow },
          { width, height }
        )
        device.queue.submit([encoder.finish()])
        await buffer.mapAsync(GPUMapMode.READ)
        const mapped = new Uint8Array(buffer.getMappedRange())
        const data = new Uint8Array(width * height)
        for (let y = 0; y < height; y++)
          data.set(
            mapped.subarray(y * bytesPerRow, y * bytesPerRow + width),
            y * width
          )
        return data
      } finally {
        buffer.destroy()
      }
    },
    render(view, overlay) {
      screen.draw(view, overlay)
    },
    renderArtwork(view, instead) {
      if (instead && !instead.active)
        throw new Error("A composition needs an active layer.")
      artwork.draw(
        view,
        undefined,
        instead ? { ...instead, active: instead.active! } : plan
      )
      // Export is occasional, and the screen is what has to stay fast: the
      // artwork's caches are a document-sized copy nobody reads in between.
      artwork.releaseTargets()
    },
    drawThumbnail(target, size, subject, crop) {
      const group =
        subject.kind === "group"
          ? artwork.groupThumbnailSurface(subject.item)
          : { surface: surfaces.get(subject.id), release() {} }
      const source = group.surface
      // A mask that has never been painted hides nothing, which is a picture
      // worth showing — all white — rather than an empty one.
      const view =
        source && !source.empty
          ? source.view
          : subject.kind === "mask"
            ? placeholderView
            : undefined
      const encoder = device.createCommandEncoder()
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: target,
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
      })
      if (view) {
        thumbnailValues[12] = width
        thumbnailValues[13] = height
        thumbnailValues[14] = size.width
        thumbnailValues[15] = size.height
        thumbnailValues[16] = subject.kind === "mask" ? 1 : 0
        thumbnailValues[18] = crop?.x ?? 0
        thumbnailValues[19] = crop?.y ?? 0
        thumbnailValues[20] = crop?.width ?? width
        thumbnailValues[21] = crop?.height ?? height
        device.queue.writeBuffer(thumbnailUniform, 0, thumbnailValues)
        pass.setPipeline(thumbnailPipeline)
        pass.setBindGroup(
          0,
          device.createBindGroup({
            layout: thumbnailPipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: thumbnailUniform } },
              { binding: 1, resource: view },
              { binding: 2, resource: thumbnailSampler },
            ],
          })
        )
        pass.draw(3)
      }
      pass.end()
      device.queue.submit([encoder.finish()])
      group.release()
      return !!view
    },
    destroy() {
      releaseSelection()
      direct.destroy()
      vector?.textures.forEach((texture) => texture.destroy())
      vector?.uniform.destroy()
      vector = undefined
      antsUniform.destroy()
      thumbnailUniform.destroy()
      for (const surface of surfaces.values()) surface.texture.destroy()
      surfaces.clear()
      for (const id of [...vectorScenes.keys()]) forgetVectorScene(id)
      buffered.destroy()
      stroke?.texture.destroy()
      stroke = undefined
      active = undefined
      paintTarget = undefined
      plan = undefined
      for (const compositor of compositors) compositor.destroy()
      stampBindGroup = undefined
      placeholder.destroy()
      tipTexture.destroy()
      grainTexture.destroy()
      stampUniform.destroy()
    },
  }
}

/** WGSL matrices are column-major with 16-byte column stride. */
function packUniform(
  rowMajor: ColorMatrix,
  background: readonly [number, number, number],
  workspaceBackground: readonly [number, number, number]
): Float32Array {
  const data = new Float32Array(UNIFORM_BYTES / 4)
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++)
      data[column * 4 + row] = rowMajor[row * 3 + column]
  data.set([...background, 1], 12)
  data.set([...workspaceBackground, 1], WORKSPACE_BACKGROUND_OFFSET / 4)
  // Stroke opacity, rewritten per stroke; opaque until one begins. The active
  // layer is opaque, and the cache flags stay zero until a composition sets them.
  data[STROKE_OPACITY_OFFSET / 4] = 1
  data[ACTIVE_OPACITY_OFFSET / 4] = 1
  // The identity view, so a renderer nobody has navigated presents the
  // document at its own size, texel for texel.
  const [a, b, c, d, e, f] = IDENTITY_MATRIX
  data.set([a, b, 0, 0, c, d, 0, 0, e, f, 1, 0], VIEW_OFFSET / 4)
  return data
}
