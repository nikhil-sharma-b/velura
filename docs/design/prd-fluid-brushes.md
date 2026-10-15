# Velura Fluid Brushes — Product Spec

**Status:** ready-for-agent
**Date:** 2026-10-12
**Predecessor:** `docs/design/prd-live-brushes.md`. Companion: `docs/design/architecture.md` (D3, D9, D15, D19, D21, D23, D27, D29, D30, D41, §6.2, §6.3, §8, §9.2).
**Prototype:** branch `fluid-brushes/prototype`, one self-contained page under `tmp/fluid-prototype/`. It is the primary source for the simulation rules and the measurements quoted here. It is never imported by the engine.
**Issues:** `.scratch/fluid-brushes/issues/`

---

## Problem Statement

Every mark in Velura is finished the moment the pen lifts. A dry brush lays paint, a wet brush (D41) lays paint and drags what it crosses, and in both cases nothing moves afterwards. That is right for oil, acrylic and dry media, and wrong for watercolour and ink wash, where most of the picture is made by what the paint does on its own: a second colour touched into a wet wash feathers into it, pigment gathers at the edge of a drying wash and in the valleys of the paper, and a drop of water pushed into drying paint blooms outward.

An artist cannot get those marks today. A soft round brush with low opacity gives the transparency of watercolour and none of its behaviour, and the wet brushes give blending only under the brush and only while it is moving.

The architecture document has deferred this since v1 as fluid brushes, and the live brushes milestone listed what it left unanswered: nothing runs when the pen is up, there are no compute pipelines, no paint state outlives a stroke, and undo, flush, sync and the compositor all assume pixels stop changing at pen-up.

## Solution

Any raster brush can be made a **fluid brush**. A fluid brush lays water and pigment onto the paper, and the paint keeps moving after the pen lifts until it dries.

While it is wet:

- **It bleeds.** Pigment spreads into paint that is still wet, and keeps a crisp edge against dry paper.
- **Its edges darken.** Water is drawn to the edge of a wash as it dries and carries pigment with it, leaving a darker rim.
- **It granulates.** Pigment settles into the valleys of the paper and leaves a speckle.
- **It blooms.** Water added to a wash that holds more than the paper can keep pushes the damp edge outward.
- **Colours mix as pigments.** Yellow bleeding into blue goes green, by the same pigment mix the wet brushes use.

Wet paint dries by itself in a few seconds, at a rate the brush sets, and a **Dry now** command dries everything at once. Dry paint is permanent: a later wash glazes over it as a transparent layer of colour, and does not disturb it.

A fluid brush is still a brush. It has a tip, dynamics, scatter, colour jitter and a place in the library and the brush editor, and pressure can drive how much water it carries. The library ships four: a watercolour wash, a watercolour detail brush, an ink wash and a water brush that lays water and no pigment.

Wet paint belongs to the session. Anything that needs the layer's pixels to be final (saving, switching layer, exporting, a filter, a transform, a stroke with any other tool) dries it first. A reopened document is dry.

## User Stories

### Painting with a fluid brush

