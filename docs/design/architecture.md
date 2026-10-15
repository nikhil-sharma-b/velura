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
| Oil with body (thickness, impasto, lighting) | Paint with a height needs a field the fluid brushes do not keep and a light to show it | Fluid paint lives in a wet surface of fields beside the layer's tiles, and settle is the one place fields become pixels (D42, §6.2); a thickness is another field and another term in the glaze (§6.2) |
| Directional flow (gravity, tilt, paint that runs) | The step levels water by height and has no momentum (D42) | A slope is a term added to the height water levels by, in the one compute pass that steps the wash (fluid brushes 19) |
| Rewetting and lifting dried paint | Water would have to lift settled pixels back into the wet fields | Settle is the only writer from the wet surface to the tiles, and the step already lifts a little deposited pigment back while water stands on it (`LIFT`, §6.2). Blotting paint that is still wet is built and stays inside the wet surface (fluid brushes 17, §6.2); lifting dried paint is ticketed (fluid brushes 35) |
| Wet paint kept across sessions | Wet fields saved or synced would be a tile kind of their own, with their own undo, flush and merge | Wet paint is session-local GPU state that dries before every flush (D42, §9.2), so tiles hold only settled pixels and a reopened document is dry |
| The rest of fluid brushes | Each needs its own design | Fluid paint on a layer mask was decided against (fluid brushes 16): water carrying coverage would need a single-channel simulation and a wet mask of its own, for what fluid paint clipped to a layer already gives, so a fluid brush on a mask stays a dry brush (§6.2). Pausing drying is built (fluid brushes 18, §6.2). Ticketed as follow-ups: watercolour preset import (fluid brushes 20), bleed reach for large brushes (fluid brushes 21), and a brush file that carries `fluid`, since there is no brush export yet (fluid brushes 29) |
| Animation timeline | Multiplies document model by frame count | Document owns a layer *stack*; a frame is a stack, so the indirection is one level |
| Selections and transforms | Geometry and UI on top of a settled engine | Tiles carry no selection state; a selection is a mask texture applied at composite time |
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
| D28 | Navigation | Pan, zoom, rotate, flip | Pan+zoom only | Rotation is an ergonomic necessity and flip is a constant working habit. All are view-matrix state, never baked into layer textures. The screen is composited through the view at its own resolution (§6.3). |
| D29 | Eraser and smudge | Eraser: `destination-out` brush. Smudge: a standalone tool with its own stroke path, which keeps each tile of the layer as its dabs first reach it and reads and writes the layer itself as it moves (§6.2) | Smudge as a property of every brush; smudge waiting for the live-brush wave | Smudge was first left out because it reads the layer while writing it, and a normal stroke never does. That turned out not to need live brushes or wet mixing: the filter preview already works copy-then-write, and smudge follows it. Tiles keep one writer, since the smear lands as one stroke's readback like any other. Wet mixing later joined the same path (D41); fluid brushes took a third stroke path of their own (D42). |
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
| D41 | Wet mixing | Any raster brush may be wet: an optional `wet` setting on its rendering, holding a pickup. Wet dabs exchange paint with a tip-space reservoir, optionally kept between strokes through the direct stroke (§6.2); smudge keeps its pixel-behind read, and so does a wet brush with no flow of its own, which is a blender. The mix is an always-on synthetic Kubelka–Munk pigment approximation in one shader function; alpha stays linear and premultiplied. No wetness state | A wet tool beside the brush; mixing in the stroke buffer; a wetness surface with drying | A wet brush is still a brush, so it keeps its tip, its place in the library and the editor, and a stored brush without the setting is dry and unmigrated. One direct stroke owns selections, masks and cancel copies for both tools; wet brushes add a pickup pass into their reservoir. A stroke buffer holds only new paint, so there is nothing in it to drag. With no wetness state, pixels still change only during a stroke: undo, flush, sync and the compositor caches are untouched. Wet deposition, pickup, blenders and smudge share the same pigment mix ([model and provenance](pigment-mixing.md)); there is no per-brush model choice. A wet stroke writes the layer directly, so stroke opacity, accumulation and blend mode cannot apply; they stay on the brush, unread. |
| D42 | Fluid brushes | Any raster brush may be fluid: an optional `fluid` setting on its rendering, never with `wet`, of five numbers (`water`, `drying`, `bleed`, `edge`, `granulation`) and a `water` dynamics target; the rest are engine constants. Its dabs lay water and pigment into a session-local **wet surface** of the active layer, sparse on the tile grid and simulated at half resolution, 128² cells a tile, in at most 64 wet tiles. A fixed step moves it after the pen lifts: water levels by height (overdamped), pigment rides the water and diffuses, evaporation is faster at the damp area's edge, water past what the paper holds blooms, a selection gates every flow. Paint meeting paint is mixed by density-weighted Kubelka–Munk (`addPaint`). Touching wet tiles form a body that dries on a deadline counted in steps and **settles** into the layer's tiles through the same glaze the screen draws with. A clock aims at 120 steps a second within 2 ms of GPU time a frame and skips what a frame cannot afford. Anything that needs final pixels settles first. Undo keeps a GPU copy of the fields per wet stroke; a settle is an ordinary tile entry | Dabs and the step writing the layer's tiles directly; wetness saved and synced with the document; a momentum term in the flow; mixing in linear RGB in the simulation; simulating at full resolution or at quarter | Writing the tiles would give them a second writer that changes them with the pen up, and undo, flush, sync, hashing and the compositor caches all assume pixels stop at a stroke's end; with a wet surface beside them, tiles change only when paint settles and need no new case. Persisted wetness would make wet fields a stored and synced kind of their own for paint that dries in seconds; a document dries before it is saved, so what is stored is what was shown. Momentum produced the prototype's pictures at the prototype's cost, so it bought nothing; the overdamped flow is what keeps a wash's edge fed and pinned, which is edge darkening. Linear RGB was about 60% of the cost and gives grey where yellow meets blue; the pigment mix the wet brushes use (D41) gives green. Full resolution costs four times half (103 µs a tile-step against 26 on the prototype's GPU, 19 tiles in 2 ms against 75) and 3 MB a tile; quarter is a quarter of the cost and shows stair-stepped edges. Half fits 64 wet tiles in the budget (1.5 ms worst case, fluid brushes 13). Because the step and the resolution are fixed, a wash ends in the same pixels on every machine; a slow one only moves it more slowly, and the pen keeps D30. ([PRD](prd-fluid-brushes.md), §6.2, §8) |

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

The tail after `pointerup` (the stamps between the last drawn sample and where the pen lifted, then the composite into the layer) normally runs on the next rAF tick. One exception: if a command is dispatched, or the pen goes down again, before that tick, the engine lands the stroke there and then, so nothing overtakes the stroke the artist already made. A `deselect` sent as the pen lifts would otherwise leave the tail unclipped. Only drawing into the stroke buffer and the layer happens early; presenting still waits for the tick.

**Whether a device measures force** is the sampler's decision, made once for every tool (smudge 07). A mouse, a trackpad and a finger have no sensor: their samples carry a full press with no response curve applied, the brush's pressure mappings are dropped and smudge runs at its strength setting. A pen is the one device that may measure force, but a pen with no sensor still announces itself as a pen and the browser fills in a constant 0.5 for it while it is down. The two are told apart by whether the pressure ever leaves that stand-in: a pen is read as having no sensor while every sample of its stroke sits exactly on 0.5, and as measuring force from the first sample that does not, for the rest of the stroke. The first samples are therefore read on the evidence so far, with nothing held back and nothing redrawn. A pen that lands anywhere else, which a real one does, is trusted from pen-down. A pen with a sensor that happens to land exactly on 0.5 has those opening samples recorded as a full press, and they stay one: once its pressure moves the whole stroke is read as measured, so any of them not yet drawn are drawn as a pen pressed fully rather than as a mouse, and the mark eases from there to the first real reading as the path is resampled. The stroke's opacity, settled once at pen-down, is the brush's own. A pen held steady at any other pressure is never doubted. The sample a pen lifts on reports zero from every device and is not evidence either way. Each stroke decides afresh, since the next may come from another pen.

**The stroke renderer seam.** Turning a stroke's dabs into pixels sits behind one interface in the renderer: a stroke begins, takes dabs a frame's worth at a time, and ends kept or cancelled, answering the region it reached. There are three implementations, each a module of its own beside the renderer. The **buffered stroke** is what every dry brush and the eraser draw with: dabs go into the stroke buffer and land on the layer once (D27). The **direct stroke** reads and writes the surface itself as it goes, which is what smudge and wet brushes draw with (D29, D41). The **fluid stroke** is what a fluid brush draws with: its dabs lay water and pigment into the layer's wet surface and it reads and writes no tile while the pen is down (fluid brushes, below). They are told different things as they open, and the direct stroke takes its dabs in a layout of its own, so the interface fixes the shape of a stroke and not its contents. The renderer keeps what they share: the surfaces, the brush's tip and grain, the selection, and the compositor that shows a stroke in flight. The engine calls the renderer's own commands and not the interface; nothing is tested against the interface itself, since it sits where the planned rewrites land (§9).

