# Velura V2 — Product Spec

**Status:** ready-for-agent
**Date:** 2026-09-26
**Predecessor:** `docs/design/prd.md` (V1). Companion: `docs/design/architecture.md`.

---

## Problem Statement

Velura V1 is a good instrument for putting paint down: expressive brushes, float-linear compositing, layers with groups, masks and blend modes, and documents that follow the artist between machines. But painting a finished piece is only partly about making marks. The rest is revising them — isolating an area, moving a figure a little to the left, rotating a head, cooling the shadows, straightening a horizon — and V1 offers almost none of that. The artist can only undo, erase, or repaint.

The artist also cannot make clean, resolution-independent work. Logos, UI mockups, line-art for print and diagrams need crisp shapes and editable curves that export to SVG; today that means leaving Velura for Inkscape and losing the painting context.

Finally, the app works but doesn't yet flow. Every action is a click through panels, shortcuts are fixed and undiscoverable, there is no way to hide the interface and just look at the painting, and small operations such as clearing a single layer are missing. The friction adds up over a long session.

## Solution

V2 makes Velura a tool you can revise and finish work in.

- **Selections** — rectangle, ellipse, lasso and magic wand — isolate part of a layer. Painting, erasing and filters respect the selection, and the selected pixels can be moved and transformed.
- **Transform** — move, scale, rotate and flip a layer, a selection or vector objects, with snapping and one-click alignment to the canvas centre and edges or to the selection.
- **Rulers, guides and stroke assist** — rulers along the canvas edges, guides dragged out from them, and a straight-edge assist that holds a brush stroke to a line, all feeding the same snapping system.
- **Filters** — hue/saturation, brightness/contrast and Gaussian blur, applied to the active layer and limited to the selection.
- **Vector layers** — a new layer type in the same layer tree, holding shapes, Bézier paths and pressure strokes that stay editable and sharp at any zoom, and exporting to SVG.
- **A better working experience** — every action is a named command reachable from a command palette, every command can have a keybind the artist chooses, a Zen mode hides the interface with one key, a preferences panel gathers settings, and a layer (or a selection) can be cleared on its own.

---

## User Stories

### Commands, keybinds and palette

1. As an artist, I want every action in the app available as a named command, so that I can find any action without knowing which panel it lives in.
2. As an artist, I want a command palette opened with a keyboard shortcut, so that I can run any action by typing part of its name.
3. As an artist, I want the palette to fuzzy-match what I type, so that "hue" finds "Hue/Saturation…" and "clr lay" finds "Clear layer".
4. As an artist, I want the palette to show each command's current keybind, so that I learn shortcuts by using the palette.
5. As an artist, I want recently used commands at the top of the palette, so that my frequent actions are one keystroke away.
6. As an artist, I want commands that don't apply right now to be shown disabled or hidden, so that I am not offered actions that will do nothing.
7. As an artist, I want sensible default keybinds for common tools and actions, so that the app is fast to use before I customise anything.
8. As an artist, I want to rebind any command to a key combination of my choice, so that the app matches the muscle memory I bring from other tools.
9. As an artist, I want to be warned when a key combination I pick is already used, and shown by which command, so that I do not silently break another shortcut.
10. As an artist, I want to resolve a conflict by reassigning or swapping, so that fixing a clash is one decision.
11. As an artist, I want to remove a keybind from a command, so that keys I hit by accident do nothing.
12. As an artist, I want to reset one keybind or all keybinds to defaults, so that I can recover from a configuration I regret.
13. As an artist, I want my keybinds to follow me to any machine I sign in on, so that I do not re-configure every browser.
14. As an artist, I want keybinds to not fire while I am typing in a text field, so that renaming a layer does not switch my tool.
15. As an artist, I want hold-to-use shortcuts (e.g. hold a key for the eyedropper, release to return), so that momentary tool switches don't break my flow.
16. As an artist, I want menus and tooltips to show the same keybinds I configured, so that the whole interface agrees about shortcuts.

### Preferences

17. As an artist, I want a single preferences panel, so that app-wide settings are in one place rather than scattered.
18. As an artist, I want keybind editing to live in preferences, so that I know where to go to change shortcuts.
19. As an artist, I want my preferences synced to my account, so that my setup is the same everywhere.

### Zen mode

20. As an artist, I want to hide all interface chrome with one key, so that I can see and judge my painting without distraction.
21. As an artist, I want the same key to bring the interface back, so that toggling is effortless.
22. As an artist in Zen mode, I want painting, navigation, undo and all keybinds to keep working, so that I can keep working, not just look.
23. As an artist, I want Zen mode's key to be rebindable like any other command, so that it does not collide with my habits.

