# Velura — Product Spec

**Status:** Ready for implementation
**Date:** 2026-09-05
**Companion document:** `docs/design/architecture.md` (the *how*; this document is the *what* and *why*)

---

## Problem Statement

Artists who paint digitally are tied to a specific machine. Professional tools — Photoshop, Procreate, Fresco — are native applications: the work lives on the device that made it, and moving between a desktop at home, a laptop while travelling, and a borrowed machine means exporting flattened files, emailing them to yourself, and losing layers, history, and brush settings in the process.

The browser should have solved this, but the painting tools that run there are toys. They have a handful of fixed brushes with no way to author new ones, a flat list of layers with two or three blend modes, and 8-bit sRGB blending that produces muddy, fringed gradients any working artist notices immediately. They are demos of what a canvas element can do, not tools anyone finishes a piece in.

So an artist today chooses between a real tool that is trapped on one machine, and an accessible tool that is not good enough to work in. There is no option that is both.

## Solution

Velura is a professional raster painting application that runs in the browser and keeps your work in the cloud.

You open a link on any machine with a modern browser, sign in with a code sent to your email, and your documents are there — every layer, every brush, exactly as you left them. You can start painting before you sign in at all; the work follows you into your account when you create one.

The tool is built to be worked in, not demoed. Brushes are stamp-based with textured tips and paper grain, and every brush parameter can be driven by pen pressure, tilt, velocity, or randomness through a curve you edit yourself — the same model that makes Procreate's and Fresco's brush libraries expressive. Layers support groups, masks, clipping, and the full set of blend modes. Everything composites in 16-bit float linear light, so opacity falloff and soft edges behave the way paint does rather than the way sRGB arithmetic does.

It renders on WebGPU, targeting 120fps on an 8192×8192 canvas with under 10ms from pen movement to pixel — the latency figure that determines whether a tool feels alive or feels like a recording of itself.

---

## User Stories

### Getting started and identity

1. As a curious visitor, I want to start painting immediately without creating an account, so that I can judge whether the tool is any good before committing anything to it.
2. As a curious visitor, I want my anonymous work preserved when I decide to sign up, so that I do not lose the drawing that convinced me to sign up.
3. As a new user, I want to sign in with a code emailed to me, so that I do not have to invent, store, or remember another password.
4. As a returning user, I want to stay signed in across sessions, so that opening the app is one click rather than a login ritual.
5. As a user on an unsupported browser, I want a clear explanation of what is missing and which browsers work, so that I understand the problem is my browser rather than a broken site.
6. As a user, I want to sign out from a shared machine, so that my work is not accessible to whoever uses it next.

### Documents

7. As an artist, I want to create a document at a chosen pixel size, so that I can start work sized correctly for its destination.
8. As an artist, I want to pick from common presets when creating a document, so that I do not have to remember print and screen dimensions.
9. As an artist, I want to see all my documents as a grid of visual thumbnails, so that I can find a piece by recognising it rather than by reading filenames.
10. As an artist, I want to rename a document, so that my library stays navigable as it grows.
11. As an artist, I want to duplicate a document, so that I can explore a variation without endangering the original.
12. As an artist, I want to delete documents I no longer want, so that my library and my storage quota reflect only work I care about.
13. As an artist, I want my document to open on any machine with everything intact, so that where I am sitting does not constrain what I can work on.
14. As an artist, I want the document to open quickly with the visible area appearing first, so that I can begin work before the whole canvas has finished loading.
15. As an artist working on a large piece, I want to know how much of my storage quota I am using, so that I am not surprised by a limit.

### Painting