The **stroke buffer** is a separate tiled surface covering the stroke's bounding region. Two accumulation modes, selected per brush:

- **Coverage** (`max` alpha): overlapping stamps within one stroke do not darken each other. Airbrush and marker behavior.
- **Buildup** (`over` accumulation): each stamp adds. Wet and dry media behavior.

This is also what makes prediction (D26, deferred) implementable later: discarding mispredicted stamps means discarding from the stroke buffer, not from the layer.

**Smudge (D29)** does not go through the stroke buffer, because a buffer of new paint holds nothing to drag, and nor does a wet brush (D41, below). The path shares everything up to the resampler and then differs:

```
rAF tick, per run of dabs whose neighbourhoods fit 256 px together:
  → copy any tile under a dab that no dab has written to yet (what a cancel puts back)
  → copy the run's region of the layer into the first of two run textures
  → one compute pass, a dispatch per dab: read the region as the dab before left it,
    write it on with each pixel under the dab mixed towards the one a dab's travel behind it
  → copy the region the last dab wrote back into the LAYER
pointerup
  → push undo entry for the region the dabs reached, as for any stroke
```

A render pass cannot sample the texture it renders to, so a dab drawn into the layer is a copy of its neighbourhood and a pass of its own, and it is the pass that costs: a tenth to a sixth of a millisecond, however small the dab. A compute pass may read one texture and write another afresh at every dispatch, so the dabs of a run share one pass and the two copies around it (live brushes 22). The run is as many consecutive dabs as read within one 256 px square, which is a frame's worth of small ones; a dab that reaches further on its own is still a copy and a render pass, and by then a frame holds few. Every dispatch writes the whole region on, dragged or not, since the next dab reads what this one wrote. The compute pass does the render pass's arithmetic, and both work out where a pixel lies in the dab from the pixel: neither interpolates it across the quad nor leaves the dab's edge to the rasteriser, which snaps a quad's corners to its own grid, so a dab is the same through either, bit for bit as the layer stores it (live brushes 27). Nothing in the run grows with the document. Colour uses the shared pigment mix, weighted by contributing alpha; alpha is mixed linearly, so transparency only thins paint, and nothing of the current colour is laid down. It reads and writes the active layer alone, or, while that layer's mask is being painted, the mask alone: a mask is a surface like any other, its coverage in alpha, so the same pass pushes what it hides and shows along the stroke and the layer under it, a vector layer's shapes included, is not touched. A selection limits what a dab writes and not what it reads: the mix is scaled by the mask's coverage of the pixel being written, as a brush dab is, so paint beside the selection is dragged in, a soft edge takes its share, and nothing outside changes; a dab is drawn only within the mask's bounds. The dab's shape is the brush's tip, but its size and strength are the tool's own, kept apart from the brush and remembered beside it: strength is the share of the pixel behind that each dab hands on, dabs are a quarter of a radius apart, and a pen's pressure scales the strength up to the setting and no further, while a device with no force sensor runs at the setting. None of the brush's dynamics reach a smudge dab, though a tip of several frames gives each dab the frame the brush would have drawn. The compositor already reads the active layer and its mask live, so the smear shows without rebuilding a cache. What a cancel puts back is kept tile by tile, each copied on the GPU the first time a dab is about to write to it, so pen-down costs nothing that grows with the document (smudge 06); a cancelled stroke copies those tiles back. The tiles are kept in 2048² pages of 64, and a stroke that outgrows its pages allocates another as it goes: a sanctioned exception to D30's no allocation in the stroke path, once per 64 tiles, taken because the alternative is paying for the whole document at pen-down. Pages are 32 MiB each. Up to four are kept from one stroke to the next (live brushes 20), so a stroke that reaches no more than 256 tiles allocates nothing once a stroke before it has reached as far; a stroke that needed more gives the rest back as it ends and the next such stroke allocates them again, and all but the first go when the document's surfaces are dropped, as on a resize. That is at most 128 MiB held between strokes where it was 32 MiB, and only once a stroke has reached past 64 tiles: a 2048² document has 64 tiles and never holds a second page. No pixel crosses to the CPU while the pen is down (D30).

**Wet brushes (D41)** use the direct stroke's surface copies, tip, selections and cancel backups, with a reservoir that holds premultiplied linear paint in fixed tip coordinates. Two textures are allocated with the renderer at the largest supported direct-dab size; they alternate as pickup reads one and writes the other. At pen-down both are filled with the current brush colour (or the mask's paint value), unless the artist has turned off **Clean brush after each stroke** and the brush holds a picked-up load. Each dab first mixes the layer towards its bristle's reservoir paint by flow times tip and selection coverage, then mixes the reservoir towards the pre-dab layer by pickup times tip coverage. Pickup reads the whole tip neighbourhood, including outside a selection; only deposition is clipped. Zero pickup keeps the original load. A dab whose flow the dynamics graph has taken to zero still loads the bristles, without changing the layer. A brush whose own flow is zero is a different thing: it can never lay, so nothing it carried could reach the layer, and it has no reservoir. It is a blender, and drags from the pixel one dab's travel behind exactly as smudge does, with the brush's own tip, size, pickup and dynamics; the built-in Blender is this brush. Smudge still reads the pixel one dab's travel behind and has no reservoir.

**A wet dab works locally (live brushes 29).** Active-layer wet deposition
uses a bounded attachment instead of loading and storing the document-sized
layer for every dab. Its pre-dab neighbourhood is copied into carry;
deposition fills scratch with mixed paint inside the tip and original pixels
outside it, then copies only the write rectangle back. Pickup-only dabs copy
no paint back. Shape, grain and selection use document coordinates. The
reservoir still passes from dab to dab, and no dab waits for another frame.
That made a large dab some three times cheaper and did not make a scattered
step's sixteen fit a frame: the dab is at the GPU's memory bandwidth, and what
holds the frame is laying a step's dabs along the path (scatter, below).

The existing destination carry has independent scratch levels from 2048² down
to 64². A frame chooses the smallest level that fits its largest read rectangle.
These levels are never filtered or generated mipmaps. They add 10.65625 MiB per
renderer and join the empty warming passes. Write bounds follow rotation and
roundness with a pixel guarding the rim. Reads retain their conservative
origin and filtering border: moving that origin can change floating-point
sampling when a dirty load is later used at a different size.

A procedural, unrotated round dab without paper, whose diameter matches the
power-of-two active reservoir extent, deposits and picks up in two compute
dispatches sharing one pass. Each kernel carries only its own paint work;
both read the incoming layer and reservoir, and write scratch and the next
reservoir separately from their inputs. On power-of-two documents they read
the layer directly, avoiding the neighbourhood copy. Other document sizes
keep carry so normalized texture sampling retains its precision. Shaped or
textured tips, paper, sampled artwork and differently sized loads retain the
render path. No optional GPU feature or additional buffer is required.

Procedural round pickup derives bristle coordinates from the reservoir texel
centre in both render and compute paths, including when the dab and retained
load differ in size. This replaces raster-varying interpolation for that case;
its numerical adjustment is bounded against the previous mapping in the pixel
tests. Textured and shaped pickup retain interpolation. Zero-depth paper,
procedural tip textures and zero-coverage pigment reads are skipped, and a wet
dab never samples the smudge-only pixel behind it. All textures, buffers and
pipelines are allocated ahead of painting; the optimized path adds no readback.

Cancel tiles are kept before a dab writes. Adjacent newly reached tiles in a
document row and backup row share one copy; a kept tile, page row or document
edge ends the run. Restoration retains the individual tile mapping. Stored-paint
comparisons, including retained loads, cancellation, selection, geometry
changes and the scratch fallback, are in `tests/browser/wet-deposition.spec.ts`.

**Colour jitter on wet brushes (live brushes 13).** Colour dynamics tint a fresh clean reservoir **once per stroke**, using the first resampled dab's hue, saturation and lightness offsets scaled by the brush's colour bases. Random targets use the existing stroke seed: successive marks have different loads, and replay with the same seed reproduces the load. Pressure and other sensors are sampled at that first dab too; later values do not recolour the reservoir. This is a jittered load, not uneven bristles or a fresh paint feed. The shared HSL shader adjusts the straight linear working colour and retains its alpha before any pickup. All bristles start with that load, then exchange paint as before: zero pickup keeps its tint, and pickup can exhaust it. Paint picked up from the layer is never adjusted. When automatic cleaning is off, a retained dirty load keeps its colour and extent on the next stroke; colour dynamics apply again only when a clean load is filled. Flow-zero blenders and smudge have no clean load to tint. A small GPU load pass covers only the active reservoir square, uses resources allocated with the renderer, and adds no painting readback. Neutral offsets keep the existing clear load without a shader round trip.