### Clearing

24. As an artist, I want to clear the active layer's contents without deleting the layer, so that I can restart one element while keeping its name, blend mode, mask and position in the stack.
25. As an artist, I want clearing to be undoable, so that a mis-click does not cost me work.
26. As an artist with an active selection, I want "Clear" to empty only the selected area, so that I can knock out part of a layer precisely.
27. As an artist, I want clearing a vector layer to remove its objects, so that the command means the same thing on both layer types.

### Selections

28. As an artist, I want a rectangle selection tool, so that I can isolate a rectangular region.
29. As an artist, I want an ellipse selection tool, so that I can isolate round regions.
30. As an artist, I want to constrain rectangle and ellipse to square and circle with a modifier, so that I can make exact shapes.
31. As an artist, I want a freehand lasso, so that I can isolate irregular shapes such as a figure.
32. As an artist, I want a polygonal lasso mode, so that I can select straight-edged shapes click by click.
33. As an artist, I want a magic wand that selects contiguous similar colour, so that I can grab a flat-filled area in one click.
34. As an artist, I want to set the magic wand's tolerance, so that I control how much variation it includes.
35. As an artist, I want to choose whether the wand samples the active layer or the whole composite, so that I can select by what I see or by what a layer holds.
36. As an artist, I want to add to, subtract from and intersect with the current selection using modifiers, so that I can build complex selections from simple ones.
37. As an artist, I want to feather a selection, so that edits blend softly into their surroundings.
38. As an artist, I want to invert the selection, so that I can edit everything except a subject.
39. As an artist, I want select all and deselect commands, so that I can start over quickly.
40. As an artist, I want the selection edge shown as animated marching ants, so that I always know what is selected.
41. As an artist, I want brush strokes and erasing to affect only the selected area, so that I can paint inside a shape without spilling over.
42. As an artist, I want a feathered selection to partially affect its soft edge, so that painting at the boundary fades naturally.
43. As an artist, I want to move the selected pixels, so that I can reposition part of a layer.
44. As an artist, I want to move just the selection outline without the pixels, so that I can correct a selection I placed slightly wrong.
45. As an artist, I want selection changes to be undoable, so that a bad lasso does not force me to start over.
46. As an artist, I want to copy and paste a selection into a new layer, so that I can duplicate or separate a part of the painting.
47. As an artist, I want the selection to persist when I switch layers, so that I can apply the same region across layers.

### Transform

48. As an artist, I want to move, scale and rotate the active layer, so that I can recompose without repainting.
49. As an artist, I want to transform only the selected pixels, so that I can adjust one element of a layer.
50. As an artist, I want to transform selected vector objects, so that shapes move the same way pixels do.
51. As an artist, I want on-canvas handles for scale and rotate, so that transforming is direct manipulation.
52. As an artist, I want to lock the aspect ratio with a modifier, so that I don't distort a figure by accident.
53. As an artist, I want to snap rotation to fixed increments with a modifier, so that I can rotate exactly 90° or 15°.
54. As an artist, I want to flip horizontally and vertically, so that I can mirror an element or check my drawing.
55. As an artist, I want to type exact position, size and angle values, so that I can place things precisely.
56. As an artist, I want a live preview during a transform and commit or cancel at the end, so that I can explore without committing.
57. As an artist, I want a transformed raster to be resampled once from the original when I commit, so that repeated adjustments during one transform don't blur the pixels.
58. As an artist, I want a committed transform to be one undo step, so that undo reverses the whole adjustment.
59. As an artist, I want to align the transformed content to the canvas centre, so that I can centre an element in one click.
60. As an artist, I want to align to the canvas's left, right, top and bottom edges and to its horizontal and vertical centre lines separately, so that I can place content exactly.
61. As an artist, I want to align content relative to the selection bounds, so that I can centre something within a region.
62. As an artist dragging content, I want it to snap to the canvas centre, edges, guides and other objects' bounds, so that alignment happens as I move.
63. As an artist, I want visual snap indicators when a snap engages, so that I know why content jumped.
64. As an artist, I want to toggle snapping and hold a modifier to suspend it temporarily, so that I can place things freely when I need to.

### Rulers, guides and stroke assist

