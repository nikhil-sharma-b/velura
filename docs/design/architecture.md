# Velura — Architecture Design Document

**Status:** Accepted (v1 scope frozen)
**Date:** 2026-09-05
**Scope:** Web-based raster painting application in the spirit of Adobe Fresco. Cloud-synced SaaS, local-first cache, WebGPU renderer.

This document records *how* Velura is built and *why* each decision was made. It is the reference that keeps the engine, UI, and backend boundaries honest across sessions. Product behavior lives in the PRD (`docs/design/prd.md`); work sequencing lives in the tickets.

---

## 1. Product definition

Velura is a professional raster painting application that runs in the browser. It targets desktop with a pressure-sensitive stylus first. Documents live in the cloud and are available from any machine the user signs into.

**In v1:**

- A real brush engine: stamp-based, with a dynamics graph mapping pressure/tilt/velocity/randomness onto any brush parameter, textured tips, and canvas-space grain.
- A full layer system: groups, blend modes, masks, clipping masks, opacity and locking.
- A correct color pipeline: 16-bit float linear-light compositing, display transform on present, Display P3 output.
- Cloud persistence and cross-device sync, with an offline-tolerant local cache.
- Unlisted read-only share links.

**Explicitly out of v1, but architected for:**

| Feature | Why deferred | What keeps the door open |
|---|---|---|
| Vector layers | Second renderer, second document model | Layer type is an enum from day one; compositor consumes a texture regardless of how it was produced |
| Live / fluid brushes (watercolor, oil) | Fluid simulation is a project in itself | Compute-shader path reserved; brush engine is already a pluggable `StrokeRenderer` |
| Animation timeline | Multiplies document model by frame count | Document owns a layer *stack*; a frame is a stack, so the indirection is one level |
| Selections and transforms | Geometry and UI on top of a settled engine | Tiles carry no selection state; a selection is a mask texture applied at composite time |
| Smudge / wet mixing | Requires reading the layer while writing it | Deliberately excluded so tiles keep single-writer semantics in v1 |
| PSD import/export | Format compatibility project; PSD is integer, our pipeline is float | `.velura` export proves the serialization boundary exists |
| Realtime collaboration | Needs stroke transport plus per-tile merge | Strokes are already a serializable value type; per-tile rows are independently mutable |
| Engine in a Web Worker | Adds a message protocol to every call | Engine boundary is message-shaped from day one (§7) |

**Non-goals:** mobile-first UX, a public gallery or social layer, Photoshop file compatibility, support for browsers without WebGPU.

---

## 2. Decision record

Each row is a decision that was contested and settled. Rationale is preserved because the cheap-looking alternative is usually the one that fails later.