**Sample all layers (live brushes 15).** The shared session setting is off by default and applies to wet brushes, flow-zero blenders and Smudge. When enabled on a colour layer, the stroke samples the visible artwork as it stood at pen-down, linear and premultiplied, at document resolution. The compositor reconstructs the complete stack, including layers above the target, nested group opacity, clipping, blend modes and enabled masks. Canvas paper, display encoding, navigation and selection overlays are excluded. Mask painting continues to sample mask coverage alone.

Pickup and the pixel-behind read use that frozen picture for the entire stroke; newly laid or dragged paint cannot feed back into the source until the next stroke. Deposition reads the live active surface in a separate bounded carry texture, so an empty layer can receive paint without copying the ground into it. Only the active surface is written and backed up for cancellation and undo.

The picture is frozen where the stroke reads it and nowhere else (live brushes 21). The document is divided into 1024 px chunks; before a frame's dabs are submitted, every chunk under a dab's neighbourhood that the stroke has not yet reached is flattened into a page of its own. That is still the picture at pen-down: nothing but the stroke's own layer changes while it is in flight, the stroke changes it only where a dab writes, and a dab reads at least where it writes, so a chunk is always frozen before the stroke has touched it and is never frozen twice. The stack flattened is the one in force as the stroke opened. This is narrower than the whole snapshot it replaces in one respect: that was immune to anything after pen-down, and this relies on nothing else writing while the pen is down. A command that changed another layer's pixels in mid-stroke without cancelling the stroke would show in the chunks not yet reached, under the stack as it was at pen-down. A compositor of its own draws a chunk at a time, in a 1024² window onto the document a whole number of pixels in, where document surfaces are fetched texel for texel as they are for export; its targets are that size and kept between strokes. A single nonempty full-opacity normal layer without a mask or clipping is copied a chunk at a time instead, with nothing shaded. Pages are 8 MiB each; a stroke gives its pages back when it ends and up to sixteen (128 MiB) are kept for the next, so a stroke allocates only past those, a page at a time as cancel pages are (the same sanctioned exception to D30, taken for the same reason: the alternative is paying for the document at pen-down), and no texture the size of the document is held: the 512 MiB snapshot of ticket 15 is gone. A stroke reaching every chunk of an 8192² document still holds 512 MiB until it ends. Enabling sampling initializes up to four pages (32 MiB, or fewer on a document with fewer chunks), the window compositor's 8 MiB flat target, and the existing destination carry before the command resolves (live brushes 26). Creating a texture alone leaves its first GPU use on the first dab, so the pages and carry are filled with transparent scratch pixels; the artwork is still frozen only when a stroke reaches it. The carry initialization uses a temporary 32 MiB target, destroyed after submission, and never touches a retained brush load. Further pages are still allocated as the stroke reaches them, with the same sixteen-page retention limit. The measured opening frame is recorded in [benchmark.md](benchmark.md). The destination carry’s base level is 32 MiB, with another 10.65625 MiB of bounded deposition scratch levels, allocated with the renderer; with the setting off the original carry serves both reads and no extra copy is issued. The setting changes cancel a stroke in flight and do not alter a retained brush load. Reload resets the setting to off.

**The wet spacing floor (live brushes 10).** A wet brush's dabs follow its own spacing, as a dry brush's do, but never closer than **four pixels or a sixteenth of the dab's radius, whichever is more**; a blender is held to the same. The floor is what holds wet brushes to D30. A wet dab does not batch: it is a copy and a draw into the layer and, when it picks up, a second draw into the reservoir, and on the benchmark's GPU a dab costs between a tenth and a sixth of a millisecond however small it is, so the frame can afford a number of dabs and not a number of pixels. At four pixels a hand moving at the benchmark's speed lays about eight dabs in a 120 Hz frame, a little over a millisecond of drawing. Past a 128 px brush the copy and the draws begin to grow with the dab, so the floor grows with the radius and the dabs in a frame fall. Before this the floor was one pixel, and a small brush with close spacing laid some fifty dabs in a frame and showed its paint half a frame late. The floor is measured against the dab actually drawn, so a brush that dynamics shrink is held to the floor of its smaller dab. Smudge's spacing is its own and is unchanged: a quarter of its radius, never under a pixel. It was measured against this floor and not given it (live brushes 19). A smudge under 16 px in radius lays dabs closer than four pixels and at a radius of 4 px misses D30 on an 8192² document, but a dab that drags from the one behind it needs its neighbours within about a third of its radius, or the pixels of the smear are handed on an uneven number of times and it comes out as a comb. Spacing could not buy a small smudge its frame; a cheaper dab did (live brushes 22): the dabs of a frame now share a compute pass, and a 4 px smudge on an 8192² document is level with smudge at its default size and with a dry brush. A blender's dabs are drawn the same way. It keeps smudge's spacing where the floor would be wider, so that it does not comb (live brushes 23), and with its dabs sharing a pass that no longer costs it the frame. The numbers are in [benchmark.md](benchmark.md).

The copy a direct dab reads from is one texture as wide as the largest dab, allocated with the renderer as the reservoir is: 32 MiB held whether or not anything is smudged, in exchange for a stroke that never allocates one as its dab grows. The two textures a run of dragging dabs is worked in are 256² and allocated with it, a mebibyte between them, and so is the buffer the run's dabs are described in. The only texture a direct stroke may still create with the pen down is a page for its cancel tiles; the benchmark counts textures and buffers created while the pen is down to hold it to that. Bind groups are made on the first dab after the tip, the grain or the selection is replaced, not per dab.

The active reservoir square is sized from the first dab inside those preallocated textures and remains fixed for the stroke. Size, angle and roundness dynamics transform where each bristle samples and lays paint; they never resize or resample stored paint. Multi-frame tips gate each dab's exchange. Grain scales deposition only, using the same `grainBite` function as dry brushes and the dab's `grainDepth` dynamics; pickup into the reservoir stays ungrained. **Brush load between strokes (live brushes 14).** Clean brush after each stroke is on by default. Turning it off keeps the picked-up load and its active square for the next stroke, including across layer and tool changes. The studio shows dirty once a dab has picked up paint (including transparency); this is a conservative indication of pickup, not a comparison of texels against the initial colour. The registry command `brush.clean` discards that load. Selecting a colour (including the eyedropper), applying or editing a brush (including tip size), enabling automatic cleaning, and crossing between mask coverage and colour painting clean it. The next wet stroke loads the current colour. A blender or smudge does not consume or alter a retained wet load.

Undo and redo of a stroke restore layer tiles only and leave the brush load as it is; the studio states this beside the control. Cancelling a stroke restores the load and extent from before pen-down, including a previously clean brush. A third reservoir texture, allocated with the renderer, holds that cancel copy; only the active square is copied, only when the brush is dirty. No per-stroke texture allocation or painting readback is added. A structural undo that crosses between mask coverage and colour painting still cleans the brush. The toggle and load are session state, never brush/document storage or sync data: a reload starts clean with automatic cleaning on. Dropping the renderer's document surfaces also clears its load. No pixels are read back while the pen is down (D30). Stroke opacity, accumulation and blend mode still belong to the buffered stroke. The eraser remains dry.

**Scatter on wet brushes (live brushes 12).** A wet brush that scatters throws its dabs by the throws the same brush makes dry: the placer is seeded with the stroke, draws from its own stream, and the dynamics graph's `scatter` target scales the amount per dab, so under one seed its dabs are offset from the path as the dry brush's are, in the same order. **They are laid one at a time along the path (live brushes 29).** Where the dry brush lays a spacing step's `count` dabs from the point the step begins, the wet brush lays one every `count`th of the step, each thrown from where the pen has got to and given the pen's state there. A dry step's dabs are instances in one draw; a wet dab is a pass of its own that moves its whole neighbourhood, sixteen 512 px dabs in one frame cost that frame three to five milliseconds however they are arranged, and the frame that opened a stroke was one of them (see [benchmark.md](benchmark.md)). Laid along the step, the dabs of a frame are the few an unscattered wet brush lays. **Scattered dabs share the one reservoir, in the order drawn.** They go to the direct stroke one after another and each makes the same exchange an unscattered dab does: it lays from the reservoir as the dab before it left it, then loads the reservoir from the paint it landed on. The reservoir is in tip coordinates, not canvas ones, so where a dab lands does not move its bristles; a brush thrown from red into blue brings red to the blue dab by dab, as a real loaded brush dabbed about would. Giving each dab a clean share of the load was the alternative and was not taken: it would need a reservoir per dab of the count, sixteen 2048² textures at the most, and paint picked up by one dab could never reach the next, which is what pickup is for. A blender does not scatter. It has no reservoir and drags from the pixel a dab's travel behind, and a thrown dab has no dab behind it, so a blender with a scatter section keeps to the path and draws as if it had none. Scatter count multiplies the dabs along a length of path, each still a copy and a draw of its own, so **a thrown dab is held to the wet spacing floor as any wet dab is**: a brush laying four dabs a step lays one every quarter of its step, and never closer than four pixels or a sixteenth of its radius, which over a length of path is the dabs the floor times the count allowed (live brushes 12) with no frame handed a step's worth at once. A blender does not scatter and its spacing is not divided.