65. As an artist, I want rulers along the top and left canvas edges in document pixels, so that I can measure positions.
66. As an artist, I want to show or hide rulers, so that they are there only when I need them.
67. As an artist, I want to drag horizontal and vertical guides out of the rulers, so that I can mark lines to compose against.
68. As an artist, I want to move and delete guides, so that I can revise my layout.
69. As an artist, I want guides saved with the document, so that my layout persists across sessions and machines.
70. As an artist, I want to hide guides without deleting them, so that I can view the painting cleanly.
71. As an artist, I want a straight-edge assist that constrains my brush stroke to a line, so that I can draw straight marks freehand with full pressure dynamics.
72. As an artist, I want to position and angle the straight-edge on the canvas, so that I can rule lines at any orientation.
73. As an artist, I want a modifier that draws a straight line from the last stroke's end point, so that I can connect points quickly.
74. As an artist, I want strokes to snap to a guide when started near it, so that guides help painting as well as transforming.

### Filters

75. As an artist, I want a hue/saturation/lightness filter, so that I can shift colour relationships in part of the painting.
76. As an artist, I want a brightness/contrast filter, so that I can correct value range.
77. As an artist, I want a Gaussian blur filter with an adjustable radius, so that I can soften backgrounds or create depth.
78. As an artist, I want a live on-canvas preview while I adjust filter parameters, so that I can judge the result before applying.
79. As an artist, I want filters limited to the selection when one exists, including its feathered edge, so that I can adjust part of a layer.
80. As an artist, I want to apply or cancel a filter, so that previews never modify my painting until I confirm.
81. As an artist, I want an applied filter to be one undo step, so that I can reverse it cleanly.
82. As an artist, I want filters to compute in the same float-linear space as painting, so that adjustments don't band or fringe.

### Vector layers

83. As an artist, I want to add a vector layer to my document, so that I can mix crisp shapes with painting in one piece.
84. As an artist, I want vector layers to take part in groups, clipping, masks, opacity and blend modes like raster layers, so that they are first-class members of the layer stack.
85. As an artist, I want vector content to stay sharp at any zoom, so that line-art never pixelates while I work.
86. As an artist, I want vector layers to sync and version like the rest of my document, so that they are as safe as my paint.
87. As an artist, I want vector edits to be undoable step by step, so that I can revise shapes fearlessly.
88. As an artist, I want to rasterise a vector layer into a paint layer, so that I can paint over or texture a shape.
89. As an artist, I want a vector layer's thumbnail to show its contents, so that I recognise it in the layer panel.

### Vector tools

90. As an artist, I want rectangle, ellipse, line and polygon tools on vector layers, so that I can draw basic shapes quickly.
91. As an artist, I want a pen tool that places Bézier anchors and drag-out handles, so that I can draw precise curves.
92. As an artist, I want to close a path by clicking its first anchor, so that I can make filled shapes.
93. As an artist, I want to select one or more vector objects by clicking or dragging a box, so that I can edit them.
94. As an artist, I want a node tool to move anchors and handles, add and delete anchors, and switch anchors between smooth and corner, so that I can refine a curve.
95. As an artist, I want to set a shape's fill colour and opacity, including none, so that I can make filled or outline-only shapes.
96. As an artist, I want to set stroke colour, width, cap and join, so that outlines look the way I intend.
97. As an artist, I want to draw pressure-sensitive strokes on a vector layer that stay editable paths, so that expressive line-art remains scalable.
98. As an artist, I want vector pressure strokes smoothed with the same stabilizer as brush strokes, so that inking feels consistent.
99. As an artist, I want to reorder, duplicate and delete vector objects, so that I can manage what's on a layer.
100. As an artist, I want the colour picker to set the fill or stroke of the selected objects, so that colour works the same across layer types.

### SVG export

101. As an artist, I want to export my document as SVG, so that I can use my vector work in other tools, on the web and in print.
102. As an artist, I want vector layers exported as real SVG paths, so that the output is editable elsewhere.
103. As an artist, I want to choose whether raster layers are embedded as images or omitted, so that I can export pure vectors or a complete picture.
104. As an artist, I want the layer and group structure preserved as SVG groups with names, so that the file is organised when I open it elsewhere.
105. As an artist, I want opacity and supported blend modes carried into the SVG, so that it looks like my canvas.
106. As an artist, I want to be told when something in my document can't be represented exactly in SVG, so that I am not surprised by a mismatch.

---

## Implementation Decisions

**Compatibility.** Nothing is in production. V2 may change the document model, Convex schema and brush format without migrating V1 documents. Documents that fail to load may be discarded.