| # | Decision | Chosen | Rejected | Why |
|---|---|---|---|---|
| D1 | Raster scope | Raster only | Raster+vector, raster+live brushes, all | Live brushes and vector each need the compositor that does not exist yet. Build the raster pipeline correctly and both become "another brush engine" later. |
| D2 | Render backend | WebGPU only | WebGL2, WebGPU+fallback, Canvas2D | 2026 baseline has WebGPU across Chrome/Edge/Safari/Firefox. A fallback doubles all shader work for a shrinking minority. |
| D3 | Canvas storage | Sparse tiles, 256×256 | Full-res texture per layer; stroke-log replay | A 4096² RGBA16F layer is 134 MB. Tiles make 50-layer documents feasible, make undo cheap (dirty tiles only), and bound upload cost. Stroke replay grows unbounded and cannot express transforms, imported images, or filters. |
| D4 | Input target | Desktop + stylus | iPad first, both equal, mouse only | Pointer Events gives pressure/tilt/twist uniformly. iPad Safari adds gesture-blocking and memory-limit work that is orthogonal to the engine. |
| D5 | Persistence | Cloud SaaS, local-first cache | Local only, export-only | Requirement: access work from any machine. |
| D6 | Sync granularity | Per-tile blobs + reactive per-tile index rows | Whole-document snapshot; append-only stroke log | Bounded upload cost, and the reactive index gives "document changed elsewhere" push for free. |
| D7 | Realtime collab | Not now; do not preclude | Ship it; forbid it | Concurrent painting needs stroke transport and per-tile merge. D6 already makes strokes the natural wire format later. |
| D8 | Auth | Convex Auth, email OTP via Resend, anonymous-upgradeable | Clerk, WorkOS, OAuth-only | One vendor, no password handling, no per-provider OAuth app registration. Anonymous start means the first stroke happens before any signup friction. |
| D9 | Undo | In-session tile snapshots + server-side version restore points | Synced undo stack; full scrubbing history | Cross-device undo stacks are expensive and users do not expect them. Version restore points cover the real need. |
| D10 | Color | RGBA16F linear-light, display transform on present, P3 | 8-bit sRGB blending; full ICC/OCIO | Correct brush blending and opacity falloff are immediately visible, and cannot be retrofitted without re-authoring every shader. |
| D11 | Tile blob store | Cloudflare R2 behind a `TileStore` interface | Convex File Storage only; S3 | Free tier decides it: R2 gives ~10 GB and zero egress; Convex file storage is ~1 GB with metered egress. One realistic document is a meaningful fraction of the Convex quota. |
| D12 | Tile wire format | Raw F16 + zstd (WASM) | 16-bit PNG; OpenEXR | Lossless, no color-space round-trip risk, 4–8× on painted tiles. PNG cannot hold F16 linear without a custom transfer; EXR libraries are heavy in the browser. |
| D13 | Index shape | `tiles` table, one row per (layer, x, y) | Manifest inside the document row; manifest per layer | Independently mutable rows mean no write contention, paginated load, and a query subscription that streams exactly which tiles changed. |
| D14 | Local cache | OPFS read-through, keyed by content hash + IndexedDB index | None; full offline-first with mutation queue | Content addressing makes the cache trivially correct: immutable, therefore never stale. Full offline is a v2 project. |
| D15 | Flush policy | Write-back cache; upload on idle / tab-hide / explicit save | Debounce-and-upload; manual save only | R2 Class A writes (1M/mo free) are the binding constraint, not storage. Coalescing cuts PUTs roughly 10×. Durability comes from the instant OPFS write, not the network. |
| D16 | Browser → R2 | Batch-minted presigned PUTs; public immutable GETs by hash | One presigned URL per tile; proxy bytes through Convex | Per-tile minting doubles Convex function-call usage. Proxying spends Convex bandwidth we do not have. |
| D17 | Orphan GC | Nightly mark-and-sweep with a grace window | Refcounting; none | Refcounting under concurrent writes is bug-prone. A sweep is simple and self-healing; the grace window protects in-flight uploads. |
| D18 | Version retention | Time-decayed (hourly for 24h, daily for 7d) | Last N; unlimited | Manifests are cheap; the cost is the tiles they pin against GC. Time decay is what actually protects the storage quota. |
| D19 | Compositor | Cached above/below | Full stack per frame; dirty-rect graph | Per-frame cost becomes independent of layer count: three texture reads regardless of 50 layers. |
| D20 | Blend modes | Generated pipeline per mode; ship a subset first | Branching uber-shader | Branching hurts on tile-heavy fills; WebGPU pipeline creation is cheap and can be lazy per mode in use. |
| D21 | Undo budget | Byte-budgeted ring: hot in RAM, cold compressed, oldest spilled to OPFS | Fixed step count | F16 snapshots are heavy and stroke sizes vary by orders of magnitude. A step is a list of hashes, so it shares storage with the flush cache for free. |
| D22 | App shell | Framework-free engine module; React never re-renders during a stroke | React owns engine state; engine in a Worker now | Pointer events must be sampled on the main thread at full rate. Worker is the endpoint, not the start; the boundary is shaped for it. |
| D23 | Brush model | Params + dynamics graph | Fixed param struct; scriptable shaders | This is the difference between a toy and a real tool, and it is roughly a day of engine work versus a permanent ceiling. User-authored shaders are a security and compile-cost problem. |
| D24 | Brush tip | Procedural + grayscale tip textures + canvas-space grain | Procedural only; dual-tip | Tip and grain are what make pencil, charcoal and dry media read as real. |
| D25 | Path handling | Catmull-Rom, arc-length resampled, plus pulled-string stabilizer | Raw points; spline only | Arc-length resampling is mandatory for even spacing. The stabilizer is a visible, expected feature and degrades gracefully at low strength. |
| D26 | Input sampling | `pointerrawupdate` + `getCoalescedEvents()` | `pointermove` only; prediction in v1 | A 240 Hz pen fires ~4 samples per frame; reading only the last one turns curves into polygons. Prediction needs stroke-buffer rollback, which is designed for but not built. |
| D27 | Stroke compositing | Separate stroke buffer, composited once; per-brush coverage-vs-buildup flag | Stamp directly into the layer | Required for correct per-stroke opacity, and makes undo one snapshot per stroke. The flag is one boolean and covers both brush families. |
| D28 | Navigation | Pan, zoom, rotate, flip | Pan+zoom only | Rotation is an ergonomic necessity and flip is a constant working habit. All are view-matrix state, never baked into layer textures. |
| D29 | Eraser | `destination-out` brush; no smudge | Smudge in v1 | Smudge requires read-while-write on the same layer; it belongs with the live-brush wave. |
| D30 | Perf target | 120 fps at 8192², under 10 ms pointer-to-pixel | 60 fps at 4096²; unspecified | The number is a design forcing function: no full-stack composite per frame, no CPU readback, no allocation in the stroke path. |
| D31 | UI layout | Full-bleed canvas, floating tool rail, collapsible right panel stack | Fresco gesture-first; Photoshop docked panels | Canvas dominance without inventing a gesture vocabulary desktop users will not discover. Reuses existing shadcn primitives. |
| D32 | Brush editor | Full tabbed dialog (Shape / Grain / Dynamics / Rendering) | Slider popover; presets only | D23 exists to be exposed, and `components/ui/pressure-curve.tsx` already provides the curve widget. |
| D33 | Export | PNG, JPEG, and `.velura` (zip of manifest + zstd tiles) | PSD | `.velura` is nearly free — it is the on-disk format zipped. |
| D34 | Shaders | WGSL in `.wgsl` files, small include/define preprocessor | Template literals; node graph | Composable snippets for blend modes and brush variants, with editor tooling and readable diffs. A node graph is a compiler project. |
| D35 | Code layout | `engine/` framework-free, `features/studio/` UI, `convex/` backend | All under `features/`; monorepo | An engine that imports React cannot move to a Worker. Enforced by lint, not by discipline. |
| D36 | Testing | Unit tests on the pure layer + Convex function tests + Playwright golden images | Manual; full VRT | Most engine bugs live in pure math and the sync layer, both cheap to test. Golden images catch shader regressions without a full VRT rig. |
| D37 | No WebGPU | Hard wall with guidance | Canvas2D degraded editor; server-rendered viewer | A second renderer is not worth it. The share-preview (D38) covers the viewing case. |
| D38 | Previews | Flattened, display-transformed PNG written to R2 on each flush | Server-side compositor | The client is already a renderer. One extra PUT yields thumbnails, share links, OG images, and the no-WebGPU view at once. |
| D39 | Sharing | Unlisted read-only link | Private only; public gallery | Nearly free given D38. A gallery is a social product. |
| D40 | Monetization | Model `plan` and quota fields now; no billing code | Stripe in v1; free forever | Retrofitting quota accounting across a tile store is miserable; the gate reads a field hardcoded to `free`. |