16. As an artist, I want my strokes to appear under the pen with no perceptible delay, so that the tool feels like an instrument rather than a remote control.
17. As an artist, I want stroke width to respond to pen pressure, so that I can vary a line the way I would with a real brush.
18. As an artist, I want stroke opacity to respond to pen pressure, so that I can build up tone gradually.
19. As an artist, I want the brush to respond to pen tilt, so that I can shade with the side of a pencil the way I do on paper.
20. As an artist, I want brush behaviour to respond to stroke velocity, so that fast and slow marks differ in character as they do with real media.
21. As an artist, I want stamps spaced evenly along the stroke regardless of how fast I draw, so that fast strokes do not gap and slow strokes do not blob.
22. As an artist, I want a smoothing control for my strokes, so that I can draw clean long curves despite an unsteady hand.
23. As an artist, I want to set smoothing to zero, so that I retain full control when I want raw, unfiltered marks.
24. As an artist drawing quickly with a high-frequency stylus, I want every sample captured, so that my curves are smooth arcs rather than visible polygons.
25. As an artist, I want brushes with textured tips, so that pencil, charcoal, and dry media read as those materials rather than as tinted blur.
26. As an artist, I want paper grain to stay fixed to the canvas as I paint over it, so that the surface feels like a sheet of paper rather than texture dragged along with the cursor.
27. As an artist, I want overlapping stamps within one stroke not to darken each other on brushes where that is wrong, so that a single marker stroke reads as one flat mark.
28. As an artist, I want overlapping stamps to accumulate on brushes where that is right, so that wet media builds up as I work over an area.
29. As an artist, I want an eraser, so that I can remove paint without switching documents or undoing good work.
30. As an artist, I want the eraser to use the same brush shapes and dynamics as painting, so that erasing is as expressive as marking.
31. As an artist, I want to pick a colour from the canvas with an eyedropper, so that I can sample and reuse colours already in my piece.

### Colour

32. As an artist, I want a colour picker that behaves perceptually, so that moving a slider changes the colour by the amount my eye expects.
33. As an artist, I want to enter a hex value, so that I can match a colour specified elsewhere exactly.
34. As an artist, I want to save colours to a palette, so that I can hold a piece to a deliberate scheme.
35. As an artist, I want recently used colours kept to hand, so that I can move between a working set without re-picking each one.
36. As an artist, I want soft brush edges and low-opacity strokes to blend without dark fringing, so that gradients and glazes look the way they do in physical media.
37. As an artist on a wide-gamut display, I want saturated colours rendered to the display's full gamut, so that my work looks as vivid as the screen allows.
38. As an artist, I want exported files and thumbnails to match what I saw on the canvas, so that I am not colour-correcting after the fact.

### Brushes

39. As an artist, I want a library of ready-made brushes covering common media, so that I can work immediately without configuring anything.
40. As an artist, I want to adjust brush size and opacity quickly while painting, so that I am not opening dialogs mid-stroke.
41. As an artist, I want to open a full brush editor, so that I can shape a brush precisely to what a piece needs.
42. As an artist, I want to choose the tip shape and hardness of a brush, so that I control the fundamental character of its mark.
43. As an artist, I want to choose and scale the grain texture of a brush, so that I control the surface it appears to be painting on.
44. As an artist, I want to map any input — pressure, tilt, velocity, direction, randomness — onto any brush parameter, so that I can build expressive behaviour rather than choosing from fixed presets.
45. As an artist, I want to shape each of those mappings with an editable curve, so that response feels right to my hand rather than merely linear.
46. As an artist, I want to see brush changes previewed as I make them, so that I can dial a brush in by eye instead of by trial and error.
47. As an artist, I want to save a brush I have made, so that I can reuse it across pieces.
48. As an artist, I want to duplicate an existing brush as a starting point, so that I can make a variant without rebuilding it.
49. As an artist, I want my custom brushes available on every machine I sign into, so that my tools travel with my work.
50. As an artist, I want to organise my brushes, so that a growing library stays usable.

### Layers

51. As an artist, I want multiple layers, so that I can revise parts of a piece independently.
52. As an artist, I want to reorder layers, so that I can change what sits in front of what.
53. As an artist, I want to rename layers, so that a complex document stays comprehensible.
54. As an artist, I want to hide and show layers, so that I can check my composition without destroying anything.
55. As an artist, I want to set layer opacity, so that I can tune an element's strength without repainting it.
56. As an artist, I want to lock a layer, so that I do not accidentally paint on finished work.
57. As an artist, I want blend modes on layers, so that I can build shading, glows, and colour effects non-destructively.
58. As an artist, I want to group layers, so that I can organise and transform related parts of a piece together.
59. As an artist, I want to apply blend mode and opacity to a whole group, so that a set of layers can be treated as one element.
60. As an artist, I want layer masks, so that I can hide parts of a layer reversibly rather than erasing them.
61. As an artist, I want to paint into a mask with any brush, so that masking is as nuanced as painting.
62. As an artist, I want clipping masks, so that I can shade and texture inside an existing shape without spilling over its edges.
63. As an artist, I want to delete and duplicate layers, so that I can iterate freely.
64. As an artist, I want performance to stay constant as I add layers, so that a complex document is as responsive as a simple one.

