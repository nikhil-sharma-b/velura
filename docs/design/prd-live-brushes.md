# Velura Live Brushes — Product Spec

**Status:** ready-for-agent
**Date:** 2026-10-10
**Predecessor:** `docs/design/prd-brush-library.md`. Companion: `docs/design/architecture.md` (D1, D23, D27, D29, D30, D32, §6.2).
**Successor:** the fluid brushes milestone (watercolour and other paint that moves after the pen lifts), which builds on what this one leaves behind. See Further Notes.
**Issues:** `.scratch/live-brushes/issues/`

---

## Problem Statement

Every brush in Velura lays new paint on top of what is there. A stroke is drawn into its own buffer and composited onto the layer once, so the paint under the brush never takes part: red drawn across blue is red over blue, with a hard boundary between them. The only tool that moves existing paint is Smudge, and Smudge lays nothing down.

An artist who paints in oil or acrylic works the other way. The brush puts colour down and picks up what it crosses in the same motion, so edges soften as they are painted, colours blend where strokes meet, and a loaded brush dragged through wet paint leaves streaks of both. Today that takes two tools and several passes (paint, switch to Smudge, blend, switch back), and it still cannot produce a stroke that is both laying and mixing.

The architecture document has deferred this since v1 as "live brushes" and "wet mixing", and says the provision for it is a pluggable `StrokeRenderer` and a reserved compute-shader path. Neither exists in the code. What does exist is the smudge stroke path (D29), which already reads the layer while writing it.

## Solution