**What a stroke draws into is kept warm (live brushes 24).** On the benchmark's machine a large texture that no pass has drawn into for between one and two seconds is slow the next time one does: some 20 ms for a layer of 8192² and 5 ms for 2048², paid once and then gone, whatever the pass draws. That is the frame a stroke opens in after any pause, for any brush. At 8192² drawing into another texture meanwhile does not help; a pass that draws nothing into the same texture does. So while the artist is at the canvas the renderer is asked every 800 ms, unless a frame is waiting to draw or a stroke is in flight, for one pass each that loads and stores and draws nothing into the surface being painted, the stroke buffer with its coverage depth, the two reservoir textures, and the bounded wet-deposition scratch levels (live brushes 29). The warming starts when a pen or pointer comes over the canvas, ahead of the pen going down, and when a frame draws; it stops thirty seconds after the last of either, and a hidden page is not warmed. It changes no pixel and reads none back, and nothing is allocated for it but the command buffer. A direct stroke's carry and cancel pages are only ever copied into and are left alone: what remained of the opening frame with them cold was within its noise. A stroke that samples all layers reads more as it opens, and what it reads goes cold the same way (live brushes 31): with a wet brush or smudge in hand and sampling on, and not while a mask is painted, the same pass is given to every visible layer besides the one painted and the masks over them, to the four frozen pages the next stroke takes first, and to the target a chunk of the picture is flattened in. The pages are only ever copied and carry the render-attachment usage for this alone. A view of each page is made per warming, besides the command buffer. No other brush is asked for those passes. When this runs is `engine/gpu/warm-keeper.ts`, which knows nothing of the GPU; what it draws into is the renderer's `keepWarm`.

**Fluid brushes (D42, fluid brushes 01 to 13).** Any raster brush may carry an optional `fluid` setting on its rendering, beside `wet` and never with it: five numbers in [0, 1], `water`, `drying`, `bleed`, `edge` and `granulation`. A brush with neither is unchanged and unmigrated. Its strokes go through the fluid stroke, the third stroke renderer, into a **wet surface** belonging to the active layer and not into the layer's tiles:

```
pointerdown
  → copy the wet fields of every wet tile into a texture of their own, GPU to GPU (what a cancel puts back, and what undoing the stroke restores)
rAF tick, pen down:
  → for each dab, give every tile it reaches a wet tile slot, if it has none,
    and, for a brush that floods, its eight neighbours one each where there are slots to spare,
    and push back the drying deadline of the body that tile is in
      with every slot taken: draw and pour the dabs so far, then settle the body due first to make room
  → one instanced pass drawing the frame's dabs into the laid targets: water and dampness, and pigment by flow and the stroke's opacity
  → one compute pass (the pour) mixing what was laid into the wet fields
  → composite: the wet fields glazed onto the active layer's pixels, inside the layer
pointerup
  → push one wet stroke entry holding the pen-down copy: the paint is wet, no tile has changed and nothing is read back
rAF tick, any tile wet (the clock):
  → how many steps are owed, at most two, and how many of them 2 ms of GPU time affords
  → post a task for them, so they run after this frame is presented
that task:
  → the steps: a compute pass each over every wet tile, between two fences that time them
  → for the bodies whose deadline has passed at a step (settle):
      per wet tile: copy the layer's tile aside, glaze the wet fields onto it back into the LAYER
      free their slots
      push one settle entry for those tiles, read back as any stroke's are, and drop the wet stroke entries
  → composite, unless a stroke's own frame is about to
```

The wet surface is sparse on the document's own 256 px tile grid. A **wet tile** holds a slot in each of three fields, simulated at **half resolution**, 128 × 128 cells to a tile: water (standing water, the paper's dampness, and the water that crossed two of the cell's faces), suspended pigment, and the pigment the paper has taken, each pigment premultiplied by its density. Alpha in the pigment fields is density and not coverage. There are 64 slots (`WET_SLOTS`, the one place the limit is said), laid out eight to a row in `rgba16float` textures with rows enough for them and no more, 1024² at 64, and each field is held twice, since a step reads one copy and writes the other. With the two targets a batch of dabs is laid into, that is 60 MiB, allocated when a brush is first made fluid, not by a stroke. The paper is a mebibyte more, made with the renderer. A byte per tile of the grid tells the shaders which slot a tile holds. A tile a flooding brush's dab reaches brings its eight neighbours with it, the **ring**, so that a bloom can cross into a tile no dab touched (below).

Dabs are batched as the buffered stroke's are: an instance is one dab in one wet tile, a dab over a border is an instance for each tile it reaches, cut to its slot, and where a cell lies in the dab is worked out from the cell, so the instances either side of a border lay the same paint. The dab is the brush's own (fluid brushes 10): its tip, turn and squash, scatter and colour jitter, with the feather of a plain round tip held to at least a cell, and a `water` dynamics target for the share of the brush's water it carries. A selection clips a dab in the pour and not in the dab pass (below). Dabs are not added to the wet fields directly: a batch is drawn into two targets of its own, and a compute pass, the **pour**, mixes that into the fields with the pigment mix, so yellow laid onto wet blue is green in the cell it lands in. This is the cost of batching dabs and still mixing them as pigment: a blend state can only add. The pour runs over every wet tile and not only those under the dabs, so a frame of painting costs a pass that grows with the wet area. It is what a fluid frame costs over a dry one, with the wet surface in the present pass: the dabs themselves are not, and twelve times the dabs into one wash cost the same frame (fluid brushes 10, [benchmark.md](benchmark.md)). Water is poured to a depth and not by the dab: the brush fills a cell to its `water` as a share of the most a cell holds (`FLUID_MAX_WATER`), however many of its dabs overlap there, and takes none from a cell that already stands deeper, so how wet a mark is does not turn on how closely its dabs are spaced. One dab lays the brush's whole depth at its middle (fluid brushes 12), so a single tap of a flooding brush floods, and blooms; laid at half, as it first was, only dabs two deep did. Water laid whole runs nowhere to even a stroke out, so a stroke dries as its dabs laid it: a little thinner along its sides and at its ends, which lie under fewer dabs than its middle.

**The step.** The simulation is one compute pass over every cell of every wet tile (`engine/shaders/fluid.ts`), reading one copy of the fields and writing the other. A neighbour over a tile's border is found through the slots map, so a body of water is one sheet, and a cell in a tile with no slot reads as dry paper. The rules are the prototype's:

- *Water levels.* Water crossing a face follows the difference in the height of the water's surface either side, which is the water's depth and a little of the paper's relief under it (`RELIEF`), so water sits a little deeper in the paper's valleys; no cell gives more than a fifth of its water across one face in a step. Both cells work out the same number for the face they share, so no water is made or lost. This is the overdamped model.
- *Water stays on damp paper.* It moves only between two damp cells. A dab makes paper damp, and so does water standing deeper than the paper holds on the cell next door, which is a bloom (below); otherwise the edge of a wash stays where the brush put it.
- *Water evaporates,* by an amount a step set from the brush's `drying`.
- *Pigment rides the water.* The share of a cell's water that crosses a face carries the same share of its suspended pigment. Pigment also diffuses between two cells that both hold water, at the brush's `bleed`, which is held low enough that a cell never gives away more pigment than it has.
- *Pigment deposits,* slowly while water stands on it, faster in the paper's valleys than on its peaks by the brush's `granulation`, and completely once a cell's water is gone; a little lifts back under water.

Two quantities of paint meeting are combined by `addPaint`, beside `mixPaint` in the pigment shader: their densities add, and the colour is the Kubelka–Munk mix of the two weighted by density. The rates are the whole wet surface's, and are those of the brush last put to it; a brush that dries more slowly pushes every body's deadline back to match. Giving each body its own brush's rates is fluid brushes 22, which is open.

Water evaporates faster near the edge of the damp area (fluid brushes 06), and that is the whole of edge darkening: the water that levels outward to replace it carries pigment with it, by the rule that pigment rides the water, and the wash dries with a darker rim. How near a cell is to the edge is read from the dampness of eight cells, the four next door and the four `EDGE_REACH` cells out, so the rim that dries first is a band and not one cell. The brush's `edge` scales how much faster, up to `MAX_EDGE`, and at zero a wash dries flat. Nothing is damp but what is wet now, so the rim follows the wash's own outline and not that of dried paint under it. A cell past the document counts as being as damp as the one that looks, so a wash that runs off the canvas has no rim along the canvas's edge; a tile with no slot is dry paper, so a body settled early at the wet tile limit leaves a rim where it met the paint still wet (fluid brushes 25 is open to hide it). The edge only ever speeds drying, so a body's deadline does not count it.