**Command registry (new, UI side).**
- One registry describes every user-facing action: a stable id, a label, a category, an availability predicate over app and engine state, a run function, and optional default keybinds. Menus, the command palette, tooltips and keyboard handling all read from it; none keeps its own list.
- A keybind resolver maps normalised key chords to command ids, taking into account whether focus is in a text input and supporting hold-to-use (momentary) bindings.
- User overrides are stored as a sparse map of command id to chords, layered over the defaults. Conflict detection runs over the merged map and reports which command owns a chord.
- Overrides and other preferences are stored per user in Convex in a new preferences table, cached locally so shortcuts work before sync. Anonymous users keep them locally, and they move into the account with the rest of the anonymous-upgrade migration.
- The registry lives outside the engine. Engine-side actions are commands that issue existing engine commands; the engine stays free of React and DOM dependencies.

**Zen mode.** A UI state toggled by a registry command (default Tab). It hides the chrome only; the canvas host, input handling and keybind resolver keep running.

**Clear.** A new engine command that empties the active layer — or, when a selection exists, the selected area weighted by the mask. On vector layers it removes objects: all of them, or those within the selection. It records a single undo entry through the existing undo system.

**Selections (engine).**
- A document-level selection is a single-channel GPU mask texture at document resolution, tiled like layers so empty regions cost nothing. Shape tools rasterise their outlines into it. Add, subtract and intersect are mask operations, and feather is a blur of the mask.
- The magic wand runs a tolerance flood-fill against the active layer or the composite. The flood-fill rule is a pure function of pixel data, so it can be tested directly.
- The stroke pipeline and filters multiply their output by the mask. The compositor is unchanged.
- Marching ants are drawn from an edge-detection pass over the mask in the display pass and never written to layers.
- Selection state appears in the snapshot (whether one exists, its bounds). Changes to the selection are undoable.

**Transform (engine).**
- Transform generalises the existing placed-image transform: an affine matrix (translate, scale, rotate, flip) applied to a source. The source is the active layer, the selected pixels lifted into a floating buffer, or selected vector objects.
- During the transform, the preview renders from the untouched source. Commit resamples once and records one undo entry, the same rule placed images already follow. Cancel discards the transform.
- Alignment is a command taking a target (canvas, or selection bounds) and an anchor (left, horizontal centre, right, top, vertical centre, bottom). It computes a translation from the content's bounds.

**Snapping (engine, pure core).** One snap resolver takes candidate geometry (points and bounds being moved) and a set of targets: canvas edges and centre lines, guides, other objects' bounds, and stroke-assist lines. It returns the adjusted position and the snaps that engaged. Transform, guides, stroke assist and the vector tools all use it. The resolver is a pure function.

**Rulers and guides.** Guides are part of the document model (orientation and position in document pixels) and persist through the existing document sync. Rulers are UI drawn from the view transform. Stroke assist is an input-pipeline stage placed before the stabilizer. It projects pointer samples onto the active line and leaves pressure and tilt untouched.

**Filters (engine).** Filters are compute or fragment passes over a layer's tiles in working (float-linear) space. They write through a preview target while parameters change, and they are blended in by the selection mask when applied. Each filter is a registry command that opens a parameter dialog. Applying records one undo entry. They are destructive; there are no adjustment layers.

**Vector layers (engine and model).**
- A new layer node kind in the layer tree. It carries a scene graph: an ordered list of objects, each with an id, a geometry (rect, ellipse, line, polygon, cubic Bézier path, or pressure stroke), a transform and a style (fill colour and opacity; stroke colour, width, cap, join).
- A pressure stroke is kept as a centre-line path with per-point width. It is converted to an outline path when rendered and exported.
- Rendering: geometry is tessellated into triangles on the CPU, and the GPU draws it with antialiasing into the layer's existing float tiles. The compositor, blend modes, masks and clipping therefore handle vector layers unchanged. A layer re-rasterises when its scene changes and at zoom levels beyond the raster's resolution, within the visible tiles. Its raster tiles are a local cache and never sync.
- Persistence: the scene graph syncs as structured data in Convex, one record per vector layer (split into chunks if it grows large), through the existing flush and versioning path instead of the TileStore. Versions and restore points include the scene.
- Undo: vector edits record command diffs (add, remove, or update an object; reorder) rather than tile snapshots.
- Rasterise is a command that converts a vector layer into a raster layer, keeping its tiles.

**Vector tools.** Shape, pen, node and selection tools are input tools that turn pointer sequences into scene-graph commands, using the snap resolver. Pressure strokes reuse the existing resampling and stabilizer stages and then fit a path.