### Navigation

65. As an artist, I want to pan and zoom the canvas, so that I can work on fine detail and judge the whole.
66. As an artist, I want to rotate the canvas, so that I can draw comfortable strokes at the angle my wrist prefers.
67. As an artist, I want the rotation to snap near cardinal angles, so that I can return to square without fiddling.
68. As an artist, I want to flip the canvas horizontally, so that I can check my composition with fresh eyes — the standard habit for catching drawing errors.
69. As an artist, I want flipping and rotating to be view-only, so that my exported file is never affected by how I happened to be looking at it.
70. As an artist, I want to fit the canvas to the window in one action, so that I can get back to an overview instantly.

### History

71. As an artist, I want to undo my last action, so that a mistake costs a keystroke rather than a repaint.
72. As an artist, I want to undo many steps back, so that I can retreat from a direction that stopped working.
73. As an artist, I want to redo, so that I can compare two states before committing.
74. As an artist, I want undo to stay fast deep into a long session, so that history does not degrade as the piece progresses.
75. As an artist, I want a long history without the tab running out of memory, so that I do not have to restart to keep working.
76. As an artist who has closed a document, I want to restore an earlier version of it, so that I can recover work I painted over yesterday.
77. As an artist, I want restore points to be labelled by time, so that I can find the version I mean.

### Saving and sync

78. As an artist, I want my work saved continuously without pressing anything, so that I never lose a session.
79. As an artist, I want my work safe even if the tab crashes or the browser is force-quit, so that a mishap costs nothing.
80. As an artist, I want to keep painting through a brief network outage, so that connectivity problems do not interrupt my work.
81. As an artist, I want to see whether my work is saved locally, syncing, or fully synced, so that I know when it is safe to close the machine.
82. As an artist, I want to close the tab and reopen elsewhere with my work present, so that moving machines requires no ritual.
83. As an artist, I want a warning if the same document is open on another device, so that I do not unknowingly work against myself.
84. As an artist, I want syncing to happen in the background without stuttering my strokes, so that saving never costs me a mark.

### Sharing and export

85. As an artist, I want to export a flattened PNG, so that I can post or print the finished piece.
86. As an artist, I want to export a JPEG, so that I can share a smaller file where quality permits.
87. As an artist, I want to export a full-fidelity file with all layers, so that I have a real backup outside the service.
88. As an artist, I want to import a file I previously exported, so that I can move work back in and continue.
89. As an artist, I want an unlisted link to a read-only view of a piece, so that I can show work in progress without giving anyone edit access.
90. As someone sent a share link, I want to view the piece without an account and on any browser, so that seeing someone's work does not require signing up or switching browsers.
91. As an artist, I want share links to show a preview image when pasted into chat or social apps, so that sharing looks intentional.
92. As an artist, I want to revoke a share link, so that I control who can still see a piece.

### Reliability

93. As an artist, I want the app to recover if the graphics device is lost, so that a driver hiccup does not cost me my session.
94. As an artist, I want a clear message when something fails, so that I know whether to retry, reload, or stop.
95. As an artist, I want failed uploads retried automatically, so that transient network problems resolve without my involvement.

---

## Implementation Decisions

The architecture document holds the full decision record with rationale (40 entries, D1–D40). This section states the decisions that shape observable product behaviour. Where a decision is contested or where the obvious alternative fails, that is noted.

### Scope

- **Raster only in v1.** Vector layers, live fluid brushes, animation, selections and transforms, smudge, PSD interop, and realtime collaboration are all out (see Out of Scope), but the document model reserves room for each.
- **WebGPU is a hard requirement.** No WebGL or Canvas2D fallback. Unsupported browsers get an explanatory wall, not a degraded editor. Share links remain viewable everywhere because they serve a static rendered image rather than running the engine.
- **Desktop with a stylus is the target.** Pointer Events carries pressure, tilt, and twist uniformly, so a tablet is usable, but iPad-specific work is not in scope.

### Rendering and colour

- All compositing happens in **16-bit float, linear light, premultiplied alpha**. A single display-transform pass applies the transfer function and maps to Display P3 or sRGB when presenting.
- **Export, thumbnails, and the canvas share one display-transform implementation.** Divergence here is the standard cause of exports that look washed out relative to what the artist saw, and it is prevented structurally rather than by testing for it.
- The compositor pre-flattens everything **below** the active layer and everything **above** it into two cached textures, so a frame costs three texture reads regardless of layer count. Caches rebuild on structural change — selection, order, visibility, opacity, blend mode, clipping — not when pixels change on the active layer.
- **Blend modes are generated as one pipeline per mode** rather than a single branching shader. Separable modes ship first; the non-separable four (Hue, Saturation, Color, Luminosity) follow, since they need full luminosity math.