---

## 3. System overview

```
┌──────────────────────── Browser ────────────────────────┐
│                                                         │
│  features/studio/  (React, shadcn, Tailwind)            │
│      │  commands in ▲ snapshots out (useSyncExternalStore)
│      ▼                                                  │
│  engine/            framework-free TypeScript           │
│    ├─ input      pointer sampling, path resampling      │
│    ├─ brush      dynamics graph, stamp generation       │
│    ├─ doc        layer tree, tiles, undo                │
│    ├─ gpu        WebGPU device, pipelines, WGSL         │
│    └─ store      TileStore iface, OPFS cache, flusher   │
│                        │                     │          │
└────────────────────────┼─────────────────────┼──────────┘
                         │ index (reactive)    │ blobs
                         ▼                     ▼
                 ┌──────────────┐      ┌───────────────┐
                 │    Convex    │      │ Cloudflare R2 │
                 │ auth, docs,  │─────▶│  tiles/<hash> │
                 │ layers,tiles │ sign │  previews/... │
                 │ versions,cron│      └───────────────┘
                 └──────────────┘
```

**Data split rule:** small, reactive, queried data goes in Convex tables. Large, immutable, content-addressed data goes in R2. Tiles are immutable once flushed — painting produces a *new* tile with a *new* hash — which makes them ideal cacheable objects that never invalidate.