**SVG export.** A pure serialiser from document model to SVG text:
- Groups become `<g>` elements carrying names and opacity.
- Vector objects become `<path>`, `<rect>` or `<ellipse>`.
- Raster layers become `<image>` elements with PNG data URIs taken from the existing export path, or are omitted, as the artist chooses.
- Blend modes map to `mix-blend-mode` where CSS has an equivalent. Masks and clipping map to `<mask>` and `<clipPath>`.
- It returns a list of warnings for anything approximated.
It joins the existing export and import feature as a new format.

**Build order.** Each item below becomes one or more issues in `.scratch/velura-v2/issues`, about 20 in total. Each issue is a vertical slice that can be tested on its own.
1. Command registry, keybinds, palette, preferences
2. Zen mode, Clear layer
3. Selection mask, then the selection tools
4. Transform, snapping and alignment
5. Rulers, guides and stroke assist
6. Filters
7. Vector layer foundation: model, rendering and sync
8. Vector tools
9. SVG export

---

## Testing Decisions

**What makes a good test.** Tests check external behaviour only: pixels read back through the engine facade, snapshots, SVG output text, and the keybinds that resolve to a command. They never check internal structures, shader details or React component trees. This keeps the V1 rule (architecture §11): GPU behaviour goes through the engine facade, and only contracts that won't change in the planned rewrites are tested directly.

**Seams.**
1. **Engine facade (the main seam)** — Playwright in headless Chrome against the harness, using golden images and pixel readback. It covers:
   - Selection shapes and their modifiers, feather, and painting and erasing limited to the mask
   - Clear, with and without a selection
   - Transform commit, cancel and quality after repeated adjustment
   - Alignment results
   - Stroke assist producing straight marks
   - Filter output and filters limited to the selection
   - Vector layers compositing with blend modes, masks and clipping; staying sharp after zooming; rasterising
   - Undo and redo across all of the above
2. **Direct unit tests (Bun, no GPU)** for:
   - Scene-graph commands and their undo diffs
   - Tessellation (triangle coverage of simple shapes, winding rules)
   - Fitting a pressure stroke to a path
   - The snap resolver
   - The magic-wand flood-fill rule
   - The SVG serialiser (asserting on output text, including warnings)
   - Keybind resolution, conflict detection and merging overrides with defaults
3. **Convex function tests**, covering:
   - The preferences and keybinds table
   - Vector scene persistence, chunking and inclusion in versions
   - Guides in the document record
4. **Studio Playwright spec**: real key presses drive the palette, rebinding a key, conflict warnings, Zen mode on and off, and keybinds staying quiet while typing in text fields.
5. **Benchmark**: add workloads for re-rasterising a vector layer with many paths and for painting with a large feathered selection. Results are tracked, not a pass/fail gate.

**Prior art.**
- `tests/browser/transform-image.spec.ts` — transform through the facade, including the sharpness-after-repeated-adjustment rule.
- `blend-modes.spec.ts` and `groups.spec.ts` — golden-image style.
- `export-import.spec.ts` — export formats.
- `tests/unit/convex-*.test.ts` — backend tests.
- `bench/` and `benchmark.spec.ts` — benchmark workloads.
- Linux screenshot baselines are kept for CI, as in V1.

---

## Out of Scope

- Vector boolean operations (union, subtract, intersect, exclude)
- Text and text on a path
- SVG import
- Gradients (vector or raster)
- Adjustment layers and non-destructive filters
- Filters beyond the three listed
- Distort, perspective and warp transforms
- Touch gestures, iPad and Pencil-first interaction (V2 is desktop first; pen tablets work through Pointer Events as in V1)
- Realtime multiplayer, PSD compatibility, and anything V1 deferred and not listed above
- Migrating V1 documents

## Further Notes

- **Why vectors come last.** Vector editing needs selection of objects, the transform, snapping and alignment. Building those first on raster layers means the vector track reuses them instead of inventing parallel versions.
- **Why vectors render into tiles.** Rasterising into the existing float tiles keeps the compositor single-path: blend modes, masks, clipping, thumbnails and previews all work unchanged. The cost is re-rasterising on zoom, which is bounded to visible tiles and measured by the new benchmark workload.
- **Command registry as foundation.** It comes first because every later feature adds commands. With it in place, each new feature gets a palette entry and a keybind as soon as it's written.
- **Free-tier write budget.** Vector scenes and preferences add Convex writes. Their flushes should be batched together, as tile flushes are, and per-session write counts measured once vector sync lands.