**Blooms (fluid brushes 08).** The paper holds water to a depth, `FLUID_HOLDS`, three fifths of the most a cell holds. Dry paper takes up dampness from a damper cell next door by `ABSORB` of the difference a step, scaled from nothing where that cell's water stands at what the paper holds to all of it `SPILL` deeper. That is the only way the damp area grows after the brush has gone, and with the two rules above it is the whole of a bloom: the damp edge moves out, water follows it, and pigment rides the water. A brush at `water` of 0.6 or less never fills a cell past what the paper holds, levelling raises water by no more than a little of the paper's relief and evaporation only loses it, so its stroke keeps the edge the brush gave it; a brush above that floods, and its stroke ends wider than it was laid. Water let into a wash that is nearly dry runs out over the damp paper, leaves the middle light and piles the pigment at the edge of where it ran. The front advances as water levels into it, which is slow: a few cells before the water is back to what the paper holds, more at a slow `drying`, and bounded by the cell as bleed is (fluid brushes 21).

A bloom may leave the tiles the dabs reached, so a brush that floods allocates those with their ring. A brush that does not takes no ring: its water cannot leave the paper its dabs made damp, and its washes are stepped, joined into bodies and counted against the wet tile limit exactly as before. Water from a flooding brush that runs through a wash already wet may reach a tile of it whose neighbours no ring covered, and stops at their border. A ring tile is a wet tile like any other: it joins its tile's body, is stepped with it, and is freed with it. Rings that touch join their bodies, so two flooded washes stay two bodies only with a dry tile between their rings, three tiles clear of each other. A ring tile is taken only when a slot is free; with none, the tile is dry paper until a dab reaches it, and a bloom stops at its border. Most of a ring is cells with no water on them or beside them, and the step leaves such a cell after reading its own water and its neighbours': its paper dries out and it takes what pigment it held, which is what the full rules work out for it.

Settling does not read the fields to learn where paint went (D30). A body no flooding brush has painted into holds paint only where its dabs reached: its ring is skipped, and the box given to history is the dabs' own. A body one has painted into may hold paint anywhere in its tiles, so all of them are settled and read back and the box is theirs. Which slots are so is kept with a copy of the fields and restored with it. The front follows the cell grid: it is a cell hard, stepped along a diagonal at ordinary zoom, and notched where the paper's relief holds it back a cell. The built-in brushes ticket did not soften it (below); that is fluid brushes 30, which is open.

**The constants and the built-in brushes (fluid brushes 12).** What a brush does not set is an engine constant, the same for every fluid brush. They were set on the engine from pictures read back through its facade, not with a pen; a pass with a pen is fluid brushes 31.

| Constant | Value | What it is |
|---|---|---|
| `FLOW` | 0.2 | Levelling: the share of a difference in the water's height that crosses a face in a step |
| `FACE_SHARE` | 0.2 | The most of its water a cell gives across one face in a step |
| `FLUID_MAX_WATER` | 2 | The most water a cell holds, and the depth a brush at full `water` fills it to |
| `FLUID_HOLDS` | 1.2 | What the paper holds: a brush whose depth is past it floods, which is `water` above 0.6 |
| `SPILL` | 0.4 | How much deeper than that water stands before dampness creeps from under it at its full rate |
| `ABSORB` | 0.1 | The share of a damper neighbour's dampness dry paper takes up in a step |
| `FLUID_RELIEF` | 0.03 | Paper relief: the water the paper's height is worth, valley to peak |
| `FLUID_DAMP_STEPS` | 50 | Steps for damp paper to dry out once its water has gone |
| `DEPOSIT` | 0.0003 | The share of suspended pigment the paper takes in a step |
| `LIFT` | 0.001 | Lift-back: the share of deposited pigment that lifts while water stands on it |
| `EDGE_REACH` | 6 cells | The edge band: how far out a cell looks for the edge of the damp area |
| `MAX_EDGE` | 12 | How many times faster the very edge dries than the middle, less one, at full `edge` |
| `MAX_BLEED` | 0.05 | The most of its pigment a cell trades with a neighbour in a step, at full `bleed` |
| `MAX_GRANULATION` | 6 | How much faster a valley takes pigment than paper of middle height, less one, at full `granulation` |

The first eleven are in `engine/shaders/fluid.ts` and the last three, which scale a brush's settings, in `engine/gpu/fluid-stroke.ts`. All but `MAX_GRANULATION` are as the tickets that built them left them. It came down from 16: there, at a `granulation` of three tenths, a peak took no pigment at all and a valley nearly six times its share, so the paper's coarsest grain took a wash over in blotches eight pixels across and left too little pigment afloat to gather at the rim. The rim was looked at and left: at `edge` of a half it is a dark band a few pixels wide along a stroke's sides, strong and not thin, and at one it leaves the middle pale. It is weaker round a stroke's ends, which are laid with less pigment to gather.

The library opens with four fluid brushes, in a set of their own after the wet ones (`FLUID_BRUSHES` in `engine/brush/presets.ts`): a watercolour wash, a watercolour detail brush, an ink wash and a water brush. Each is brush data with `fluid` set and nothing more. The three that lay paint carry no more water than the paper holds, so their marks stay where they are put. The water brush has no flow, so it lays water and no pigment, and carries all the water there is: over a wet edge it leaves damp paper for the paint to run into, and let into a wet wash it blooms. The library draws its preview by its water, as it draws a blender's by its pickup.

**What is left of the bloom front.** It is not softened; fluid brushes 30, a follow-up, is to. The front is a cell hard and follows the cell grid, stepped two pixels at a time along a diagonal, as the edge of any fluid stroke is: it is the simulation's resolution showing through the glaze's filter between cells. Letting dampness creep from the cells at a cell's corners as well as its faces was tried and changed nothing that could be seen, so it was not kept.

**Selections (fluid brushes 09).** A selection is masking fluid: it clips what a dab lays and stops what flows, so paint pools against its edge and does not cross it. The simulation reads the selection's own texture, the one every other stroke is clipped by, and keeps no copy. A cell's coverage is the mean of its document pixels', one filtered read at its middle. The pour lays a cell that share of a batch's water, dampness and pigment, and fills it to that share of the brush's depth, so a feathered edge takes paint in proportion. In the step the selection is in every gate: how open a face is to what crosses it is the coverage of the cells either side, multiplied, and that scales the water crossing it, the dampness a bloom carries over it, and the pigment diffusing through it. Nothing else is needed for paint to pool: paper the selection leaves out is never damp, so its edge is an edge of the damp area and dries first as a wash's own rim does (fluid brushes 06). With nothing selected a single texel of full coverage is bound in the selection's place, and every read finds it, so the shaders carry no switch.

The fields hold a cell to two document pixels and are shown filtered between cells, so paint held in a cell at the selection's edge would show a pixel past it. The glaze function therefore shows no wet paint on a pixel the selection leaves out altogether, and since the screen and settle both call it, what dries is still what was shown. That is a yes or no and not the coverage again: the pour has already taken the selection's share.

Wet paint is held in by the selection it was laid under, and the glaze reads the selection as it now is, so the two must never differ: *paint dries before the selection changes.* The engine gives the renderer its selection through one function (`holdSelection` in `engine/index.ts`), which dries whatever is wet first, as the selection it was laid under left it. A selection made dries the paint before its own step is recorded, so the settle is the step under it. It covers a selection made or let go, inverted, feathered or moved, and the outline a selection tool's drag previews through the same texture, so the paint dries as the drag begins to outline something. The selection commands are not in `WET_PASSTHROUGH` for the same reason, and there they wait for the settle to be recorded. Undo and redo never meet wet paint under another selection: no selection step is recorded over wet paint, and undo with no wet stroke left dries first (§8).

**Paper (fluid brushes 07, 15).** Every fluid brush in a document paints on the document's paper: a procedural height texture (`engine/gpu/paper.ts`), 1024 px square in `r8unorm`, a texel to a document pixel, seeded so it is the same paper in every session and wrapping at its edges so it tiles across the document from its corner. It is not a brush's grain (D24). The document chooses one of three papers (fluid brushes 15), each value noise at a few sizes, weighted, and spread about the middle height by a contrast:

| Paper | Seed | Octaves (cell px: weight) | Contrast |
| --- | --- | --- | --- |
| Hot press | 271828 | 4: 0.5, 2: 0.3, 1: 0.2 | 1.2 |
| Cold press | 12345 | 8: 0.5, 4: 0.3, 2: 0.2 | 1.8 |
| Rough | 314159 | 16: 0.45, 8: 0.3, 4: 0.15, 2: 0.1 | 3 |