### Painting

- Strokes render into a **separate stroke buffer** and composite into the layer once, on pen-up. This is what makes per-stroke opacity correct — without it, overlapping stamps within one stroke darken each other on every brush, including those where that is wrong — and it makes an undo entry one snapshot per stroke rather than per stamp.
- Each brush declares its accumulation mode: **coverage** (stamps take maximum alpha; marker and airbrush behaviour) or **buildup** (stamps accumulate; wet and dry media). One flag, and without it a large part of a realistic brush library is unreproducible.
- Input is sampled through `pointerrawupdate` with coalesced events into a ring buffer, consumed once per animation frame. A 240Hz stylus emits roughly four samples per frame; reading only the latest turns curves into visible polygons.
- The path pipeline is: stabilizer (pulled-string) → Catmull-Rom interpolation → **arc-length resampling** at spacing × size → per-stamp dynamics evaluation → instanced quad draw. Arc-length resampling is what decouples stamp spacing from drawing speed.
- **Tip textures sample in stamp space** (rotating and scaling with the stamp); **grain samples in canvas space** (fixed to the paper). Sampling grain in stamp space makes the texture swim under the cursor — the most common error in brush implementations, and immediately visible to an artist.

### Brushes

- A brush is **serialisable JSON with no code or shaders in it** — shape, grain, rendering, scatter, and a list of dynamics modulators. User-authored shaders are excluded as a security and compile-cost problem.
- A **modulator** binds a source (pressure, tilt, tilt direction, velocity, direction, randomness, stroke progress) to a target parameter (size, opacity, flow, angle, roundness, grain depth, scatter, hue) through an editable curve, a range, and a mix mode. This graph is the difference between a real tool and a fixed-parameter toy, and it is the reason the brush editor is a full tabbed dialog rather than a slider popover.
- Evaluating the graph is a **pure function** from brush plus stamp context to stamp parameters — deliberately, because it is the highest-value thing in the system to test.
- The repository already contains a pressure-curve editor component; the dynamics UI is built on it rather than on a new widget.

### Document and storage

- A document is a **tree of layers** (groups and raster layers) over a canvas capped at 8192×8192. Masks are single-channel surfaces stored with the same machinery as raster layers.
- Pixels live in **sparse 256×256 tiles** in 16-bit float. A tile exists only once painted into; an absent tile reads as transparent. A single full-resolution layer at this depth would be 134MB, so tiling is what makes multi-layer documents possible at all, and it makes undo and upload costs proportional to what actually changed.
- Tiles are **content-addressed by hash and immutable** — painting produces a new tile under a new hash. This yields deduplication, a local cache that can never be stale, idempotent retryable uploads, and version restore points that pin tiles they share with the live document.
- Tiles serialise as **raw 16-bit float plus zstd**. Lossless, no colour-space round-trip, and PNG cannot represent linear float content without a custom transfer function.

### Persistence and sync

- **Split by access pattern:** small, reactive, queried data lives in Convex tables (users, documents, layers, per-tile index rows, versions, brushes); large immutable blobs live in Cloudflare R2. This split is also what keeps the project inside both free tiers, where Convex offers roughly a gigabyte of metered-egress file storage against R2's ten gigabytes with no egress charge.
- The tile index is **one row per tile**, not a manifest embedded in the document row. Independently mutable rows avoid write conflicts under rapid autosave, paginate on load, and let a client subscribe to exactly which tiles changed.
- **Local write, coalesced upload.** A completed stroke writes to local storage immediately — that is the durability guarantee — and uploads are batched on idle, tab-hide, page-unload, or explicit save. The binding constraint is not storage but R2's write-operation budget: one upload per flushed tile, so naive per-stroke syncing would exhaust the monthly free allowance within low hundreds of sessions.
- Before uploading, the client asks the server which hashes it does not already have. Unchanged and duplicate tiles cost nothing.
- Presigned upload URLs are **minted in one batch per flush**, and tile index rows are updated in one call per flush, to stay within the backend's function-call budget.
- Reads are cache-first against local storage keyed by hash, falling back to a public immutable fetch. Tiles stream **by viewport proximity**, so the visible region resolves first.
- **Orphaned blobs are collected by a nightly mark-and-sweep** over live index rows and retained versions, deleting unreferenced objects older than a grace window. Reference counting was rejected as error-prone under concurrent writes; doing nothing was rejected because content-addressed writes orphan a blob on every edit and would fill the quota.
- **Version retention decays with time** — hourly for a day, daily for a week. Restore points are cheap in themselves; their real cost is the tiles they pin against collection.
- v1 is **single-user, multi-device, last-writer-wins per tile**, with a soft indicator when a document is open elsewhere.