---

## 4. The document model

### 4.1 Structure

A document is a tree of layers over a fixed pixel canvas (max 8192 × 8192).

```
Document
  ├─ id, name, width, height, colorSpace
  ├─ LayerNode[]  (ordered, bottom → top)
  │    ├─ Group   { children: LayerNode[], blend, opacity, clip, mask? }
  │    └─ Raster  { tiles, blend, opacity, clip, locked, mask? }
  └─ activeLayerId
```

A mask is itself a single-channel tiled surface, stored with the same machinery as a raster layer.

### 4.2 Tiles

- **Size:** 256 × 256 pixels.
- **Format:** `rgba16float`, premultiplied alpha, **linear light** (no transfer curve applied).
- **Sparse:** a tile exists only once something is painted into it. An absent tile reads as fully transparent.
- **Immutable:** flushing a modified tile produces a new blob under a new hash. The old blob stays until GC.
- **Identity:** `blake3(rawF16Bytes)`, hex. This is the R2 object key and the cache key.

Coordinates: `tileX = floor(px / 256)`, `tileY = floor(py / 256)`. Tile grid origin is the canvas top-left, so tile coordinates are always non-negative in v1 (no infinite canvas).

### 4.3 Serialization

- **Wire and disk:** raw F16 little-endian, then zstd (level 6, WASM). Expect 4–8× on painted content, far more on near-empty tiles.
- **`.velura` file:** a zip containing `manifest.json` (document, layer tree, tile hash grid) and `tiles/<hash>.zst`. This is the same content as the cloud representation, which keeps one serializer rather than two.

---

## 5. Color pipeline

Everything between input and present is linear light.

1. **Authoring:** the color picker works in a perceptual space (OKLCH) for UI, converts to linear scene-referred RGB for the engine.
2. **Painting and compositing:** all blending happens on `rgba16float` linear premultiplied values. This is what makes opacity falloff and soft brush edges behave the way painters expect; sRGB-space blending produces the characteristic dark fringing on gradients.
3. **Present:** a single display-transform pass applies the OETF and maps to the output color space (Display P3 where available, sRGB otherwise) when drawing to the swap chain.
4. **Export and previews:** use the *same* display-transform shader as the present pass. Divergence here is the classic bug that makes exports and thumbnails look washed out relative to the canvas.

---

## 6. Rendering

### 6.1 GPU resources

- One `GPUDevice` for the app lifetime; loss is handled by tearing down and rebuilding from the tile cache.
- Tiles live as entries in per-layer texture atlases (arrays of `rgba16float` 256² textures) so binding is stable and draw calls batch.
- No CPU readback in the interactive path. Ever. Readback happens only on export and preview generation, and is asynchronous.

### 6.2 Stroke pipeline

```
pointerrawupdate
  → getCoalescedEvents() → ring buffer          (main thread, full rate)
  → rAF tick:
      stabilizer (pulled string)
      → Catmull-Rom through points
      → arc-length resample at spacing × size
      → per-stamp dynamics evaluation
      → instanced quad draw into STROKE BUFFER
      → composite (below-cache, layer + stroke buffer, above-cache) → present
pointerup
  → composite stroke buffer into the layer's tiles (once, at stroke opacity)
  → push undo entry (dirty tile hashes, before/after)
  → mark tiles dirty for flush
```

The **stroke buffer** is a separate tiled surface covering the stroke's bounding region. Two accumulation modes, selected per brush:

- **Coverage** (`max` alpha): overlapping stamps within one stroke do not darken each other. Airbrush and marker behavior.
- **Buildup** (`over` accumulation): each stamp adds. Wet and dry media behavior.

This is also what makes prediction (D26, deferred) implementable later: discarding mispredicted stamps means discarding from the stroke buffer, not from the layer.

### 6.3 Compositor

Cached above/below (D19):