Cold press is the default and the paper fluid brushes 07 made, to the byte, so the constants below and the built-in brushes were tuned on it; the other two were tuned by eye. The constants are the same for every paper: a rougher paper's relief is its contrast. The choice is `paper` in the document's structure, beside the guides, written only when it is not Cold press, so a tree saved before papers and one on Cold press compare the same, and one this client does not know opens on Cold press. It is therefore saved, synced and restored with a version as the tree is, and choosing one (`setPaper`) is one step that undoes. It is not a wet passthrough, so wet paint settles on the paper it was laid on before the paper changes, and paint already settled keeps the grain it settled with. The texture is made once, with the renderer, which owns it, and a paper is written into it in place when the document's changes, so nothing that binds it is rebuilt; each paper's heights are made the first time they are asked for and kept. The studio's picker is among the document's controls, beside export; brush previews are a 2D canvas and read no paper. It is read in three places, each by `paperHeight` in `engine/shaders/wet.wgsl`, at a document pixel and unfiltered:

- *The step* reads it once per cell, at one document pixel of the cell, for two rules. The paper takes suspended pigment at `DEPOSIT` times `1 + g · (1 − 2h)`, never below nothing, where `h` is the paper's height and `g` the brush's `granulation` scaled up to `MAX_GRANULATION`: at full granulation a valley takes pigment many times faster than paper of middle height and a peak takes none until its water has gone. Bleed keeps the pigment in the water even, so what a valley takes early is pigment its neighbours do not get later, and the wash dries speckled. At zero the rate is the same everywhere and the fields stay smooth. And the relief in the water's level, above, which does not speckle a wash by itself.
- *The glaze* reads it per pixel it shades. A cell is two document pixels, which is the size of the paper's finest grain, and the height changes from each pixel to the next, so the fields cannot hold the grain: `glazeWet` multiplies the density of deposited pigment by `1 + PAPER_GRAIN · (1 − 2h)` at the document point it is asked for. Suspended pigment is not modulated; it is still in the water. This grain shows at any granulation, since it is the paper's and not the pigment's.
- *Settle* is the glaze, so it reads the same texel the screen did at the same document point, and nothing changes as paint dries.

Granulation is one of the rates of the wet surface, with drying, bleed and edge: those of the brush last put to it, kept with a copy of the fields and restored with it.

**The clock (fluid brushes 13).** The step is fixed and so is the simulation's resolution, so a wash ends in the same place on every machine. The clock is a frame loop of its own in the engine, asked for only while a tile is wet: with nothing wet no step runs and no frame is requested. It aims at 120 steps a second and runs at most two in a frame, which is one at 120 Hz and two at 60, and gives the simulation a budget of 2 ms of GPU time a frame: a frame runs only the steps it can pay for, and a step it cannot is skipped and not made up, so paint moves and dries more slowly in wall time and ends in the same pixels, since a body's deadline is a count of steps. A step dearer than a whole frame's budget still runs every few frames on budget saved for it, so paint always dries; a step that fits is paid for by its own frame and no frame banks time. What a step costs is measured as it runs, by a fence before a frame's steps and one after, with nothing read back. A fence resolves some time after the work it waits on, longer than a step, so the clock reckons a tile-step from the slope of a least-squares line across measurements of different sizes, older ones counting less, and starts from the benchmark's 24 µs. The steps run in a task the frame posts once it is presented, not inside it: submitted in the frame, they sat on the GPU's queue ahead of the stroke's own work and the pen's pixel waited for them. The simulation gives way and the pen does not (D30). The arithmetic is `engine/gpu/fluid-clock.ts`, pure of GPU and DOM. Over 64 wet tiles worst case a step is 1.5 ms on the benchmark's GPU and reckons at 1.75 in the engine, so a 75 Hz frame runs one and skips the second it owes, and paint moves at three fifths of its speed (see [benchmark.md](benchmark.md)). The engine takes two commands for tests, `advanceFluid` (run N steps) and `dryNow`, and an option that leaves the clock to `advanceFluid` alone, which is how a browser test runs an exact number of steps without waiting on one.

**Bodies.** Wet tiles that touch, corners included, are one **body** of water. A body shares one drying deadline, counted in steps and pushed back by every dab that lands in it: the steps water of the depth the brush fills to takes to evaporate at the brush's `drying`, and its dampness to fade after that. When the deadline passes the whole body settles and frees its slots together, so no tile is ever settled beside a neighbour still wet. The deadline is a count, never a GPU readback (D30); one that came early is paint that dried early, since settling lands whatever the fields hold. The bookkeeping (`engine/gpu/wet-tiles.ts`) is pure of GPU: `touch`, `surround` (the ring), `refresh`, `expired`, `due`, `crowding`, `release`. **Dry now** settles every body at once.