Any raster brush can be made a **wet brush**. A wet brush lays the current colour and drags the paint already on the layer along with it, dab by dab, so a stroke mixes with what it crosses. Two numbers shape it: **flow**, which is how much colour each dab lays (the brush's load), and **pickup**, which is how much of the paint behind the dab is carried forward. High flow and low pickup is a loaded brush that covers; low flow and high pickup is a nearly dry brush that mostly blends; flow at zero is a blender that lays nothing, which is what Smudge already is.

A wet brush is still a brush: it has a tip, dynamics, grain, and a place in the library and the brush editor. Pressure, tilt and speed can drive flow and pickup like any other target.

Later in the milestone the brush gains a **reservoir**: paint it has picked up stays on the bristles from dab to dab, so a brush dragged out of red into blue streaks red into the blue, bristle by bristle, and runs out as it goes. The brush is loaded clean at every pen-down.

The library ships four wet brushes, and Krita colour-smudge presets can be imported as wet brushes.

Nothing moves after the pen lifts. Paint that flows, bleeds and dries over time is the fluid brushes milestone.

## User Stories

### Painting with a wet brush

1. As an artist, I want a brush that lays colour and blends it into the paint already on the layer in one stroke, so that I can paint the way oil and acrylic behave.
2. As an artist, I want to drag a wet brush from one colour into another and see the first carried into the second, so that edges between colours soften as I paint them.
3. As an artist, I want a wet brush to lay my current colour on an empty layer, so that I can start a painting with it and not only blend.
4. As an artist, I want a wet brush dragged from paint into an empty area to thin out as it goes, so that paint feathers off the way a real brush runs dry.
5. As an artist, I want to control how much colour each dab lays, so that I can choose between covering and glazing.
6. As an artist, I want to control how much paint the brush picks up from the canvas, so that I can choose between a clean stroke and a heavily blended one.
7. As an artist, I want a brush that lays nothing and only blends, so that I can soften a passage without adding colour.
8. As an artist, I want pressure to drive how much colour is laid, so that a light touch blends and a hard press covers.
9. As an artist, I want pressure, tilt or speed to drive pickup, so that I can change how much the brush mixes within one stroke.
10. As an artist, I want a wet brush to respond to size, angle and roundness dynamics as my other brushes do, so that it handles like a brush and not like a fixed stamp.
11. As an artist, I want a wet brush to use any tip, including multi-frame tips, so that a bristle or rake tip gives a bristled mark.
12. As an artist, I want paper grain to show in the paint a wet brush lays, so that wet brushes sit on the same surface as my dry media.
13. As an artist using a mouse or a pen with no pressure sensor, I want a wet brush to run at its set flow and pickup, so that it works without a stylus.

### Reservoir

14. As an artist, I want paint the brush has picked up to stay on it as the stroke continues, so that colour is carried a long way and fades gradually.
15. As an artist, I want a brush that has crossed two colours to lay streaks of both, so that strokes have the bristle variation of real paint.
16. As an artist, I want the brush to run out of its own colour over a long stroke when it is picking up heavily, so that a stroke has a beginning and an end.
17. As an artist, I want the brush loaded clean with my current colour every time I put the pen down, so that each stroke starts predictably.

### Fitting in with the rest of the studio

18. As an artist, I want one undo to remove a whole wet stroke, so that it behaves like any other stroke.
19. As an artist, I want a cancelled wet stroke to leave the layer exactly as it was, so that an accidental touch costs nothing.
20. As an artist, I want a wet brush to change only inside the selection, while still dragging in paint from beside it, so that I can blend up to an edge.
21. As an artist, I want a soft selection edge to take a proportional share of a wet stroke, so that feathered selections blend smoothly.
22. As an artist, I want a wet brush to change only the active layer, so that layers above and below are safe.
23. As an artist, I want a wet brush to work on a layer mask, so that I can blend what a mask hides and shows.
24. As an artist, I want a locked layer left untouched by a wet brush, so that locking means what it says.
25. As an artist pressing a wet brush on a vector layer, I want the same notice other raster brushes give, so that I know why nothing was drawn.
26. As an artist, I want a wet stroke to survive a reload and sync to my other machines, so that it is saved like any painting.
27. As an artist, I want the eraser to stay a plain eraser whatever brush I last used, so that erasing never smears.
28. As an artist, I want Smudge to behave exactly as it does today, so that nothing I rely on changes.

### Library and editor

29. As an artist, I want wet brushes in the brush library beside my other brushes, so that I pick one the way I pick any brush.
30. As an artist, I want built-in wet brushes (an oil round, an oil flat, a blender, a dry bristle), so that I can paint wet without building a brush first.
31. As an artist, I want to turn any of my raster brushes into a wet brush in the brush editor, so that I can keep a tip and dynamics I like.
32. As an artist, I want the editor to hide the settings that do not apply to a wet brush, so that I am not adjusting controls that do nothing.
33. As an artist, I want to map pickup to pressure, tilt or speed with the same curve editor as other dynamics, so that I do not learn a second interface.
34. As an artist, I want my own wet brushes saved and synced to my account, so that they follow me between machines.
35. As an artist, I want brushes I saved before this release to open and paint exactly as before, so that the update changes nothing I did not ask for.
36. As an artist, I want to import a Krita colour-smudge preset and get a wet brush, so that mixing brushes I already own work in Velura.
37. As an artist importing a Krita preset, I want to be told which of its settings were dropped, so that I know what will differ.

### Feel

38. As an artist, I want a wet brush to keep up with my pen at any size I can set, so that mixing feels as immediate as drawing.
39. As an artist working on a very large canvas, I want a wet stroke to start as fast as on a small one, so that document size never costs me the first mark.

## Implementation Decisions

**Scope: wet mixing only.** "Live" covers two things of very different size: paint that mixes under the brush, and paint that keeps moving after the pen lifts. This milestone is the first. Everything in it happens while the pen is down, so the engine's standing assumption that pixels change only during a stroke or a command still holds, and undo, flush and the compositor caches are not disturbed.

**No wetness state.** All paint on a layer is always available to mix with. There is no wetness surface, no drying, no new tile kind and no sync change. How much a stroke mixes is the brush's own setting.

**Stroke renderer seam (architecture, new).** The renderer currently holds the brush stroke path and the smudge stroke path inline. They are pulled behind one stroke renderer interface before wet mixing is added: a stroke begins on a surface, takes dabs, and ends kept or cancelled, returning the region it reached. The buffered stroke (stroke buffer, composited once, D27) and the direct stroke (reads and writes the surface as it goes, D29) are its two implementations. This is behaviour-preserving and is what the architecture document has claimed since v1. The fluid brushes milestone adds a third implementation behind the same seam.

**One direct pass for smudge and wet brushes.** A wet dab is the smudge dab with a colour term: each pixel is mixed towards the pixel one dab's travel behind it by `pickup`, and the result is mixed towards the brush colour by `flow`, both scaled by the tip's shape and the selection's coverage. Smudge is that pass with flow zero and stays a separate tool with its own size and strength. There is one shader and one renderer path to keep correct for selections, masks and cancel copies.

**Brush model (D23), additive.**

```ts
type BrushRendering = {
  accumulation: Accumulation
  opacity: number
  flow: number
  /** Absent means a dry brush, drawn through the stroke buffer. */
  wet?: { pickup: number } // in [0, 1]
}
```

`flow` is the load: it already means the opacity of a single dab, and its existing dynamics mappings keep working. One new dynamics target, `pickup`, is added. A brush stored without `wet` is dry and draws exactly as before, so no stored brush is migrated.

**What a wet brush does not have.** A wet stroke writes the layer directly, so the things the stroke buffer provides cannot apply: stroke opacity, the coverage/buildup accumulation mode, and blend modes. A wet brush always mixes normally. The values stay on the brush, unread, so turning wet off restores them.

**Which brush features reach a wet dab.** Size, angle and roundness dynamics; flow dynamics; the new pickup target; tip textures and tip sets with their frame selection; grain, applied to the laid colour only and not to the paint being dragged. Scatter and colour jitter do not: a scattered dab has no single dab behind it to drag from, and both are ticketed as follow-ups. A wet brush with scatter or colour set draws as if they were absent.

**Dab spacing.** A wet brush uses its own spacing setting, floored at one pixel as smudge is, since a dab needs a whole pixel behind it to drag.

**Mixing is a linear premultiplied mix** in the working space (D10), all four channels alike, so transparency is carried as paint is. The mix is one shader function, isolated so pigment mixing (blue and yellow giving green) can replace it later without touching the pass.

**What is read and written.** The active layer alone, or its mask while the mask is being painted. On a mask the laid value is the mask's paint value, as for a dry brush. A selection limits what is written and not what is read. Vector layers refuse a wet brush with the existing notice. The eraser is never wet, whatever the brush says.

**Cancel, undo, persistence.** Inherited from the direct stroke path unchanged: each tile is copied on the GPU the first time a dab is about to write to it, a cancel copies those tiles back, a kept stroke pushes one undo entry for the region reached, and the tiles flush and sync as any painted tiles do. No pixel crosses to the CPU while the pen is down (D30).

**Reservoir.** A tip-sized texture that persists from dab to dab for the length of a stroke. At pen-down it is filled with the brush colour. Each dab trades paint with the layer per pixel: the layer takes from the reservoir by `flow`, and the reservoir takes from the layer by `pickup`. It replaces the "pixel one dab behind" read for wet brushes; smudge keeps that read. It is allocated with the renderer at the largest tip size, not per stroke. It is cleared at pen-up: the brush does not stay dirty between strokes, so undo never has to restore brush state.

**Editor (D32).** The Rendering tab gains a wet toggle and a pickup control. With wet on, stroke opacity, accumulation and blend mode are hidden, and `pickup` appears among the dynamics targets.

**Library.** Four built-in wet brushes, committed as data beside the existing presets: oil round, oil flat (bristle tip), blender (flow zero), dry bristle (low flow, high pickup).

**Krita translation.** The translator accepts Krita's colour-smudge engine as well as the paintbrush engine, mapping smudge rate to pickup and colour rate to flow, with their sensor curves converted as existing sensors are. Options with no counterpart (smudge radius, the smearing/dulling mode switch, overlay mode) are dropped and listed in the report.

**Performance (D30).** The bar is unchanged: 120 fps at 8192² and under 10 ms pointer to pixel. A wet dab costs a neighbourhood copy and a draw and does not batch as stamps do, so the cost per dab is what matters. It is measured at a 64 px and a 512 px brush. If the large brush misses the bar, the spacing floor for wet brushes rises; the bar does not drop.

**Architecture document.** A new decision row (D41, wet mixing) records the choices above; §6.2 describes the stroke renderer seam and the shared direct pass; the deferred-features table stops claiming a `StrokeRenderer` that does not exist and narrows "live brushes" to fluid simulation. Each change lands in the ticket that makes it true.

## Testing Decisions

A good test here checks what the artist would see or what a stored brush means, through a contract the planned rewrites leave alone (architecture §9): the Worker migration, atlas eviction, and a compute-shader path for fluid brushes will each rewrite renderer internals. So nothing is tested against the stroke renderer interface itself, the shader, or the reservoir texture. There are two seams, both existing.

- **Engine facade, in the browser.** Draw a stroke through the engine's public commands and read pixels back, as `smudge.spec.ts`, `smudge-in-selection.spec.ts` and `smudge-on-mask.spec.ts` do. This covers: colour carried from one region into another; colour laid on an empty layer; flow zero laying nothing; pickup zero matching a plain covering stroke; only the active layer changing; selection clipping with paint dragged in from outside; mask painting; undo, redo and cancel; reload. The reservoir is tested the same way: a stroke that crosses red then blue leaves red in the blue further along than a stroke without it would.
- **Pure layer, unit tests.** Brush validation and defaults for `wet`, the `pickup` dynamics target, the Krita mapping table against a small committed colour-smudge fixture, and local and Convex brush storage round-trips. Prior art: `smudge.test.ts`, `krita-preset.test.ts`, `local-brushes.test.ts`, `convex-brushes.test.ts`.

Supporting checks:

- **Seam extraction** adds no tests. It is done when the existing stroke, stroke-buffer, smudge and scatter specs and their golden images pass unchanged.
- **Golden images** (darwin + linux): one wet stroke across a two-colour ground, and one with the reservoir, using a procedural tip so the images do not depend on shipped assets.
- **Browser specs for the UI:** the editor's wet toggle hiding and showing controls, a built-in wet brush selected from the library and drawn with, and a Krita colour-smudge preset imported. Prior art: `brush-editor.spec.ts`, `brush-library.spec.ts`, `brush-import.spec.ts`.
- **Bench:** a wet sweep beside the smudge sweep, at two brush sizes and on a small and a large document, with results recorded in `docs/design/benchmark.md`.

## Out of Scope

- **Fluid simulation:** paint that flows, bleeds, granulates or dries after the pen lifts. Watercolour, ink wash, heavy oil with body. This is the fluid brushes milestone.
- **Wetness and drying:** recent paint mixing while old paint does not, whether per session or saved with the document.
- **Paint thickness, impasto and lighting.**
- Ticketed as follow-ups, not built here:
  - Pigment mixing (subtractive colour, blue and yellow giving green).
  - A brush that stays dirty between strokes, with a clean-brush toggle.
  - Scatter on wet brushes.
  - Colour jitter on wet brushes.
  - Sample all layers (picking up from the composited picture).
- Wet vector brushes.
- A wet eraser.
- Changes to the Smudge tool's behaviour or settings.
- Krita's other engines (hairy/bristle, spray, deform, particle, sketch).

## Further Notes

**What this milestone leaves for fluid brushes.** The reason to write this down is that the next milestone starts from here.

- *The seam.* Fluid brushes are a third stroke renderer. The interface is shaped by two real implementations before the hard one arrives.
- *Direct writes.* A stroke that reads and writes the layer, with per-tile cancel copies and no CPU readback, is proven for brushes with full dynamics, not only for smudge.
- *Per-brush GPU state.* The reservoir is the first texture that carries paint state between dabs. A wetness or pigment field is the same idea made layer-sized and long-lived.
- *The mix function.* Pigment mixing, if built, serves both milestones.
- *What is still missing.* Anything that runs when the pen is up: a simulation step on a clock, compute pipelines (none exist yet), state that outlives a stroke, and answers for what undo, flush, sync and the compositor caches do while paint is still moving. Those are the fluid milestone's own design questions and none is decided here.

**Naming.** "Live brushes" is kept as this milestone's name because it is the name the architecture document has used. After it ships, the deferred-features table uses "fluid brushes" for what remains.

**Sequencing.** The seam first, because every later ticket lands in it. Then the wet pass with no new state, which proves a brush with dynamics can write the layer directly. Then the editor and the mask and grain cases, then the reservoir, which is the only new GPU state. Library, Krita import and the performance measurement follow.