- `belowCache` — everything under the active layer, flattened.
- `aboveCache` — everything over the active layer, flattened.
- Per frame: `belowCache` → active layer (+ stroke buffer) → `aboveCache`.

Caches rebuild when layer selection, order, visibility, opacity, blend mode, or clipping changes — not when pixels change on the active layer. Clipping masks and groups are resolved during cache construction.

Ticket 09 correction to D19: an above cache is valid only when all contributing upper layers use Normal. Other modes depend on the changing backdrop and cannot be represented by one RGBA image independent of the active layer (Overlay is a direct counterexample). In that case the below cache still stays fixed, but the renderer composites the active layer and replays the upper stack each frame into a reusable float surface. This path costs one pass per upper layer; the Normal-only path remains independent of layer count. A future transfer-function cache could optimize selected modes, but must preserve this backdrop dependency.

### 6.4 Blend modes

Generated pipeline per mode (D20), from shared `.wgsl` snippets expanded by a small include/define preprocessor. Pipelines are cached per renderer and created on first use. The layer stack is isolated: transparent document pixels do not blend with the display-only canvas background. Opacity scales premultiplied RGBA before source-over composition; colour is unpremultiplied only inside the blend operation. Add clamps the channel sum at one; Subtract clamps backdrop minus source at zero. Separable modes first (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion, Add, Subtract); non-separable modes (Hue, Saturation, Color, Luminosity) as a second batch, since they need the full HSL/luminosity math.

---

## 7. Brush engine

### 7.1 Brush definition

A brush is serializable JSON — no code, no shaders.

```
Brush
  ├─ shape:     tipTextureId?, hardness, roundness, angle, spacing
  ├─ grain:     grainTextureId?, scale, depth, movement (canvas-space)
  ├─ rendering: blendMode, accumulation: "coverage" | "buildup", flow, wetEdge
  ├─ scatter:   positionJitter, angleJitter, sizeJitter, count
  └─ dynamics:  Modulator[]
```

### 7.2 Dynamics graph

```
Modulator = {
  source: "pressure" | "tilt" | "tiltDirection" | "velocity" | "direction" | "random" | "strokeProgress"
  target: "size" | "opacity" | "flow" | "angle" | "roundness" | "grainDepth" | "scatter" | "hue" | ...
  curve:  CubicCurve        // the pressure-curve widget already in components/ui
  range:  [min, max]
  mix:    "multiply" | "replace" | "add"
}
```

Evaluation is a pure function — `(brush, stampContext) → StampParams` — and therefore the highest-value unit-test target in the codebase (D36).

### 7.3 Texture handling

- **Tip textures** are grayscale alpha, sampled in *stamp space* (they rotate and scale with the stamp).
- **Grain textures** are sampled in *canvas space*, so the paper texture stays fixed under the moving brush. Sampling grain in stamp space makes texture swim with the cursor; this is the single most common mistake in brush implementations.

---

## 8. Undo

- One undo entry per stroke or per discrete operation.
- An entry is `{ layerId, tiles: [{x, y, beforeHash, afterHash}] }` — a list of hashes, not pixels.
- Because tiles are content-addressed, undo shares storage with the flush cache at no extra cost.
- Storage tiering (D21): the most recent ~10 entries hold uncompressed tiles in RAM; older entries hold zstd-compressed tiles; oldest spill to OPFS. Bound by bytes, not by step count.
- Undo is **session-scoped and local**. Cross-device history is served by version restore points (§9.4), not by the undo stack.

---

## 9. Persistence and sync

### 9.1 Convex schema (shape, not final field list)

```
users        { authId, plan: "free", storageBytes, docCount }
documents    { ownerId, name, width, height, activeVersionId,
               previewHash, shareToken?, createdAt, updatedAt }
layers       { docId, parentId?, kind: "raster"|"group", order,
               name, blend, opacity, visible, locked, clip, maskLayerId? }
tiles        { layerId, x, y, hash, bytes, version, updatedAt }   // one row per tile
versions     { docId, label?, createdAt, snapshot }               // pinned tile-hash set
brushes      { ownerId?, builtin, name, definition }
```

`tiles` as independent rows (D13) is what avoids OCC write conflicts under rapid autosave and lets a client subscribe to exactly the tiles that changed.

### 9.2 Write path