**Pausing drying (fluid brushes 18).** A toggle of the session, off whenever a document opens and never stored, keeps a wash workable until the artist dries it. Paused, the simulation is told nothing evaporates (`simRates` keeps the brush's rate for when drying goes on), and a body whose deadline passes **holds** instead of settling: it keeps its slots and its water, and the step passes it by, so held paint costs no step time and the clock stops once everything wet is held. A dab that lands in a held body pushes its deadline back as any dab does, and it moves again until that passes; a blot takes from it and leaves it held, since a blot pushes back no deadline. The step writes one copy of the fields from the other, so a held slot is kept alike in both: copied across as it is held, and after a pour or a blot, which write it into one. Turning the pause off gives every body the deadline of the deepest water at the current rate, since none evaporated, and drying goes on from where it stopped; nothing settles as it is turned off. Undo that puts back fields kept while paused, with the pause off, gives them the same time. A tile a ring takes in, with no dab landing there, does not count as painted into when the wet tile limit orders held bodies. Dry now while paused settles everything and leaves drying paused. Toggling is not a history step, and dries nothing (`WET_PASSTHROUGH`).

**The wet tile limit (fluid brushes 05).** The fields are allocated for `WET_SLOTS` tiles and never grow, and the brush never refuses to paint. A dab that reaches a tile with every slot taken settles one body early to make room (a ring tile never does, though the slots a ring took are slots a later dab finds gone): the body due to dry first, and the lower slot of two due together. A body the tile would join, by an edge or a corner, or one a dab of the same frame has landed in, is being painted into and is chosen only when there is no other, so a single wash wider than the limit settles itself and carries on in what is freed. With drying paused, held bodies go before any still moving, the one a dab last reached longest ago first, since it is the paint the artist is done with; a paused session fills the slots sooner, and with them the rim fluid brushes 25 is open for. The dabs waiting to be drawn are drawn and poured first, so no dab is dropped and what settles is what was on screen. It is a settle like any other: one entry over the tiles it wrote, the wet stroke entries dropped, and the stroke in flight taking its pen-down copy again. Like a body whose deadline passes under the pen, it allocates and its tiles are read back for history after the frame: a sanctioned exception to D30, taken once for every 64 tiles a wash outgrows the limit by and never for a dab that finds a slot. A 512 px brush across an 8192² document outgrows it in every stroke and with scatter misses the bar; that is fluid brushes 33, which is open. Where a wash settles itself, the paint laid after meets dried paint at a tile border and does not bleed back across it. Fluid brushes 13 kept the limit at 64: its worst-case step is 1.5 ms, inside the budget with room for a pour, and a flooding stroke along a row, three slots a tile with its ring, holds about twenty tiles before the first body settles. More slots would not buy a large brush its reach; a coarser simulation under it would (fluid brushes 21).

**Blot (fluid brushes 17).** A brush with `rendering.blot`, never beside `wet` or `fluid`, lays nothing: it takes water and suspended pigment out of the wet surface, and tiles keep their one writer. It is a fluid stroke in a blot mode. Its dabs are drawn as a paint dab is, into the pigment target, but each gives how strongly it takes at a cell (its opacity and flow, through the graph) and the target's blend multiplies one less that into what the batch's other dabs leave, so a batch holds the product and is the same however a frame batches it. A compute pass in the step's layout (`blotMain`) then scales each cell's standing water and dampness by one less `blot.water` times that strength, and its suspended pigment by one less `blot.pigment` times it, each clipped by the selection's coverage as the pour is. Deposited pigment is left to `LIFT`. A blot dab only reaches tiles that already hold a slot (`WetTiles.slotAt`): it takes none, so it never settles a body to make room, and it pushes back no deadline and puts none of its own rates to the wash. A cell blotted dry stops moving, and with it the colour bleeding there. A blot dries nothing either at pen-down or before; over dry paper, paint that has settled, a mask, or a layer that is not the wet one, there is nothing wet under it and it changes nothing. The engine answers `wetUnder` for the point under the pen, a tile at a time, and the canvas shows a crossed cursor for a blot brush where nothing is wet.

**Glaze.** Paint of some density over what is beneath it is a transparent film: its amount is `1 − exp(−density)` and its colour is mixed with what is beneath by the shared pigment mix (D41). One shader function does this (`engine/shaders/wet.wgsl`), deposited pigment first, by the paper's grain at that document pixel, and suspended pigment over it, filtering each field between cells and looking each cell's tile up on its own, so a tile's border is filtered across like any other cell's. The screen and settle both call it, at the same document point, which is the whole of the rule that nothing changes as paint dries: the last wet frame is the picture read back after the settle, to the rounding of a half float. A settle, by deadline or by Dry now, is one history entry over the tiles it wrote, and one undo removes that passage (§8). A cancelled stroke puts the wet fields back as they were at pen-down, from the copy it took then: a layer it found dry is dry again and was never touched, and a wash it was laid into is that wash, at the step it had reached. The simulation flips which copy of the fields is current, so what shows wet paint binds it again after a step; the bind group for each copy is kept, so a step makes none and rebuilds no compositor cache. The glaze is not a branch in the blend and present shaders: a layer with wet paint is drawn by pipelines of its own (`wet-layer.wgsl` in place of `dry-layer.wgsl`), made the first time a layer is wet, so a layer with none runs no wet code (D34). The fluid stroke's own pipelines are likewise compiled when a brush is first made fluid, not with the renderer. Tiles keep one writer: undo, flush, sync and hashing see only settled pixels. The wet surface is session-local GPU state, never a tile kind, stored or synced.

**Forced settle (fluid brushes 03).** Wet paint is only ever on the active layer and only in the session, so anything that needs the layer's pixels to be final dries everything wet first, as Dry now does, and then acts on what dried: the settle is its own history entry, beneath whatever the action records. What forces one:

- *A stroke that is not fluid or a blot:* a dry brush, a wet brush (D41), the eraser, smudge, and any brush but a blot on a layer mask, at pen-down, before its first dab; and a click of the magic wand, which reads the layer. Picking the tool up dries nothing; using it does.
- *A command,* unless it is one of those that leave wet paint alone (`WET_PASSTHROUGH` in `engine/index.ts`): settings of the brush, the tools and the pen, the view, guides, a layer's own name, lock, opacity, blend mode, clipping, visibility and mask switch (they apply to wet paint as to dry, §6.3), and undo, redo, Dry now and the test clock, which deal with wet paint themselves. The list is of what is let through, so a new command dries by default. That covers a layer switch and everything else that moves the active layer, a filter, a transform, a flip, clearing or removing a layer, a mask chosen to paint on, and every command that changes the selection (above). Velura has no fill command yet; one would dry by the same default. The command waits for the settle's entry to be recorded before it runs, so it finds the paint in history as it would a stroke's.
- *A flush* (§9.2): an explicit save and the idle flush, which waits for the settle's entry before it sends. With drying paused the idle flush does not dry: it sends what has settled, and the paint held wet is in no tile (fluid brushes 18). A version restore dries too, since it replaces the layers.
- *Export:* a `.velura` backup and an SVG in the engine. An exported image is read with `readPixels`, which leaves wet paint wet so that tests may read a wet frame, so the export dialog sends Dry now ahead of it.
- *The tab going hidden:* a hidden tab is given no frames, so the clock would hold its paint wet for as long as it was away. The engine listens for `visibilitychange` itself.
- *Leaving the canvas:* `dispose` dries while it still has a device, and keeps the runtime until that entry is read back, saved and, with a cloud, flushed, as it does for an unsent stroke (§9.2).

A fluid brush on a layer mask, and the eraser, ignore `fluid` and paint as the brush otherwise is: no wet tile is allocated, and the stroke is a step as the pen lifts.

### 6.3 Compositor

Cached above/below (D19):

- `belowCache` — everything under the active layer, flattened.
- `aboveCache` — everything over the active layer, flattened.
- Per frame: `belowCache` → active layer (+ stroke buffer) → `aboveCache`.

Caches rebuild when layer selection, order, visibility, opacity, blend mode, or clipping changes — not when pixels change on the active layer. Clipping masks and groups are resolved during cache construction.

Ticket 09 correction to D19: an above cache is valid only when all contributing upper layers use Normal. Other modes depend on the changing backdrop and cannot be represented by one RGBA image independent of the active layer (Overlay is a direct counterexample). In that case the below cache still stays fixed, but the renderer composites the active layer and replays the upper stack each frame into a reusable float surface. This path costs one pass per upper layer; the Normal-only path remains independent of layer count. A future transfer-function cache could optimize selected modes, but must preserve this backdrop dependency.

Sharp-zoom 01: the compositor draws in a *target space* — a target size and the affine from a target pixel back to the document. The screen's target is the window, through the view; the artwork's is the document at its own size, through the identity, and is what export and group thumbnails read. Layers, masks and the stroke buffer stay document surfaces, sampled through the view as they are flattened; the caches, stage frames, group and clip-coverage caches belong to a target and live in it. The present pass then fetches the caches texel for texel and samples only the active layer and the stroke through the view, as before. The caches therefore also rebuild when the view moves, once per frame however many navigation steps led to it — a draw per layer at the window's size, measured in `docs/design/benchmark.md`. Painting still never rebuilds one. Wet paint (fluid brushes, §6.2) is only ever on the active layer, so the caches are not involved in it: wherever the active layer's pixels are read to be composited, by the present pass or by the pass that blends it into a frame, the wet fields are glazed onto them first, before the layer's opacity, blend mode, mask and clipping, and with nothing wet a one-texel placeholder is bound and the read is as it was. This is what lets anything drawn from geometry rather than pixels be drawn at the screen's resolution. Sharp-zoom 02 does that for vector layers: the renderer keeps each one's scene as GPU meshes beside its pixels, and the screen compositor, wherever it resamples, draws the layer from those meshes into a target-space surface through the view (stencil and cover, multisampled, a chunk at a time), redrawn when the scene or the view moves. That surface then composites exactly as the layer's pixels would — blend modes, masks, clipping, groups — and an active vector layer is composited into the frame rather than read by the present pass. The pixels remain the document's truth: export, thumbnails, rasterising and sync read them, and edits still re-rasterise them.

### 6.4 Blend modes

Generated pipeline per mode (D20), from shared `.wgsl` snippets expanded by a small include/define preprocessor. Pipelines are cached per renderer and created on first use. The layer stack is isolated: transparent document pixels do not blend with the display-only canvas background. Opacity scales premultiplied RGBA before source-over composition; colour is unpremultiplied only inside the blend operation. Add clamps the channel sum at one; Subtract clamps backdrop minus source at zero. Separable modes first (Normal, Multiply, Screen, Overlay, Darken, Lighten, Color Dodge, Color Burn, Hard Light, Soft Light, Difference, Exclusion, Add, Subtract); non-separable modes (Hue, Saturation, Color, Luminosity) as a second batch, since they need the full HSL/luminosity math.

### 6.5 Layer thumbnails

Every row in the layer list shows a live picture of that layer (post-v1 03). A thumbnail is a convenience, so it follows the same rules as everything else near painting (D30).

- **When they are drawn.** A change only marks thumbnails stale: a stroke marks its layer and the groups around it; an undo or redo marks what it wrote; a structural change marks everything shown. Stale thumbnails are drawn together once the document has been quiet for 300 ms and no stroke is in flight — never on a frame of drawing. A canvas that has just appeared (a row mounting, a preview opening) is drawn at once, unless the pen is down.
- **How they are drawn.** On the GPU, from the textures the compositor already holds, into a small canvas the row owns. No pixel is read back. Each thumbnail pixel reads a dense grid of taps and keeps the *strongest* coverage among them with the average colour, so a line a few pixels wide on a large canvas stays a line rather than averaging away.
- **What they show.** Each thumbnail is framed on the layer's own work, not the whole canvas. Where the work is comes from what the engine already knows as pixels arrive — stroke regions, restored and undone tiles — trimmed to the tiles history's index says still hold something, so erasing shrinks it again.

What each kind of row shows, decided rather than inherited:

| Row | Thumbnail |
| --- | --- |
| Raster layer | Its own pixels, unmasked and unclipped, over a checker so transparent and white differ. |
| Group | Its visible children flattened as the group draws them, without the group's own opacity, blend or mask; a folder badge marks it. |
| Mask | A second thumbnail beside its layer: white reveals, black hides. A new mask is all white, not empty. Outlined while it is being painted. |
| Clipped layer | Its own pixels, with a clip mark before the thumbnail: what it holds, not what the clip lets through. |
| Empty | A dashed outline with no picture. "Empty" is history's index holding no tiles for it, so a layer erased back to nothing is empty again. |
| Hidden | The picture faded; a slashed eye when hidden by its own eye, no eye when hidden by a group around it. |

Pointing at a row (hover, or a long press on touch) dims every other layer on the canvas to 15%, and hovering a thumbnail opens a larger preview beside it. The dimming is how the canvas is looked at, like the view (D28): an export ignores it, and a stroke clears it.

---

## 7. Brush engine

### 7.1 Brush definition

A brush is serializable JSON — no code, no shaders.

```
Brush
  ├─ shape:     tipTextureId?, hardness, roundness, angle, spacing
  ├─ grain:     grainTextureId?, scale, depth, movement (canvas-space)
  ├─ rendering: blendMode, accumulation: "coverage" | "buildup", flow, wetEdge, wet?: { pickup } (D41), fluid?: { water, drying, bleed, edge, granulation } (§6.2)
  ├─ scatter:   positionJitter, angleJitter, sizeJitter, count
  └─ dynamics:  Modulator[]
```

### 7.2 Dynamics graph

```
Modulator = {
  source: "pressure" | "tilt" | "tiltDirection" | "velocity" | "direction" | "random" | "strokeProgress"
  target: "size" | "opacity" | "flow" | "angle" | "roundness" | "grainDepth" | "scatter" | "pickup" | "hue" | ...
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
- Storage tiering (D21): the most recent tiles stay uncompressed in RAM; older ones are deflated in place (`CompressionStream`, so no dependency); the oldest spill to OPFS. Bound by bytes, not by step count.
- Hashing a readback's tiles and deflating or inflating one are done on a worker (`engine/doc/tile-worker.ts`), and the copy out of the readback buffer is taken a millisecond at a time: a thrown stroke changes hundreds of tiles, and the artist is into the next stroke before they are put away (see the benchmark document, live brushes 28). Where the worker cannot start, the same work is done on the main thread.
- An entry's "after" pixels are read back off the GPU once, on pen-up, and its "before" pixels come from a per-surface index of tile hashes the engine keeps in step with every upload, composite, duplicate and undo. That readback is the second sanctioned exception to D30, alongside `readPixels`: asynchronous, once per stroke, never inside a frame of drawing.
- **A wet stroke entry (D42, fluid brushes 04).** A fluid stroke changes no tile, so its entry names none. At pen-down the wet fields of every wet tile are copied on the GPU into a texture of the stroke's own, three layers of `rgba16float` with only the wet slots in it, along with what the engine knows of those tiles off the GPU: which tile holds which slot, each body's deadline, the clock, and the rates the wash runs at. When the pen lifts that copy is the entry. Undo copies the fields as they are, for redo, and puts the pen-down copy back; the wash is wet and the simulation carries on from there. Redo puts back the copy taken at the moment of the undo, not the pen-down one. The copy is a texture allocated at pen-down, one a stroke and sized by the wet tiles alone: a sanctioned exception to D30's no allocation in the stroke path, taken because the copy is the entry and outlives the stroke, so there is no pool to draw it from; keeping a pool of them under the byte budget is fluid brushes 34, which is open. Nothing is read back for any of it (D30), and a wet stroke entry is not a commit: the tile index did not move, so nothing is flushed. A stroke that is cancelled restores its own pen-down copy and pushes nothing, and undo with a fluid stroke in flight cancels it, as with a direct stroke. A blot stroke (fluid brushes 17) is a wet stroke entry too, labelled as one, and pushes nothing when it reached no wet cell. A settle under the pen makes the stroke take its copy again, since the first one holds paint that is now in the layer; so a stroke that settled a body to make room is undone, and cancelled, only back to that settle (fluid brushes 24 is open).
- **The copies have a byte budget of their own,** 256 MiB of GPU memory by default: some 400 KB a wet tile, so a full copy at the wet tile limit is 24 MiB. Past the budget the oldest copy goes and its entry with it, from wherever it is in the stack: a wet stroke entry names no tile, so taking one out leaves the entries either side of it consistent. The redo copy an undo takes counts too.
- **A settle entry.** A settle, by deadline or forced, is one entry over the tiles it wrote, read back and recorded as a stroke's is. It takes every wet stroke entry out of history, undone or not, in the same turn of the recording queue as it is pushed: their copies describe fields that no longer exist. A settle that wrote no tile has no entry: Dry now forgets the wet stroke entries itself, but a body off the canvas that dries by its deadline leaves them (fluid brushes 23 is open). Restoring wetness when a settle is undone is not done; a passage that has dried stays dry.
- **Undo with wet paint and no wet stroke entry left behind it** dries everything first and then undoes that settle's entry. That is the case after one body settles while another is still wet, and after the oldest copies have gone over budget. So undo goes back stroke by stroke through what was painted since anything last dried, and passage by passage before that, and nothing is left half-undone. A step that leaves wet paint alone, a layer's opacity say, may lie between two wet stroke entries, and is undone in its turn with the paint still wet. Redo never dries. Redo of a wet stroke entry onto a layer that is no longer the one being painted dries it there at once, since wet paint is only ever on the active layer.
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
brushes      { ownerId, name, set, order, definition }        // built-ins ship in the client
brushTextures{ ownerId, name, width, height, data }           // one byte per texel
brushUse     { ownerId, docId, brushId, radius }              // what a document was left with
```

Built-in brushes have no rows (25). They ship in `engine/brush/presets.ts`, which is
what makes them indestructible: a table of copies would need a `builtin` flag, a guard
on every write, and a migration each time a preset changed. `set` and `order` are the
artist's arrangement; a set is a name on a brush rather than a row, so an empty set is
one nothing is shelved in. Texture bytes sit on the row rather than in R2 because a tip
is kilobytes and is read by every session that paints with the brush — the R2 split
(D11) is for megabyte-scale immutable pixels.

`tiles` as independent rows (D13) is what avoids OCC write conflicts under rapid autosave and lets a client subscribe to exactly the tiles that changed.

### 9.2 Write path

1. Stroke completes → tiles marked dirty → **written to OPFS immediately** (this is the durability guarantee).
2. Flush trigger: 30 s idle, `visibilitychange` to hidden, `beforeunload`, explicit save, leaving the canvas in-app (the engine finishes the flush before its GPU device goes), or reopening a document whose cloud copy is behind this device's or has no preview. Nothing flushes while a version preview is on trial (not yet kept) or while a reopened document's tiles are still loading in the background — both would send something that is not the document; the flush is owed and sent once they end. **A flush dries wet paint first** (D42, §6.2): tiles hold only settled pixels, so paint still wet would be missing from what is written and sent. An explicit save, the idle flush, the tab going hidden and leaving the canvas each settle everything wet into its layer before anything is hashed, except that the idle flush leaves paint wet while drying is paused (fluid brushes 18) and sends what has settled; the settle is a stroke-shaped commit, written to OPFS as in step 1, and a document reopened after it shows the dried paint. Paint that was wet when a tab was killed outright, with no flush, is lost with the session.
3. Client hashes dirty tiles, asks Convex "which of these hashes do you not have?" (dedup — unchanged and duplicate tiles cost nothing).
4. Convex action mints **one batch** of presigned PUTs for the missing hashes.
5. Client uploads to R2 in parallel with bounded concurrency; retries are safe because content-addressed PUTs are idempotent.
6. Client calls one Convex mutation to upsert the changed `tiles` rows, delete the rows for slots this device held and no longer does (an erase, undo or restore — named explicitly, never inferred from a slot's absence, per §9.5), and bump the document version.
7. Client uploads a flattened, display-transformed preview PNG (D38) under a new immutable R2 key, then commits that key on the document row. A duplicate shares the captured key, so later source uploads cannot change its preview. The orphan sweep collects unreferenced preview objects after the usual grace window.

### 9.3 Read path

1. Subscribe to `documents` + `layers` + `tiles` for the open document.
2. For each tile hash: OPFS cache hit → decode; miss → GET `r2/tiles/<hash>` (public, immutable, `Cache-Control: immutable`, no signing) → store in OPFS → decode.
3. Tiles stream in by viewport proximity, so the visible region resolves first.

Because hashes are content-addressed, the cache is never stale and never needs invalidation.

### 9.4 Versions and GC

- Restore points are written at each flush and retained on a time decay: hourly for 24 h, daily for 7 d (D18).
- A nightly Convex cron does mark-and-sweep (D17): walk all live `tiles` rows plus all retained `versions` snapshots, then delete R2 objects not in that set **and older than a 7-day grace window**. The grace window prevents deleting a blob a slow client is still uploading against.

### 9.5 Multi-device conflict

v1 is single-user, multi-device, last-writer-wins at tile granularity, with a soft "this document is open on another device" indicator driven by Convex presence. Removals follow the same rule: a device only deletes the tile row for a slot it held itself and has since emptied. The per-tile row model means the eventual upgrade to real merge (D7) is a change to the write path, not to the storage model.

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

features/library/  # sign-in and the document library: the account-facing UI,
  components/      # and the only place the Convex client is mounted, so the
  lib/             # studio keeps working with no backend and no account

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