1. As an artist, I want a brush whose paint keeps moving after I lift the pen, so that I can paint watercolour and ink wash the way they behave.
2. As an artist, I want a second colour touched into a wet wash to feather into it, so that I can blend wet-in-wet.
3. As an artist, I want the same stroke on dry paper to keep a crisp edge, so that I can choose between soft and hard edges by where I put the brush.
4. As an artist, I want two pigments that bleed together to mix as paint does, so that yellow into blue gives green and not grey.
5. As an artist, I want a wash to dry with a darker rim, so that washes have the edge that makes watercolour read as watercolour.
6. As an artist, I want pigment to gather in the paper's texture as a wash dries, so that washes granulate.
7. As an artist, I want water dropped into a drying wash to push pigment outward, so that I can make blooms on purpose.
8. As an artist, I want a wash over dried paint to glaze it and leave it where it is, so that I can build a painting in transparent layers.
9. As an artist, I want a glaze of yellow over dried blue to read as green and darker, so that glazing behaves subtractively.
10. As an artist, I want to control how much water the brush carries, so that I can choose between a dry mark and a flooded one.
11. As an artist, I want to control how fast a brush's paint dries, so that I can choose how long I have to work into it.
12. As an artist, I want to control how far pigment bleeds, so that one brush feathers and another holds its shape.
13. As an artist, I want to control how strongly edges darken, so that I can have flat washes or rimmed ones.
14. As an artist, I want to control granulation per brush, so that some pigments settle and others stain flat.
15. As an artist, I want pressure, tilt or speed to drive the water a dab carries, so that a light touch is dry and a hard press floods.
16. As an artist, I want opacity dynamics to drive how much pigment a dab carries, so that pressure controls the strength of colour as it does on my other brushes.
17. As an artist, I want a fluid brush to use any tip, scatter and colour jitter, so that a splatter or a rake tip lays fluid paint in that shape.
18. As an artist, I want a brush that lays only water, so that I can soften a wet edge or start a bloom without adding colour.
19. As an artist using a mouse or a pen with no pressure sensor, I want a fluid brush to run at its set water and colour, so that it works without a stylus.
20. As an artist, I want the paper under every fluid brush to be the same paper, so that two washes granulate into the same texture.

### Drying

21. As an artist, I want wet paint to dry by itself, so that I do not have to manage it.
22. As an artist, I want a Dry now command, so that I can fix a wash at the moment it looks right.
23. As an artist, I want nothing on screen to change at the moment paint dries, so that drying never surprises me.
24. As an artist, I want paint to move the same way and end in the same place on a slow machine as on a fast one, only more slowly, so that my brushes mean the same thing everywhere.
25. As an artist, I want painting to stay as responsive while a wash is drying as when nothing is, so that the simulation never costs me the pen.

### Fitting in with the rest of the studio

26. As an artist, I want undo to take back my last fluid stroke while the wash is still wet, so that one mistake does not cost me the whole wash.
27. As an artist, I want the wash to carry on moving from where it was after that undo, so that undoing a stroke does not freeze or reset the rest.
28. As an artist, I want redo to put that stroke back, so that undo is safe to press.
29. As an artist, I want undo after paint has dried to remove the dried passage in one step, so that history stays simple once paint is fixed.
30. As an artist, I want a cancelled fluid stroke to leave the wash exactly as it was at pen-down, so that an accidental touch costs nothing.
31. As an artist, I want fluid paint to stay inside the selection and pool against its edge, so that a selection works as masking fluid.
32. As an artist, I want a fluid stroke to change only the active layer, so that layers stay independent.
33. As an artist, I want switching layers to dry what is wet, so that I never have wet paint on a layer I am not looking at.
34. As an artist, I want picking up any other tool or brush and using it to dry the layer first, so that tools never fight over the same pixels.
35. As an artist, I want filters, transforms, fills and export to work on the dried result, so that they see what I see.
36. As an artist, I want the layer's opacity, blend mode and mask to apply to wet paint as they will when it dries, so that the layer looks the same wet and dry.
37. As an artist, I want to pan, zoom and rotate while paint is drying, so that I can look closely at a wash as it moves.
38. As an artist, I want saving to include paint that was wet, so that I never lose a wash by saving at the wrong moment.
39. As an artist, I want a document I reopen to show the paint as it dried, so that the saved document is the picture I left.
40. As an artist, I want a fluid brush used on a layer mask to paint as an ordinary brush, so that masks keep working and nothing fails.
41. As an artist painting a very large wash, I want the oldest wet paint to dry early rather than my stroke to stop, so that the brush never refuses to paint.

### Brushes and the library

42. As an artist, I want to make any raster brush fluid from the brush editor, so that I can build my own watercolour brushes.
43. As an artist, I want the editor to show only the settings that apply to a fluid brush, so that I am not offered controls that do nothing.
44. As an artist, I want fluid brushes saved, duplicated, exported and synced like any other brush, so that they travel with my library.
45. As an artist, I want four fluid brushes in the library from the start, so that I can paint watercolour without building a brush first.
46. As an artist opening a brush made before this milestone, I want it to behave exactly as it did, so that nothing I own changes.