1. Stroke completes → tiles marked dirty → **written to OPFS immediately** (this is the durability guarantee).
2. Flush trigger: 30 s idle, `visibilitychange` to hidden, `beforeunload`, or explicit save.
3. Client hashes dirty tiles, asks Convex "which of these hashes do you not have?" (dedup — unchanged and duplicate tiles cost nothing).
4. Convex action mints **one batch** of presigned PUTs for the missing hashes.
5. Client uploads to R2 in parallel with bounded concurrency; retries are safe because content-addressed PUTs are idempotent.
6. Client calls one Convex mutation to upsert the changed `tiles` rows and bump the document version.
7. Client uploads a flattened, display-transformed preview PNG (D38).

### 9.3 Read path

1. Subscribe to `documents` + `layers` + `tiles` for the open document.
2. For each tile hash: OPFS cache hit → decode; miss → GET `r2/tiles/<hash>` (public, immutable, `Cache-Control: immutable`, no signing) → store in OPFS → decode.
3. Tiles stream in by viewport proximity, so the visible region resolves first.

Because hashes are content-addressed, the cache is never stale and never needs invalidation.

### 9.4 Versions and GC

- Restore points are written at each flush and retained on a time decay: hourly for 24 h, daily for 7 d (D18).
- A nightly Convex cron does mark-and-sweep (D17): walk all live `tiles` rows plus all retained `versions` snapshots, then delete R2 objects not in that set **and older than a 7-day grace window**. The grace window prevents deleting a blob a slow client is still uploading against.

### 9.5 Multi-device conflict

v1 is single-user, multi-device, last-writer-wins at tile granularity, with a soft "this document is open on another device" indicator driven by Convex presence. The per-tile row model means the eventual upgrade to real merge (D7) is a change to the write path, not to the storage model.

### 9.6 Free-tier budget

The binding constraint is **R2 Class A operations (1M/month)**, not storage. One PUT per flushed tile. Coalesced flushing (D15) plus hash dedup (step 3 above) is what keeps this viable; naive per-stroke uploads would exhaust the budget in low hundreds of sessions. Convex function calls (1M/month) are protected by batching presigned-URL minting and tile-row upserts into single calls per flush (D16).

---

## 9a. Auth

Convex Auth with email OTP via Resend (D8). Anonymous users get a local-only document in OPFS and can paint immediately; signing in migrates that document to the cloud by uploading its tiles under the new owner. No password storage, no OAuth app registration per provider.

---

## 10. Application architecture

### 10.1 Module boundaries

```
engine/            # NO React, NO Next, NO DOM framework imports
  input/           # pointer sampling, coalesced events, ring buffer
  geom/            # Catmull-Rom, arc-length resampling, stabilizer
  brush/           # brush types, dynamics evaluation, stamp generation
  doc/             # layer tree, tile grid, undo, document mutations
  gpu/             # device, pipelines, atlases, WGSL loading
  shaders/         # .wgsl sources + include preprocessor
  store/           # TileStore interface, OPFS cache, flush scheduler, zstd
  index.ts         # the public command/snapshot surface

features/studio/   # the editor UI
  components/      # canvas host, tool rail, layer panel, brush editor, color
  lib/             # schemas, constants, engine bindings

convex/            # schema, auth, queries, mutations, actions, crons
bench/             # the D30 benchmark: workload, driver, report, runner
docs/design/       # this document, the PRD, the benchmark findings
```

`bench/` imports the engine and is imported by nothing: it is a consumer of the
public surface like `features/studio/` is, and the same D35 rule applies in
reverse — the engine must not know it exists.

**Enforced rule (D35):** `engine/**` may not import React, Next, or anything from `features/`, `app/`, or `components/`. Enforced with an oxlint `no-restricted-imports` rule so it fails CI rather than relying on discipline.

### 10.2 React ↔ engine contract

- The engine exposes **commands** (`beginStroke`, `addLayer`, `setBlendMode`, …) and a **snapshot** subscribed through `useSyncExternalStore`.
- Snapshots are emitted on *structural* changes (layers, selection, tool state) — never on stroke movement.
- **Hard rule:** no React state is touched during a stroke. The engine's rAF loop owns the frame; React learns nothing until `pointerup`.
- Every command is a plain serializable value, so lifting the engine into a Web Worker later (D22) is a transport change, not a redesign.