### History

- Undo is **session-scoped and local**. An entry is a list of tile hashes, not pixels, so it shares storage with the sync cache at no additional cost.
- History is **bounded by bytes rather than by step count**, since stroke sizes vary by orders of magnitude: recent entries stay uncompressed in memory, older ones compress, and the oldest spill to local disk storage.
- Cross-device history is served by **version restore points**, not by syncing the undo stack — expensive to implement and not something users expect.

### Application structure

- The engine is a **framework-free module** with no React, Next, or DOM-framework imports, enforced by a lint rule in CI rather than by convention. An engine that imports React cannot later move to a Web Worker, and that migration is the planned answer to main-thread contention.
- React communicates with the engine through **commands in and snapshots out**. Snapshots are emitted on structural change only. **No React state is touched during a stroke** — the engine's frame loop owns the canvas until pen-up. Every command is a plain serialisable value, so the Worker migration becomes a transport change rather than a redesign.
- Layout is a full-bleed canvas with a floating tool rail and a collapsible right-hand panel stack, built on the shadcn primitives and icon set already established in the repository.
- Authentication is **email one-time-code**, with anonymous local documents that migrate into an account on sign-up. No passwords, no per-provider OAuth registration.
- User plan and quota fields exist in the schema from the first migration, with no billing code behind them. Retrofitting quota accounting across a distributed tile store afterwards is substantially harder than carrying two unused fields.

### Performance

- The target is **120fps at 8192×8192 with under 10ms pen-to-pixel**. It functions as a design constraint rather than an acceptance threshold: it forbids full-stack compositing per frame, any CPU readback in the interactive path, and allocation inside the stroke loop.

---

## Testing Decisions

### What makes a good test here

A good test in this codebase asserts on **what an artist would observe** — the pixels that end up on the canvas, the state the UI reports, the bytes that reach storage — and never on how the engine arrived there. Tile counts, cache-rebuild timing, internal data structures, and the shape of intermediate buffers are all implementation detail; a test that names any of them will fail during ordinary refactoring while catching nothing an artist cares about.

This matters more than usual here because the engine's internals are expected to churn: the Worker migration, atlas eviction strategy, and compute-shader brushes will all rewrite internals without changing behaviour. Tests written against internals would have to be rewritten by each of those changes, which in practice means they would be deleted.

Concretely, a good test drives the engine the way the UI does — issue commands, then read back the composited image or the reported state.

### Seams

There is **no prior art in this repository**: no tests, no test runner configured in the package manifest, and no existing seams to prefer. Every seam below is new, and they were chosen to be as few and as high as possible.

**1. The engine facade — the primary seam.**

The engine's public command-and-snapshot surface. Tests issue commands and assert on the composited output and on reported state. Everything beneath — brush dynamics, path resampling, the stabilizer, the tile grid, the layer tree, undo, blend modes, the compositor — is covered *through* this seam rather than addressed directly.

This is deliberately the **only** seam for client behaviour. It requires a real graphics device, so these tests run in headless Chrome driven by a browser automation harness. That is slower than testing pure functions in isolation, and it is the right trade: it is the only way to catch the failures that actually matter, which are visual.

**Note on a reversal:** the architecture document proposes additionally unit-testing the pure layer — resampling, dynamics evaluation, tile coordinates, hashing, compression round-trips — on the grounds that most bugs live there. This spec does not carry that recommendation forward as a separate seam. Those functions are reached through the engine facade, and giving them their own seam would mean two sets of tests over one behaviour, with the lower set pinning internal signatures that the Worker migration is expected to change. The exception is **compression and hashing round-trips**, which are tested directly: they are a genuine boundary with an externally-defined contract — bytes in, identical bytes out — rather than an internal implementation step, and a silent corruption there destroys artwork rather than merely rendering it wrongly.