### For the people building it

47. As a developer, I want the simulation's step cost and memory per wet tile in the benchmark document, so that the wet tile limit is a measured number.
48. As a developer, I want the engine to offer "advance the simulation N steps" and "dry now", so that browser tests are deterministic and never sleep.
49. As a developer, I want tiles to keep one writer, so that undo, flush, sync and hashing need no new cases for moving paint.

## Implementation Decisions

**Brush model (D23).** Fluid is an optional `fluid` setting on a raster brush's rendering, beside `wet`. The two are exclusive, and a brush with neither is unchanged. It holds five numbers, each zero to one: `water`, `drying`, `bleed`, `edge` and `granulation`. How fast water levels, how much the paper holds before a wash spreads, paper relief and how much dried pigment lifts back are engine constants, not brush settings. When `fluid` is set, `blendMode`, `accumulation`, `wetEdge` and `wet` are ignored. `water` is a new dynamics target. Opacity and flow drive the pigment a dab carries. The wet spacing floor (live brushes 10) does not apply: a fluid dab copies nothing.

**Where wet paint lives.** Wet paint is held in a **wet surface** belonging to the active layer, not in the layer's tiles. Tiles change only when paint **settles**. Tiles therefore keep one writer and stay immutable and content-hashed between settles, and undo, flush and sync see only settled pixels. The wet surface is session-local GPU state: it is not a tile kind, is not stored, and is not synced. D3, D6, D12 and `.velura` are untouched.

**Wet tiles.** The wet surface is sparse on the document's own 256 px tile grid. A **wet tile** holds a slot in three field textures, each simulated at **half resolution** (128 × 128 cells per tile):

- water: standing water, paper dampness, and the flow across two of the cell's faces
- suspended pigment, premultiplied by density
- deposited pigment, premultiplied by density

Alpha in the pigment fields is pigment density, not coverage. Each field exists twice, since a step reads one copy and writes the other. That is 0.75 MB per wet tile.

A dab reaching a tile allocates it and its eight neighbours, so a bloom can cross a border; a cell in a tile with no slot reads as dry paper, and with the ring allocated the prototype showed no seam at a border and a hard wall without it. Wet tiles joined through allocated neighbours form one **body** of water. A body shares one drying deadline, pushed forward by every dab that lands in it, and settles and frees its slots together, so no seam can appear between a settled tile and a wet neighbour. The deadline is a count of steps from the brush's drying rate, not a GPU readback; the prototype's audit found no water left in any tile freed this way. It is not proved, and does not need to be: settling lands whatever is in the fields, so a deadline that came early is paint that dried early.

The shape the prototype settled on, kept pure of GPU and DOM:

```
touch(tileX, tileY)            // a dab reached this tile: allocate it and its ring; false when out of slots
refresh(tileX, tileY, until)   // push the deadline of every tile in the same body
expired(step) -> slots         // whole bodies whose deadline has passed
release(slot)
```

**The wet tile limit.** There are 64 slots (48 MB), which is the number the worst-case step fits in under two milliseconds on the prototype's GPU. When a dab needs a slot and none is free, the body with the earliest deadline is settled to make room. The brush never refuses to paint. The benchmark ticket confirms or moves the number.

**The simulation step.** One compute pass over every wet tile, the engine's first compute pipeline. The rules are the prototype's:

- *Water levels.* Flow across a face follows the difference in water height (plus a small paper relief), and no cell gives more than a fifth of its water across one face in a step. This is the overdamped model. It is what keeps the edge of a wash fed and pinned; a flow proportional to the donor's water lets edges recede and gives no edge darkening. A momentum term was tried, produced the same pictures at the same cost, and is not built.
- *Water stays on damp paper.* Water moves only between two damp cells. Dampness advances into dry paper only beside water standing deeper than the paper holds, which is a bloom; otherwise the edge of a wash stays where the brush put it.
- *Water evaporates,* faster near the edge of the damp area, where "near" looks a few cells out so the rim is a band and not one cell. The brush's `drying` sets the rate and `edge` sets how much faster the rim dries.
- *Pigment rides the water.* The fraction of a cell's water that crosses a face carries the same fraction of its suspended pigment. That one rule gives edge darkening, and blooms with it. Pigment also diffuses between two cells that both hold water, at the brush's `bleed`.
- *Pigment deposits,* faster in the paper's valleys by the brush's `granulation`, and completely once a cell's water is gone. A little deposited pigment lifts back while water stands on it.
- *The selection is in every gate.* Coverage multiplies flow, dampness and diffusion, so paint pools against a selection's edge and does not cross it.

**The clock.** The step is fixed, and the simulation resolution is fixed, so a wash ends in the same place on every machine. The clock aims at 120 steps a second: one a frame on a 120 Hz display and two on a 60 Hz one. The simulation has a budget of two milliseconds a frame; when a frame is over, steps are skipped, and paint moves and dries more slowly in wall time. D30 is unchanged and is the stroke's: the simulation gives way, the pen does not. The frame loop runs while any tile is wet and stops when none is, so an idle document costs nothing.

**Pigment mixing.** Two quantities of paint meeting in the simulation are combined by a new shader function beside the existing mix (D41): their densities add, and the colour is the Kubelka–Munk mix of the two weighted by density. Mixing in linear RGB was measured at about 60% of the cost and gives grey where this gives green; it is not used.

**Glaze and settle.** Paint of some density over what is beneath it is a transparent film: its amount is `1 − exp(−density)` and its colour is mixed with what is beneath by the existing pigment mix. One shader function does this, and both the screen and settle call it, deposited pigment first and suspended pigment over it. That is the whole of the rule that nothing changes at the moment of drying. Settle writes the result into the layer's tiles for the bodies settling, then frees their slots.

**Compositing (D19, §6.3).** The wet surface is composited inside the active layer, before the layer's opacity, blend mode and mask, by the present pass that already samples the active layer and the stroke buffer through the view. The caches are not involved: wet paint is only ever on the active layer, and painting still never rebuilds a cache.

**Paper.** One built-in procedural paper height texture, an engine constant, tiled across the document and shared by every fluid brush. The simulation reads it per cell. At half resolution that grain is coarse, so the composite also modulates deposited pigment by the paper at document resolution; both the screen and settle do, through the glaze function.

**The fluid stroke (§6.2).** A third stroke renderer behind the existing seam. Its dabs lay water and pigment into the wet surface; it reads and writes no tiles. Dabs are drawn batched, as the buffered stroke's are. The prototype applied dabs inside the step shader, which is not the decision; the cost of the batched deposit is measured in the ticket that builds it. Ending a stroke kept returns no mark for history to read back, since no tile changed.

**Forced settle.** Everything wet on the layer settles before: a flush (§9.2), a layer switch, export, a filter, a transform, a fill, a stroke by any tool or brush that is not fluid, a tab going hidden, and leaving the canvas. A fluid brush on a layer mask ignores `fluid` and paints as the brush otherwise is.

**Undo (D9, §8).**

- At pen-down of a fluid stroke the wet fields of every wet tile are copied on the GPU. The stroke is a history entry holding that copy. Undo while wet restores it and the simulation carries on from there; redo restores the copy taken at the moment of the undo. Cancel restores the pen-down copy.
- The copies are bounded by bytes and dropped oldest first.
- A settle, natural or forced, is one history entry over the tiles it wrote, recorded as every tile entry is. It removes the wet stroke entries from history: their copies describe fields that no longer exist.
- Undo with wet paint and no wet stroke entry left settles everything first and then undoes that entry.

So undo goes back stroke by stroke through what has been painted since anything last dried, and passage by passage before that. This rule goes further than the design session did, which settled only "copies at pen-down, one entry after settle"; the rest follows from bodies settling at different times.