### 10.3 UI layout (D31)

Full-bleed canvas; floating left tool rail; collapsible right panel stack (Layers / Brush / Color); minimal top bar. Built on the existing shadcn `radix-lyra` primitives and Phosphor icons already in the repo — `sidebar`, `sheet`, `drawer`, `responsive-dialog`, `slider`, `tabs`, and notably `components/ui/pressure-curve.tsx`, which is the curve editor the dynamics graph needs.

### 10.4 Shaders (D34)

WGSL lives in `.wgsl` files under `engine/shaders/`, assembled by a small (~40 line) preprocessor supporting `#include` and `#define`. Blend modes and brush variants are composed from shared snippets.

---

## 11. Testing (D36)

**Criterion for what may be tested directly:** contract stability under the planned rewrites — not function purity, and not whether the contract is externally defined. The Worker migration changes transport, atlas eviction changes storage, and compute-shader brushes change how stamp parameters are consumed rather than how they are computed. Anything all three leave untouched can be tested as a function; anything needing a `GPUDevice` goes through the engine facade, because that is precisely where the rewrites land.

GPU command behaviour stays covered through the engine facade. A narrow exception is the existing renderer-probe harness: deterministic pixel fixtures and stroke-buffer operations that the current command API cannot express may exercise the renderer directly, with companion facade tests for the corresponding public commands. These probes remain test-only and must not introduce fixture-loading production APIs. The blend probe uses this exception for fixed float-colour/alpha layer pairs; facade tests cover blend settings, snapshots, opacity and layer selection.

| Layer | Approach |
|---|---|
| Stable contracts — resampling, stabilizer, dynamics evaluation, tile coordinates, hashing, zstd round-trip, manifest diffing | Bun unit tests, no GPU. Fast iteration during M1 brush tuning, and named assertions on parameters where a golden image would only say "differs". |
| Convex functions — schema, flush path, dedup, GC sweep, retention | Convex function tests. |
| GPU — brush rendering, blend modes, display transform | Playwright golden-image snapshots in headless Chrome over a small set of canonical strokes. |
| Performance | Scripted benchmark against D30: 120 fps at 8192², under 10 ms pointer-to-pixel. Tracked, not gated. `bun run bench`; see [benchmark.md](benchmark.md) for how it measures and what the first run found. |

---

## 12. Milestones

**M1 — Engine vertical slice (no Convex, no UI chrome).**
WebGPU device, one tiled `rgba16float` layer, stamp brush with pressure, Catmull-Rom resampling, stroke buffer, display transform, present. *Done when:* one pressure-sensitive textured stroke draws at 120 fps on an 8192² document. This milestone carries every unknown that can kill the project.

**M2 — Document and layers.**
Layer tree, groups, blend modes (separable subset), opacity/visibility/lock, clipping, masks, the above/below compositor, undo with tiering, pan/zoom/rotate/flip.

**M3 — Persistence and sync.**
Convex schema, OTP auth, anonymous-upgrade, `TileStore` + R2, OPFS cache, coalesced flush, dedup, presigned batch, reactive reload, version restore points, GC cron, previews.

**M4 — Full product surface.**
Brush editor dialog with the dynamics graph, brush library, color picker, document browser, export (PNG/JPEG/`.velura`), share links, non-separable blend modes, plan/quota fields.

---

## 13. Known risks

| Risk | Mitigation |
|---|---|
| WebGPU cannot hit the perf target at 8192² | M1 exists precisely to find this out before anything else is built |
| R2 Class A write budget exhausted as users grow | Coalesced flush plus hash dedup; measured per session in M3, and the `TileStore` interface allows swapping the backend |
| Storage fills with orphaned tiles | Mark-and-sweep cron plus time-decayed version retention, both shipped in M3, not deferred |
| Engine accidentally couples to React, blocking the Worker migration | Lint rule fails CI |
| GPU device loss mid-session | Tiles are in OPFS; rebuild device and re-upload from cache |
| F16 memory pressure on large multi-layer documents | Sparse tiles, atlas eviction to OPFS, and a document-size cap |
| Preview and canvas colors diverge | Preview, export, and present share one display-transform shader |