**2. `TileStore` — dependency injection, not a new seam.**

The storage interface the architecture already requires so the blob backend can be swapped. Substituting an in-memory implementation lets the sync path — dirty tracking, coalesced flushing, deduplication, cache-first reads, retry behaviour — be exercised through the engine facade with no network. Because this boundary exists for architectural reasons regardless of testing, using it costs nothing in extra surface area.

**3. Backend functions.**

Necessarily separate, since backend code cannot run inside the browser test. Tested with the backend platform's own test harness, covering schema validity, the flush and dedup path, retention decay, and the mark-and-sweep collector — the last of which deletes user data permanently and therefore needs tests demonstrating that it never removes a referenced or in-flight blob.

### What gets tested

| Area | Through which seam | Notes |
|---|---|---|
| Brush dynamics producing expected marks | Engine facade | Golden images across a set of canonical strokes |
| Pressure, tilt, and velocity response | Engine facade | Synthetic pointer sequences with known values |
| Even stamp spacing regardless of speed | Engine facade | Fast and slow synthetic strokes compared |
| Coverage versus buildup accumulation | Engine facade | The behaviour a separate stroke buffer exists to provide |
| Blend modes | Engine facade | Golden image per mode over a fixed pair of layers |
| Groups, masks, clipping | Engine facade | Composited output against expectation |
| Colour correctness | Engine facade | Linear-light blending, and export matching canvas |
| Undo and redo | Engine facade | Including deep histories that cross the compression and spill tiers |
| Tile compression and hashing | Directly | An external contract; silent corruption loses artwork |
| Flush, dedup, cache-first reads, retry | Engine facade with in-memory store | No network involved |
| Backend schema, retention, collection | Backend harness | Collection tests must prove referenced blobs survive |
| Performance against the stated target | Scripted benchmark | Tracked over time, not a pass/fail gate |

### Prior art

None. The first test written establishes the pattern; it should be a golden-image test through the engine facade, since that is the pattern most of the suite will follow.

---

## Out of Scope

**Deferred features.** Vector layers; live fluid-simulation brushes (watercolour, oil); an animation timeline with onion skinning; selections and transforms (lasso, marquee, magic wand, warp); the smudge and wet-mixing tools; PSD import and export. Each is named in the architecture document with the specific structural provision that keeps it available later — the smudge tool, for instance, is excluded specifically so that tiles retain single-writer semantics in v1.

**Deferred platform work.** Realtime multiplayer painting; running the engine in a Web Worker; iPad and touch-first interaction; full offline-first operation with a queued mutation log and conflict resolution; predictive input for reduced perceived latency.

**Deferred product surface.** Billing and paid plans, though the schema carries the fields; a public gallery, profiles, or any social layer; a mobile application; plugins or an extension API; brush sharing between users.

**Explicit non-goals.** Support for browsers without WebGPU beyond the static share view; Photoshop file compatibility; a server-side rendering path — the client already composites, and its output is persisted instead.

---

## Further Notes

**Sequencing.** Four milestones, ordered by risk rather than by visibility. The first is a vertical slice of the engine alone — a WebGPU device, one tiled layer, a stamped pressure-sensitive stroke, the compositor, and the display transform — with no backend and no interface chrome, done when a single textured stroke renders at the target frame rate on a full-size canvas. Everything that could plausibly kill the project lives in that slice. Layers and history follow, then persistence and sync, then the full product surface. Backend work is well-trodden and unlikely to surprise; the interface is the most reversible layer of all; so both come after the unknowns have been settled.

**The preview decision.** Writing a flattened preview image alongside each sync — one extra upload — collapses four separate features into one artifact: document thumbnails, share links, link preview images, and the read-only view for browsers without WebGPU. The general principle is that the client is already a renderer, so a second renderer on the server should never be built when its output can simply be persisted. The one hazard is that the preview must go through the same display transform as the canvas, or every thumbnail will look subtly wrong.

**Free-tier economics.** The service is designed to run within the free tiers of both infrastructure providers, and the binding constraint is write operations rather than stored bytes. This is why flushing coalesces and why deduplication happens before upload. It is worth measuring actual per-session write counts once sync is real, because that number determines how many users the free tier supports and is the earliest signal that the storage backend needs to change — which the storage interface exists to make possible.

**On the risk that dominates.** If WebGPU cannot reach the performance target at full canvas size, much of this design needs revisiting. The first milestone is arranged to find that out before anything is built on top of it.