**Architecture document.** A new decision row (D42, fluid brushes) records the choices above; §6.2 gains the third stroke renderer, the wet surface and the step; §6.3 the wet surface in the present pass; §8 the wet stroke entry and the settle entry; the deferred-features table drops fluid brushes and wetness. Each change lands in the ticket that makes it true.

## Testing Decisions

A good test here checks what the artist would see or what a stored brush means, through a contract the planned rewrites leave alone (architecture §9). Nothing is tested against the step shader, the field textures, the wet tile bookkeeping's internals or the stroke renderer interface. There are two seams, both existing.

- **Engine facade, in the browser.** Draw through the engine's public commands, advance the simulation a number of steps, and read pixels back, as the smudge and wet stroke specs do. The facade gains two commands for this: advance N steps, and dry now. No test waits on a clock. This covers: a second colour spreading further into wet paint than onto dry paper; a dried wash darker at its rim than at its centre; a selection holding paint in and paint pooling against it; pixels read back after settle equal to the last wet frame; dried paint under a later wash unmoved, and the overlap mixed; undo and redo while wet; undo after settle; cancel; a non-fluid stroke forcing a settle; a layer switch forcing a settle; only the active layer changing; flush and reload showing the dried paint; a stroke that outruns the wet tile limit still painting.
- **Pure layer, unit tests.** Brush validation and defaults for `fluid`, its exclusion with `wet`, the `water` dynamics target, local and Convex brush storage round-trips, and the clock's steps a frame within its budget (fluid brushes 13). Prior art: the smudge, brush storage and Krita preset unit tests.
- **Golden image.** One wash, with a Linux baseline from the first ticket that draws one (live brushes 16).
- **Benchmark.** Step cost at 16 and 64 wet tiles, the batched deposit, and a stroke held to D30 while the simulation runs, recorded in the benchmark document.

## Out of Scope

- **Persisted wetness.** Wet paint saved with the document or synced.
- **Oil with body:** paint thickness, impasto and lighting.
- **Directional flow:** gravity, tilt, paint that runs.
- **Rewetting.** Water does not lift or move dried paint.
- Ticketed as follow-ups, not built here:
  - document-level paper, chosen per document and stored with it
  - fluid brushes on layer masks
  - a blotting and lifting tool, which is where rewetting dried paint belongs
  - a pause-drying toggle
  - directional flow
  - watercolour preset import
  - bleed reach for large brushes (see Further Notes)

## Further Notes

**What the prototype measured** (Apple M4, worst case: every cell wet, every neighbour a different colour).

| Sim cells per tile | µs per wet tile per step | Wet tiles in a 2 ms step | MB per wet tile |
|---|---|---|---|
| 64 (quarter resolution) | 6.7 | about 300 | 0.19 |
| 128 (half) | 26 | about 75 | 0.75 |
| 256 (full) | 103 | about 19 | 3.0 |

Cost is linear in cells. Quarter resolution shows stair-stepped edges; half does not.

**Bleed reach is tied to the cell.** Paint moves at most one cell a step, so how far a wash bleeds is a number of cells, and at half resolution that is a few tens of document pixels over a wash's drying time. That suits brushes up to roughly 150 px. A 500 px brush on an 8192² canvas will bleed the same distance and look tight. Fixing it means more steps for large brushes or a coarser simulation under them, and is a follow-up ticket; this milestone ships the fixed resolution.

**What was tuned and what was not.** The prototype's defaults were tuned by screenshot, not by hand with a pen. The edge rim is thin and absent on the rounded ends of a stroke, and bloom fronts show small tick artefacts. The built-in brushes ticket is where the look is tuned on the real engine.

**Sequencing.** The wet surface first, with no simulation: a fluid stroke lays paint that settles at once, which proves the third stroke renderer, the present pass and settle. Then the step and the clock. Then forced settle and undo, which are what make it safe to use. Then edge darkening, paper and granulation, and selections, each a visible slice. The editor, the built-in brushes and the benchmark follow.
