# The performance benchmark

D30 states the target: **120 fps at 8192², under 10 ms pen-to-pixel**, with no
full-stack composite per frame, no CPU readback in the interactive path, and no
allocation inside the stroke loop. It is a design forcing function rather than
an acceptance threshold, and this benchmark is how the design is held to it.

Ticket 07 is the go/no-go on the engine architecture: if the numbers are far
off, the answer is to revisit the design rather than to build ticket 08 on top
of it. What follows is how the benchmark works, what the first run found, and
what that means for the design.

## Running it

```
bun run bench                  # records a run
bun run bench/run.ts --sweep   # the document-size ladder, for diagnosis
bun run bench/run.ts --layers  # the layer-count ladder, for the compositor
bun run bench/run.ts --scatter # a dense scattering brush against none
bun run bench/run.ts --smudge  # smudging the workload against painting it
bun run bench/run.ts --wet     # wet brushes over the workload against dry ones
bun run bench/run.ts --wet --opening # 8192² sampling openings against active-layer pickup
bun run bench/run.ts --fluid   # fluid brushes against the same brushes dry
bun run bench/run.ts --vector  # redrawing a vector layer of many paths (19)
bun run bench/run.ts --navigate # panning and zooming a stack (sharp-zoom 01)
```

It is tracked, not gated. The exit status is zero whatever the numbers say,
because a benchmark that breaks a build teaches people to make it quieter
rather than to make the program faster. The one exception is CPU readback in
the interactive path: that is a rule, not a measurement, and violating it fails
the run.

Each run writes two things into `bench/results`:

- `<timestamp>.json` — the whole run, every frame of it, so a number that looks
  wrong later can be re-read without re-running it on a machine that has since
  changed. Local; not committed.
- a line appended to `history.jsonl` — the summary, which is what a regression
  is spotted in. Committed. The runner prints the delta against the last run
  recorded on the same adapter.

## What it measures, and why there are two passes

The workload (`bench/workload.ts`) is twelve sweeping arcs across a full-size
document, sampled at 240 Hz — the fastest plausible stylus — with pressure
tapering in and out of each mark and the hand slowing somewhere in the middle.
It is seeded, so the same source produces the same strokes on every machine;
comparing runs depends on that.

The driver (`bench/driver.ts`) dispatches those samples as pointer events on
the engine's own canvas. Everything downstream is the shipped path: the
sampler, the ring buffer, the stabilizer, the arc-length resampler, the
dynamics graph, the stroke buffer, the display transform. A benchmark that
called the renderer directly would measure a program nobody runs.

Throughput and latency need opposite pacing, so the runner makes two passes.

- **Unpaced** (`--disable-gpu-vsync --disable-frame-rate-limit`) is where the
  frame rate comes from: the loop runs as fast as the engine allows rather than
  as fast as the panel allows. The cost is that the CPU races ahead of the GPU,
  so the fence that times pen-to-pixel resolves long after the pixel was
  wanted — in the first attempt at this, seconds after.
- **Paced** leaves vsync alone, so one frame is in flight and the fence means
  something. That is where pen-to-pixel comes from, and its frame rate is the
  panel's rather than the engine's.

Pen-to-pixel is measured from the pen sample's own event timestamp to the GPU
reporting the frame's work done, for the oldest sample the frame consumed. The
GPU side is `queue.onSubmittedWorkDone()` — a fence, not a copy. No pixel
crosses back to the CPU to time it, which would have contradicted the rule the
benchmark exists to check.

"Sustained" frame rate is the rate all but the worst 5% of frames beat, not the
median. A median that clears 120 fps while one frame in twenty stutters is not
a tool that feels alive.

## First run

Apple GPU (M-series, integrated), 75 Hz display, Chrome/WebGPU, commit
`fe1a783`, document 8192 × 8192, 12 strokes, 2889 pen samples, ~15,000 dabs in
the paced pass and ~12,500 in the unpaced one.

| | measured | target | |
|---|---|---|---|
| Frame rate, sustained (unpaced) | **70.9 fps** | 120 fps | missed |
| Pen-to-pixel, median (paced) | **18.2 ms** | 10 ms | missed |
| Pen-to-pixel, p95 (paced) | 22.8 ms | | |
| Main-thread time per frame | 0.1 ms median, 0.2 ms p95 (paced) | | |
| CPU readback during painting | **0 calls** | 0 | met |

Both targets are missed, by roughly a factor of two on each. That is close
enough to say the architecture is not disproven, and far enough that the cause
had to be found before ticket 08.

Two readings need care before the numbers mean anything.

The unpaced pass's *median* frame rate is not a number: with vsync off the
interval distribution is bimodal — a median frame of 0.4 ms where the CPU is
running ahead for free, and the real cost arriving when the queue backs up. Its
p95, the sustained figure, is stable across runs (70.9, 71.9, 72.5) and agrees
with the paced pass's own sustained figure of 69.4 fps. The two passes, timed
through completely different clocks, land within 2% of each other. That
agreement is what makes 70 fps trustworthy; the median is noise and is not read.

The dab counts differ between passes (14,984 against 12,467) because the pen is
paced by wall clock: when frames stall, the sample ring overruns and drops its
oldest samples by design. The runner therefore prints the dab-count delta
alongside the frame-rate delta, so a change in the work is never mistaken for a
change in the code.

## The bottleneck

Two costs, both proportional to the *document's* area rather than to the work
of painting.

### 1. The present pass, every frame

`bun run bench/run.ts --sweep` runs the document-size ladder, reporting the mean
frame interval — the average cost of a frame, which is what bimodality does not
distort:

| document | ms/frame | mean fps | pixels |
|---|---|---|---|
| 1024² | 0.325 | 3077 | 1.0 M |
| 2048² | 0.559 | 1788 | 4.2 M |
| 4096² | 1.933 | 517 | 16.8 M |
| 8192² | 6.279 | 159 | 67.1 M |

Above 2048² the cost tracks the area: four times the pixels, between three and
four times the milliseconds, over a fixed overhead of about a quarter of a
millisecond. Nothing about the workload changed across the ladder.

`Renderer.render` explains it. The present pass is one full-screen triangle
that reads the layer and the stroke buffer texel-for-texel — the display
transform shader says so in as many words: *"Texel-for-texel: the layer target
is the size of the swap chain."* And the swap chain is the size of the
document, because `resize` sets the canvas backing store to the document's
pixel dimensions. So every frame moves

    8192² × (8 B layer + 8 B stroke read + 4 B write) ≈ 1.34 GB

which at 6.28 ms is about 210 GB/s: the memory bandwidth of the machine it ran
on. The engine is not slow here; it is saturating the bus, once per frame,
whether or not anything changed.

Against a 120 fps budget of 8.33 ms, that one pass is 75% of the frame.

### 2. A full-document clear and composite at every stroke boundary

The sustained figure is worse than the mean because of a second, rarer cost.
The paced pass's interval distribution:

    median 13.3 ms   p95 15.1 ms   p99 132.2 ms   max 134.7 ms
    11 frames dropped, out of 900

The median is exactly the 75 Hz panel period, and 95% of frames are within a
panel period of it: for almost all of a stroke, the engine keeps up with the
display. Then eleven frames take about 130 ms each — one per stroke, for twelve
strokes.

Those are the stroke boundaries. `clearStroke` clears the entire stroke buffer,
and it is a load operation, which a scissor rectangle cannot narrow; at 8192²
that is a 1.07 GB write, and it runs twice per stroke (opening the stroke, and
again after the mark is composited). The composite itself is already scissored
to the painted region. The renderer says what it is waiting for: *"§6.2 wants it
bounded to the stroke's region; it narrows to a tiled surface with the
per-layer atlases (D-6.1)."*

This is what drags the p95 down to 70 fps while the median sits at 75. It is
also a hitch a painter would feel directly — an eighth of a second at the
moment the pen lands.

### What is not the bottleneck

The stroke path itself. Main-thread time is 0.1 ms a frame, median and p95, for
a median of 16 dabs. Sixteen dabs of radius 6 is a rounding error against 67 M
fragments of present. No CPU readback occurred in either pass, counted at the
WebGPU entry points while painting rather than inferred from the source. The
stroke buffer composites once per stroke, not once per frame, as D27 requires.

The 3.0 ms mean main-thread figure in the unpaced pass is a red herring worth
naming: the CPU is not computing there, it is stalling inside submission on a
queue the GPU cannot drain. Paced, the same work costs 0.1 ms.

### Layer count, also not a bottleneck

`bun run bench/run.ts --layers` paints the same workload on a document of two
layers and on one of fifty, at 1024², with a mark on every layer and the pen on
a layer in the middle of the stack — so both caches exist and both hold
something. Two runs on the same machine:

| layers | ms/frame | mean fps |
|---|---|---|
| 2 | 0.290, 0.296, 0.289 | 3446, 3380, 3455 |
| 50 | 0.324, 0.317, 0.316 | 3090, 3160, 3162 |

Twenty-five times the layers for about three hundredths of a millisecond, a
tenth of what one 1024² present pass costs. That is D19 doing
what it was chosen for: everything under the active layer and everything over
it are flattened when the structure changes, so a frame reads the two caches,
the active layer and the stroke buffer whatever the stack is. The layer count
moves the cost of a *structural* change — selecting a layer, reordering,
changing an opacity — and nothing else.

Two costs are hidden inside that number and worth naming. Fifty layers holding
pixels is fifty canvas-sized `rgba16float` textures until the per-layer atlases
land (D-6.1), which is why this ladder runs at 1024² rather than at 8192². And
a structural change is a clear and a draw per layer on one side of the stack,
which is why the ladder is measured with the pen in the middle of the stack
rather than at the top of it.

### Scatter, not a bottleneck either

`bun run bench/run.ts --scatter` paints the workload at 8192² unpaced, once
with a plain brush and once with the densest scatter a brush may ask for:
sixteen dabs per spacing step, thrown four radii along and across the path.

| scatter | ms/frame | mean fps | dabs | readbacks |
|---|---|---|---|---|
| none | 9.033 | 110.7 | 6,470 | 0 |
| ×16 | 9.204 | 108.7 | 103,520 | 0 |

Sixteen times the dabs for under two tenths of a millisecond. The frame is still
the present pass (§1 above), not the stamp pass: dabs are instances in one
draw, placed into a buffer allocated with the engine, so a step that lays
sixteen of them allocates nothing and reads nothing back. Neither run reaches
120 fps, and for the reason above, not this one: what this sweep shows is that
scatter adds nothing measurable to the frame, so it will reach D30 when the
viewport-sized present pass (ticket 13) lets the plain brush reach it;
that gap is tracked in brush-library ticket 14.

## What this means

**This is not the architecture failing.** D30 forbids a full-stack composite per
frame, and presenting the entire document at document resolution is exactly
that, in the display pass. Both costs are placeholders with replacements already
scheduled:

- The document-sized swap chain dates from ticket 01, when a canvas *was* the
  document. Ticket 13 replaces it: the swap chain becomes the size of the
  window and the display transform samples the document through a pan and zoom.
  At a 2560 × 1440 viewport — 3.7 M pixels, between the 1024² and 2048² rows of
  the ladder — the present pass costs well under half a millisecond.
- The document-sized stroke buffer is what §6.2 already says should be bounded
  to the stroke's region, and what D-6.1's per-layer atlases bound when they
  land. A stroke buffer the size of the mark makes the boundary clear
  proportional to the mark rather than to the canvas.

With the present pass at viewport resolution, the arithmetic for the target is
comfortable rather than marginal: 0.3 ms of present inside an 8.33 ms budget,
against 0.1 ms of stroke path. The latency case is the same one: 18.2 ms today
is approximately one 75 Hz panel period (13.3 ms) plus the present pass
(6.3 ms). At 120 Hz with a viewport-sized present that is about 8.3 + 0.3 ms —
inside the 10 ms target, though not by much.

**Recommendation: proceed to ticket 08.** The thing that would have stopped the
project — a cost that scales with the work of painting, or a GPU that cannot
keep up with stamping — is not what was found. What was found scales with the
document's size, is understood to the millisecond, and is removed by two
changes already in the plan.

**Re-run this benchmark once ticket 13 lands the view transform and D-6.1 bounds
the stroke buffer**, and treat that run as the real answer to D30. If a
viewport-sized present pass and a bounded stroke buffer do not reach the target,
the problem is the architecture and not the placeholder, and that is the point
to revisit the design.

## Vector layers: re-rasterising

A vector layer (19) is drawn into the layer's own float pixels, so the
compositor, blend modes, masks and clipping treat it like paint. The cost of
that choice is redrawing: an edit re-rasterises the region it changed, and an
edit that spans the layer redraws every path in it. `--vector` measures that
on a seeded scene (`bench/vector-workload.ts`) — a canvas-wide backdrop under
self-crossing polygons, filled, outlined or both — at 4096², timing each edit
from dispatch to the GPU's fence, so nothing is read back to time it.

Apple GPU (M-series, integrated), Chrome/WebGPU, on top of `6767fe5`, ms:

| paths | first draw | whole layer, median / p95 | one path, median / p95 |
|---|---|---|---|
| 500 | 48.1 | 5.5 / 11.4 | 3.0 / 8.6 |
| 2000 | 36.8 | 8.3 / 10.8 | 4.2 / 4.7 |
| 8000 | 265.9 | 17.5 / 21.7 | 6.3 / 7.9 |

The first draw is mostly tessellation on the CPU, done once per object and
cached for as long as the object is unchanged. A whole-layer redraw of two
thousand paths fits in a frame; an edit to one path redraws only its region,
and what it costs beyond that is the frame itself and the walk over the
scene's objects to find what the region touches.

On screen the layer is not sampled from those pixels: wherever the view
resamples, it is drawn from its cached meshes straight into the screen
through the view (sharp-zoom 02), so it is sharp at any zoom. Every pan or
zoom redraws it so. The same run then zooms to 8× and alternates a pan and a
zoom as `--navigate` does, timing each step from the start of its frame to
the GPU's fence (1024² viewport):

| paths | whole layer, median / p95 | one path, median / p95 | navigating at 8×, median / p95 |
|---|---|---|---|
| 500 | 6.7 / 9.5 | 4.5 / 4.9 | 2.4 / 5.8 |
| 2000 | 11.3 / 13.4 | 6.2 / 7.5 | 2.4 / 8.1 |
| 8000 | 26.0 / 38.9 | 13.3 / 16.4 | 2.1 / 6.8 |

Navigating costs little whatever the path count: at 8× only the paths whose
bounds reach the window are drawn, and the window is a fraction of the
document. The p95 is the step that zooms out, where more of the scene is on
screen. An edit now also hands the renderer the whole scene's meshes, uploaded
afresh, and the screen redraws the layer from them, so an edit's cost grows
with the scene on top of the region it re-rasterises; the one-path column
includes it.

## Navigating: caches rebuilt per view

The screen is composited at the window's resolution through the view
(sharp-zoom 01), so the caches around the active layer belong to the view and
every pan or zoom rebuilds them: a draw per layer at the window's size, once
per frame however many steps led to it. Painting still never rebuilds one, so
D30's claim is untouched; this is what navigating costs instead.
`--navigate` builds the layer ladder's stacks — each layer holding a mark, the
pen on the middle one — at 1024², and alternates a pan and a zoom, timing each
from the start of the frame that draws it to the GPU's fence.

Apple GPU (M-series, integrated), Chrome/WebGPU, ms:

| layers | viewport | before (document-space caches), median / p95 | after, median / p95 |
|---|---|---|---|
| 2 | 1024 × 1024 | 1.0 / 1.6 | 2.0 / 2.6 |
| 50 | 1024 × 1024 | 1.7 / 2.5 | 1.5 / 2.4 |

The two-layer row doubles: a rebuild costs a frame a fixed millisecond or so of passes and submissions whatever the stack. The rebuild is real — fifty layers is a submission per layer per step — and
does not show above the frame's own cost on this GPU: a 1024² draw is tens of
microseconds of bandwidth. Both rows sit an order of magnitude inside an
8.33 ms frame. The cost scales with the window's pixels times the layers
holding pixels, so the number to re-measure is a large window on a weak GPU.

## Caveats to read the numbers with

- The display was 75 Hz. The paced pass cannot exceed the panel, and its
  latency includes up to one panel period of waiting for a vsync that a 120 Hz
  machine would deliver 5 ms sooner. Re-run on a 120 Hz display before
  concluding the latency target is out of reach.
- One machine, one adapter. `history.jsonl` compares runs on the same adapter
  and refuses to compare across machines, because there is nothing to learn
  from that comparison.
- The sweep is a diagnostic, not a baseline: it runs six strokes rather than
  twelve and is not recorded to history. It is reproducible from the repo —
  `--sweep` — which is the point of it being in the runner rather than in a
  scratch script.
- The synthetic pen dispatches uncoalesced events; a real stylus delivers
  several samples per `pointermove` through `getCoalescedEvents`. The sample
  count reaching the engine is the same, so the stroke path sees the same work;
  the event dispatch overhead is slightly overstated.
- The benchmark is not the browser test suite. The suite runs on SwiftShader so
  its golden images mean the same thing everywhere, and a software rasterizer
  has nothing to say about this target. `tests/browser/benchmark.spec.ts` runs
  there to check that the benchmark still drives the engine and still observes
  frames — never to check a speed.

## Per-dab colour dynamics

`bun run bench --colour` exercises seeded hue, saturation and lightness
mappings through the regular 8192² painting workload. The recorded workload
includes `colourDynamics: true`, so colour runs can be distinguished from
neutral-ink runs.

Coverage selects the complete colour of the dab with greatest alpha at each
pixel; later dabs win equal-alpha ties. A `depth16unorm` attachment stores
inverse coverage, adding 128 MiB at 8192². The stamp pass is clipped to each
batch's bounds. Alpha differences within 1/65535 can effectively tie, below
the stored colour precision for ordinary marks. Buildup still uses
premultiplied over,
and both modes stamp a batch in one pass and composite once on pen-up. Colour
adjustment runs per vertex, with a neutral fast path that preserves existing
ink and goldens. No per-dab CPU allocation or readback is introduced.

On 2026-10-07, isolated runs on the same Apple GPU and 75 Hz display measured:

| 8192² workload | sustained FPS | median pen-to-pixel | p95 pen-to-pixel | painting readbacks |
|---|---:|---:|---:|---:|
| Unchanged `dev` (`d5bffc58`) | 76.3 | 18.7 ms | 24.0 ms | 0 |
| Colour jitter, bounded 16-bit depth | 75.8 | 19.0 ms | 24.2 ms | 0 |

These single runs show performance close to the existing baseline, not proof
of D30 compliance: both miss 120 FPS and 10 ms. An initial unbounded 32-bit
depth implementation measured 62.6 ms median latency; bounding the pass and
halving the depth attachment removed that regression. The history retains
that isolated intermediate run as well as the baseline and final run; the run
made concurrently with browser tests is excluded from history.

## D30 re-run: a screen-sized window (brush-library 14)

The view transform (sharp-zoom 01) made the screen compositor window-sized,
but the benchmark still dispatched an 8192² `resize` — the *window* — so every
frame still presented 67 M pixels: the §1 cost, measured on purpose. The
workload now paints the 8192² document through a 2560 × 1440 window with the
view fitted (`BENCHMARK_WORKLOAD.viewport`). Strokes are still authored in
document pixels across the whole document and mapped through the view, so the
stamp pass and the dab count are unchanged. History compares runs only against
runs with the same adapter, window and colour setting. The size and layer
ladders keep a document-sized window, because they measure document scaling.

Most of the throughput gain below is this change to what is measured, not a
change to the engine: the old workload measured a window no display has.

The baseline row was taken on a 60 Hz display, where the ticket's 76.3 FPS and
18.7 ms came from a 75 Hz one; the paced pass waits on the panel, so its
latency is not comparable across the two.

The stroke buffer's clears are now bounded too (§2): `clearStroke` draws a
far-plane triangle under a scissor over the union of the stamp passes since the
last clear, emptying colour and coverage depth together, rather than issuing a
load-op clear of 512 MiB of colour and 128 MiB of depth. A fresh depth texture
still gets one whole clear on its first stamp pass, because it starts at zero.

Apple GPU (M-series, integrated), 60 Hz display, Chrome 153/WebGPU, on top of
`da7d5bfc`, isolated runs with no test browser open:

| 8192² workload | window | sustained FPS | median pen-to-pixel | p95 pen-to-pixel | painting readbacks |
|---|---|---:|---:|---:|---:|
| Baseline `da7d5bfc` | 8192² | 71.9 | 22.4 ms | 25.8 ms | 0 |
| Region-bounded stroke clears | 8192² | 76.9 | 22.3 ms | 26.1 ms | 0 |
| Plus a screen-sized window | 2560 × 1440 | 476.2 | 17.0 ms | 18.6 ms | 0 |
| Repeat | 2560 × 1440 | 476.2 | 16.2 ms | 18.5 ms | 0 |
| `--colour` | 2560 × 1440 | 476.2 | 16.9 ms | 18.3 ms | 0 |
| `--colour`, repeat | 2560 × 1440 | 476.2 | 16.2 ms | 18.5 ms | 0 |

The sustained figure is the 2.1 ms p95 frame interval, quantized by the
timer's 0.1 ms resolution, which is why it repeats exactly. Throughput clears
120 FPS four times over, ordinary and colour alike.

Latency does not yet meet 10 ms on this machine, and cannot be shown to: the
latency is the oldest sample a frame consumes, so it is about one panel period
(16.7 ms at 60 Hz) plus a fraction of a millisecond of GPU work. At 120 Hz the
same arithmetic gives about 8.3 + 0.5 ms. Validating it needs a 120 Hz display;
that run is tracked in brush-library ticket 17.

## Smudge: the layer copy at stroke start (smudge 01)

Smudge is the first tool that writes the layer while the pen is down, so it
keeps a copy of the whole layer from before its first dab: what a cancelled
stroke is put back from. That copy is new work at every pen-down, and it is
the size of the document, not of the stroke. `bun run bench/run.ts --smudge`
weighs it: the workload's strokes are painted once, untimed, and then drawn
again along the same paths with the smudge tool, against the same strokes
painted with the brush. Paced, since pen-to-pixel means nothing otherwise.
The frame a stroke opens in is reported on its own, because that is the frame
the copy lands in.

Apple M4 (integrated), 75 Hz display, Chrome/WebGPU, 8192² document through a
2560 × 1440 window, six strokes, on top of `0659357`:

| tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks |
|---|---:|---:|---:|---:|
| Brush | 2.8 / 60.5 ms | 13.0 / 16.1 ms | 7,326 | 0 |
| Smudge | 21.7 / 60.9 ms | 15.5 / 19.6 ms | 5,467 | 0 |
| Brush, repeat | 2.9 / 35.3 ms | 13.0 / 15.7 ms | 7,326 | 0 |
| Smudge, repeat | 21.3 / 22.3 ms | 15.4 / 20.3 ms | 5,494 | 0 |

The copy costs about 19 ms, once, on the frame a smudge stroke opens in: a
512 MiB `rgba16float` texture allocated and filled from the layer. That is
more than one frame at this display's rate and more than two at 120 Hz, so
the first dab of a smudge stroke on an 8192² document shows a frame or two
late. It is a start-up cost and not a sustained one. The worst opening frame
moved between 22 and 61 ms from run to run for both tools alike, so it is not
read as the copy's.

After that a smudge frame costs about 2.5 ms more than a brush frame at the
median. Every dab is a small copy and a render pass of its own, where the
brush's dabs are instances in one draw, and the fixed four-pixel spacing puts
around twenty of them in a frame at this pen speed. Nothing is read back
while the pen is down.

The copy is the part that scales with the document, and it need not: only
the region the dabs reach is ever put back, so it can be taken tile by tile
as the stroke first touches each one. That is what smudge 06 built, below.

## Smudge: only the tiles a stroke touches are kept (smudge 06)

A smudge stroke no longer copies its layer at pen-down. Each 256² tile is
copied out the first time a dab is about to write to it, into 2048² pages
that hold 64 tiles each; a cancelled stroke copies those tiles back. The
frame a stroke opens in pays for the tiles under one dab, whatever the
document's size. `bun run bench/run.ts --smudge` now runs a 2048² document
beside the 8192² one, since the claim is that the two open alike.

Same machine, display and window as above, six strokes, on top of
`b964681`, two runs:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks |
|---|---|---:|---:|---:|---:|
| 2048² | Brush | 1.8 / 3.3 ms | 12.0 / 14.5 ms | 1,646 | 0 |
| 2048² | Smudge | 2.2 / 6.3 ms | 12.5 / 15.4 ms | 1,230 | 0 |
| 8192² | Brush | 2.8 / 38.5 ms | 13.0 / 15.1 ms | 7,308 | 0 |
| 8192² | Smudge | 3.0 / 12.5 ms | 15.3 / 19.1 ms | 5,494 | 0 |
| 2048², repeat | Brush | 1.8 / 2.9 ms | 12.2 / 14.0 ms | 1,642 | 0 |
| 2048², repeat | Smudge | 2.0 / 6.3 ms | 12.9 / 15.3 ms | 1,230 | 0 |
| 8192², repeat | Brush | 2.9 / 35.2 ms | 13.1 / 15.6 ms | 7,326 | 0 |
| 8192², repeat | Smudge | 2.7 / 13.9 ms | 15.3 / 19.8 ms | 5,494 | 0 |

The opening frame of a smudge stroke at 8192² fell from about 21.5 ms to
about 3 ms at the median, level with the brush's on the same document. What
is left between 2048² and 8192², about a millisecond, the brush pays too, so
it is the document's and not the smudge's. The worst opening frame fell from
22 ms and over to about 13 ms. Frames after the first cost what they did:
the per-dab copy and pass were not touched.

A stroke that reaches more than 64 tiles allocates another 32 MiB page as it
goes, once per 64 tiles. Pages past the first are released when the stroke
ends, and the first is kept for the next stroke. A stroke that covered the
whole of an 8192² layer would hold the 512 MiB the copy always did.

## Pigment mixing: wet sweep (live brushes 11)

`bun run bench/run.ts --wet` now measures the shared pigment model through
wet strokes over a prepainted blue ground, with yellow ink. It runs a paced
pass for pointer latency and an unpaced pass for throughput, at 64 px and
512 px diameter, with pickup zero and 0.8, on 2048² and 8192² documents.
Spacing is 0.125 of the diameter and flow is 0.3. The six-stroke workload and
2560 × 1440 viewport otherwise match the smudge sweep.

Apple M4, 75 Hz desktop display, real WebGPU adapter, 2026-10-10, model from
`e3a220e`:

| document | diameter | pickup | sustained fps | paced p95 latency | painting readbacks |
| --- | --- | --- | --- | --- | --- |
| 2048² | 64 px | 0 | 588.2 | 18.8 ms | 0 |
| 2048² | 64 px | 0.8 | 909.1 | 18.0 ms | 0 |
| 2048² | 512 px | 0 | 833.3 | 15.4 ms | 0 |
| 2048² | 512 px | 0.8 | 833.3 | 14.8 ms | 0 |
| 8192² | 64 px | 0 | 370.4 | 18.6 ms | 0 |
| 8192² | 64 px | 0.8 | 270.3 | 17.2 ms | 0 |
| 8192² | 512 px | 0 | 344.8 | 16.7 ms | 0 |
| 8192² | 512 px | 0.8 | 400.0 | 17.7 ms | 0 |

Every measured row clears D30's 120 fps throughput bar with the model on.
The latency bar remains unmet on this display, as in the earlier brush and
smudge measurements; this run does not establish under 10 ms. A 120 Hz
validation run is still required. Other painting benchmarks were running
on this machine during part of the sweep, so these are conservative shared
machine observations, not an isolated before/after regression comparison.
No wet spacing change is justified by these throughput results. This sweep
covers the pigment ticket's model-on measurement; ticket 10 still owns the
broader dry comparison, densest supported spacing and opening-frame analysis.

## Wet brushes hold D30: the spacing floor (live brushes 10)

The sweep above left this ticket the dry comparison, the closest spacing
and the opening frame. `--wet` now runs them. The ground is laid with the
brush itself, dry, so a dab of any size has paint under the whole of it;
each size is then painted over dry, wet with no pickup, wet with heavy
pickup (0.8), and wet with heavy pickup at the closest spacing a brush can
be given: 1% of its diameter, which an imported preset can ask for (the
editor stops at 2%). Spacing is otherwise the eighth of a diameter the
sweep above used. Each row is two passes: the frame's cost unpaced,
pen-to-pixel paced, with the frame each stroke opens in read on its own as
the smudge sweep reads it. The runner also counts the textures and buffers
created while the pen is down.

A wet dab does not batch. It is a copy of its neighbourhood and a draw into
the layer, then a second draw into the reservoir when it picks up, where a
dry brush's dabs are instances in one draw.

### What it found: the cost is the dab, not its size

With the spacing floor at one pixel, where it then was, a 64 px brush at 1%
spacing lays a dab every pixel: about 48 in a 75 Hz frame at the workload's
hand speed. Paced, model from `e3a220e`:

| document | brush | paint | pen-to-pixel, median / p95 | over dry | dabs in a frame |
|---|---|---|---:|---:|---:|
| 2048² | 64 px | Dry | 12.5 / 15.1 ms | | 74 |
| 2048² | 64 px | Wet, no pickup | 15.1 / 20.3 ms | 2.6 ms | 48 |
| 2048² | 64 px | Wet, heavy pickup | 18.0 / 24.0 ms | 5.5 ms | 48 |
| 8192² | 64 px | Dry | 13.3 / 15.7 ms | | 79 |
| 8192² | 64 px | Wet, no pickup | 21.2 / 44.2 ms | 7.9 ms | 51 |
| 8192² | 64 px | Wet, heavy pickup | 20.3 / 40.2 ms | 7.0 ms | 51 |
| 8192² | 512 px | Dry | 13.2 / 15.3 ms | | 10 |
| 8192² | 512 px | Wet, heavy pickup | 16.9 / 21.2 ms | 3.7 ms | 10 |

The 64 px brush missed D30 at a setting an artist can reach: paint half a
frame late at the median and three frames late at the p95. That is not the
case the ticket expected, which was the large brush. Fifty dabs of 64 px
cost twice what ten of 512 px do, though the ten move thirteen times the
pixels. A dab costs between a tenth and a sixth of a millisecond before its
size counts for anything: what it costs to begin and end a render pass on
this GPU, which a dry brush pays once a frame and a wet one once or twice a
dab. Before the pigment model landed, shrinking the reservoir's texture
from 2048² to 128² moved the 2048² figure by nothing, so it is not the
target's pixels either.

Size counts second. With the floor below in place, heavy pickup at the
floor on 8192², against a dry brush at 13.2 ms:

| brush | spacing | dabs in a 75 Hz frame | pen-to-pixel, median | over dry | per dab |
|---|---:|---:|---:|---:|---:|
| 64 px | 4 px | 12.7 | 15.0 ms | 1.8 ms | 0.14 ms |
| 128 px | 4 px | 12.7 | 15.4 ms | 2.2 ms | 0.17 ms |
| 200 px | 6.25 px | 8.1 | 15.0 ms | 1.8 ms | 0.22 ms |
| 256 px | 8 px | 6.4 | 14.5 ms | 1.3 ms | 0.20 ms |
| 400 px | 12.5 px | 4.1 | 14.3 ms | 1.1 ms | 0.27 ms |
| 512 px | 16 px | 3.2 | 14.3 ms | 1.1 ms | 0.34 ms |

Sixty-four times the pixels for two and a half times the cost. These are
single runs and the medians move by a few tenths between runs, so the last
column is good to about a quarter.

### The floor

So what a frame can afford is a number of dabs. **The wet spacing floor is
now four pixels, or a sixteenth of the dab's radius where that is more**
(from a 128 px brush up). It was one pixel. The workload's hand moves 33 px
in a 120 Hz frame, so at four pixels it lays about eight dabs there, and at
512 px two.

A blender is held to the same floor. It has no reservoir draw, but on the
8192² document the dab with no pickup cost as much as the dab with it, so
there was no measurement to give it a lower one.

The floor costs something. The four built-in wet brushes sat between 1.9
and 2.6 px at rest and are now held at four, and a wet brush under 32 px
across can no longer have dabs closer than an eighth of its diameter: an
8 px one is held at half. How that looks on the smallest brushes was not
judged here.

### With the floor

Apple M4 (integrated), 75 Hz display, Chrome/WebGPU, through a 2560 × 1440
window, six strokes, on top of `7dd55ad`, nothing else running:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry | 0.498 | 1428.6 | 1.7 / 6.4 ms | 12.3 / 15.6 ms | 617 | 0 | 0 |
| 2048² | 64 px | Wet | 0.506 | 1428.6 | 1.8 / 15.6 ms | 12.6 / 15.9 ms | 617 | 0 | 1 |
| 2048² | 64 px | Wet, pickup | 0.510 | 1428.6 | 2.0 / 17.6 ms | 13.0 / 16.5 ms | 615 | 0 | 1 |
| 2048² | 64 px | Wet, densest | 0.515 | 1250.0 | 1.9 / 17.1 ms | 13.7 / 16.8 ms | 1,226 | 0 | 1 |
| 2048² | 512 px | Dry | 0.525 | 1111.1 | 1.6 / 5.0 ms | 12.1 / 15.1 ms | 80 | 0 | 0 |
| 2048² | 512 px | Wet | 0.542 | 1111.1 | 2.0 / 11.9 ms | 12.5 / 15.0 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, pickup | 0.557 | 1000.0 | 1.8 / 11.7 ms | 12.6 / 15.3 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, densest | 0.573 | 1250.0 | 2.1 / 13.7 ms | 13.0 / 16.4 ms | 311 | 0 | 1 |
| 8192² | 64 px | Dry | 1.209 | 500.0 | 2.6 / 15.3 ms | 13.2 / 16.4 ms | 2,751 | 0 | 0 |
| 8192² | 64 px | Wet | 1.264 | 476.2 | 2.9 / 15.1 ms | 13.9 / 17.4 ms | 2,751 | 0 | 1 |
| 8192² | 64 px | Wet, pickup | 1.276 | 476.2 | 2.6 / 19.1 ms | 13.8 / 17.2 ms | 2,751 | 0 | 1 |
| 8192² | 64 px | Wet, densest | 1.348 | 476.2 | 2.7 / 19.9 ms | 15.1 / 18.8 ms | 5,498 | 0 | 1 |
| 8192² | 512 px | Dry | 1.240 | 476.2 | 3.2 / 12.5 ms | 13.0 / 16.1 ms | 348 | 0 | 0 |
| 8192² | 512 px | Wet | 1.292 | 476.2 | 4.6 / 14.7 ms | 13.3 / 16.6 ms | 348 | 0 | 7 |
| 8192² | 512 px | Wet, pickup | 1.376 | 454.5 | 2.8 / 16.8 ms | 13.2 / 16.4 ms | 348 | 0 | 7 |
| 8192² | 512 px | Wet, densest | 1.639 | 434.8 | 2.9 / 14.2 ms | 14.2 / 18.1 ms | 1,376 | 0 | 7 |
| 2048², repeat | 64 px | Dry | 0.498 | 1428.6 | 1.8 / 14.2 ms | 12.0 / 14.5 ms | 614 | 0 | 0 |
| 2048², repeat | 64 px | Wet | 0.509 | 1250.0 | 1.9 / 14.7 ms | 12.5 / 15.4 ms | 617 | 0 | 1 |
| 2048², repeat | 64 px | Wet, pickup | 0.510 | 1250.0 | 2.1 / 15.3 ms | 12.8 / 15.9 ms | 617 | 0 | 1 |
| 2048², repeat | 64 px | Wet, densest | 0.518 | 1250.0 | 2.1 / 16.6 ms | 13.5 / 17.9 ms | 1,226 | 0 | 1 |
| 2048², repeat | 512 px | Dry | 0.524 | 1111.1 | 1.7 / 4.7 ms | 11.9 / 15.2 ms | 80 | 0 | 0 |
| 2048², repeat | 512 px | Wet | 0.540 | 1111.1 | 1.8 / 11.3 ms | 12.2 / 15.0 ms | 80 | 0 | 1 |
| 2048², repeat | 512 px | Wet, pickup | 0.560 | 1000.0 | 2.0 / 11.1 ms | 12.3 / 15.2 ms | 80 | 0 | 1 |
| 2048², repeat | 512 px | Wet, densest | 0.573 | 1250.0 | 2.0 / 11.6 ms | 12.4 / 15.5 ms | 311 | 0 | 1 |
| 8192², repeat | 64 px | Dry | 1.211 | 476.2 | 2.5 / 12.0 ms | 12.8 / 15.6 ms | 2,742 | 0 | 0 |
| 8192², repeat | 64 px | Wet | 1.262 | 500.0 | 2.7 / 19.1 ms | 13.9 / 17.7 ms | 2,751 | 0 | 1 |
| 8192², repeat | 64 px | Wet, pickup | 1.271 | 476.2 | 2.7 / 22.3 ms | 14.0 / 17.5 ms | 2,742 | 0 | 1 |
| 8192², repeat | 64 px | Wet, densest | 1.350 | 454.5 | 2.8 / 20.5 ms | 15.1 / 19.0 ms | 5,507 | 0 | 1 |
| 8192², repeat | 512 px | Dry | 1.239 | 454.5 | 2.3 / 12.0 ms | 13.1 / 16.2 ms | 348 | 0 | 0 |
| 8192², repeat | 512 px | Wet | 1.295 | 454.5 | 2.9 / 13.9 ms | 13.2 / 16.7 ms | 348 | 0 | 7 |
| 8192², repeat | 512 px | Wet, pickup | 1.367 | 454.5 | 3.9 / 13.8 ms | 13.3 / 16.8 ms | 348 | 0 | 7 |
| 8192², repeat | 512 px | Wet, densest | 1.644 | 434.8 | 3.0 / 14.7 ms | 14.3 / 18.0 ms | 1,376 | 0 | 7 |

**Frame rate.** Every row sustains more than three times 120 fps, wet and
dry alike.

**Pen-to-pixel.** On this 75 Hz panel no brush reads under 10 ms, the dry
one included: its median is a hair under one panel period (13.3 ms), as it
has been in every section above. What matters here is what a wet brush adds
to it. At 8192² that is about a millisecond for the 64 px brush at an
eighth spacing, and about two (1.9 and 2.3) at the floor, where a 75 Hz
frame holds thirteen dabs; for the 512 px brush, a few tenths, and 1.2 at
the floor. A 120 Hz frame holds five eighths as many dabs, so at the floor
the 64 px brush would add 1.2 to 1.4 ms to a dry median a hair under
8.3 ms: about 9.6 ms, inside 10 and not by much. That is arithmetic and not
a measurement, as it is for the dry brush, and the 120 Hz run that settles
both is the one already owed (brush-library 17). If that run reads over
10 ms, the floor is the number to raise.

**The opening frame.** At the median a wet stroke opens in about 2 ms on
2048² and under 3 ms on 8192², within a few tenths of the dry brush on the
same document, so the difference between documents is the document's, as it
was for smudge. Pen-down fills the two reservoir textures and keeps the
tiles under one dab, and neither knows the document's size. Two 512 px rows
read higher in one run (4.6 and 3.9 ms) and not in the other. The worst
opening frame is one stroke of six; a wet brush's reads higher than the dry
brush's on the small document (11 to 18 ms against 5 to 14) and level with
it on the large one. It does not grow with the document, and was not
chased further.

**Readback and allocation.** Nothing is read back while the pen is down.
A dry brush creates no texture or buffer while it is down. A wet stroke
creates only the pages its cancel tiles are kept in (smudge 06): one for the
whole run where the strokes fit in a page, seven where six 512 px strokes
across an 8192² document each outgrow the first. Before this ticket there
was one more, the texture a dab's neighbourhood is copied into, which was
made to fit the first dab and remade whenever a dab outgrew it. It is now
allocated once with the renderer at the largest size a dab may ask for, as
the reservoir is: 32 MiB, held whether or not anything is smudged.

The dab counts for the 512 px brush at the floor on 2048² are 311 here; an
earlier run on the same settings recorded 375. The pen is paced by the
wall clock and the count follows what reached the ring, as the first
section says.

**Smudge.** Its spacing is its own and was not changed. `--smudge` on the
same commit:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks |
|---|---|---:|---:|---:|---:|
| 2048² | Brush | 1.9 / 2.8 ms | 12.0 / 15.1 ms | 1,646 | 0 |
| 2048² | Smudge | 2.1 / 6.7 ms | 12.8 / 16.0 ms | 1,230 | 0 |
| 8192² | Brush | 2.6 / 37.2 ms | 13.2 / 16.0 ms | 7,332 | 0 |
| 8192² | Smudge | 3.2 / 12.4 ms | 15.5 / 19.9 ms | 5,498 | 0 |

Level with what smudge 06 recorded (3.0 / 12.5 and 15.3 / 19.1 ms at
8192²), with the pigment model now in its mix. Smudge at its default size
lays a dab every four pixels, which is the wet floor. A smaller smudge goes
closer, down to a pixel, and by this section's arithmetic would not hold;
that is smudge's to answer (live brushes 19) and is not changed here.

## Smudge's spacing floor: measured, and left alone (live brushes 19)

`--smudge` gains a row: smudge at a radius of 4 px, where its spacing, a
quarter of its radius, is a pixel. Smudge's spacing as it is:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks |
|---|---|---:|---:|---:|---:|
| 2048² | Brush | 2.0 / 14.8 ms | 12.0 / 13.9 ms | 1,634 | 0 |
| 2048² | Smudge | 2.0 / 9.2 ms | 12.6 / 15.4 ms | 1,226 | 0 |
| 2048² | Smudge, 4 px | 1.9 / 7.9 ms | 15.2 / 20.3 ms | 4,911 | 0 |
| 8192² | Brush | 2.9 / 31.8 ms | 13.0 / 15.5 ms | 7,326 | 0 |
| 8192² | Smudge | 2.9 / 12.9 ms | 15.7 / 19.5 ms | 5,494 | 0 |
| 8192² | Smudge, 4 px | 2.3 / 19.6 ms | 21.0 / 42.0 ms | 21,972 | 0 |

A small smudge lays four times the dabs and does not hold: 21.0 / 42.0 ms on
the large document against 15.7 / 19.5 ms at its default size. The same row
under three floors that were tried, at 8192²:

| smudge's spacing | all frames, median / p95 | dabs |
|---|---:|---:|
| a quarter of the radius, a pixel at least (as shipped) | 21.0 / 42.0 ms | 21,972 |
| the wet floor, no wider than half the radius | 18.5 / 23.5 ms | 10,987 |
| the wet floor (four pixels) | 15.6 / 19.3 ms | 5,498 |

The wet floor holds the frame, level with smudge at its default size. It
does not hold the smear. A bar of paint was smudged out of its end along
80 px with the round tip at strength 0.9, and the paint left along the path
read back, as coverage from 0 to 1. A smear should only thin as it leaves the
paint; the ripple is the largest step back up between neighbouring pixels,
and the paint carried is the coverage gained past the bar's end, summed in
pixels.

| radius | spacing as shipped: ripple, carried | half-radius cap | third-radius cap | wet floor |
|---:|---:|---:|---:|---:|
| 2 px | 0.00, 13.1 | 0.00, 13.1 | 0.00, 13.1 | 0.48, 9.3 |
| 4 px | 0.00, 36.6 | 0.00, 31.6 | 0.00, 29.6 | 0.29, 25.2 |
| 6 px | not run | 0.15, 38.7 | 0.00, 43.1 | not run |
| 8 px | 0.00, 47.8 | 0.14, 43.9 | 0.03, 45.6 | 0.14, 43.9 |
| 12 px | 0.00, 49.1 | 0.02, 49.6 | 0.02, 49.6 | 0.02, 49.6 |

At four pixels a 4 px smudge leaves a comb, its coverage alternating between
0.82 and 0.51 two pixels at a time, and a 2 px smudge a dotted line, 0.46
and 0.01. A dab drags from the pixel one dab's travel behind it, so a pixel
is handed on once for every dab that covers it; once the dabs are further
apart than about a third of a radius the pixels of the path are not covered
the same number of times, and the difference is the comb. A floor capped at
a third of the radius keeps the smear and saves a quarter of the dabs, which
is not the frame; capped at a half it saves half of them and ripples between
5 and 10 px.

So smudge keeps its spacing, and a small smudge on a large document misses
D30 until its dab is cheaper: spacing cannot buy it (live brushes 22). The
bar is not dropped. The miss is recorded here as a miss.

A blender is the same dab and is held to the wet floor, so it leaves the
same comb below a radius of about 12 px: 0.48, 0.29 and 0.14 at 2, 4 and
8 px, measured the same way with pickup 0.9 (live brushes 23).

## Scatter on wet brushes: the floor times the count (live brushes 12)

A wet brush now scatters, and scatter count multiplies its dabs: sixteen a
spacing step at the most, each the copy and the draw (and the reservoir draw)
that the section above priced at a tenth to a sixth of a millisecond. `--wet`
gains two rows per brush: the densest scatter a brush can ask for (count 16,
thrown four radii across and along the path) painted dry, and the same wet
with heavy pickup. The ground is laid without scatter, so it is solid.

Apple M4 (integrated), 75 Hz display, Chrome/WebGPU, 2560 × 1440 window, six
strokes, 2026-10-11, on top of `547f52e`. First with scatter reaching the wet
dab and the floor as live brushes 10 left it:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 0.584 | 1111.1 | 1.6 / 14.0 ms | 12.4 / 14.9 ms | 9,824 | 0 | 0 |
| 2048² | 64 px | Wet, scatter | 0.740 | 833.3 | 3.5 / 24.1 ms | 26.2 / 77.4 ms | 9,872 | 0 | 1 |
| 2048² | 512 px | Dry, scatter | 0.745 | 1000.0 | 3.8 / 5.3 ms | 12.1 / 15.4 ms | 1,280 | 0 | 0 |
| 2048² | 512 px | Wet, scatter | 1.218 | 909.1 | 5.7 / 15.2 ms | 15.0 / 18.4 ms | 1,280 | 0 | 1 |
| 8192² | 64 px | Dry, scatter | 1.584 | 434.8 | 4.1 / 17.9 ms | 14.1 / 17.7 ms | 43,984 | 0 | 0 |
| 8192² | 64 px | Wet, scatter | 3.916 | 158.7 | 6.4 / 37.3 ms | 141.6 / 443.5 ms | 40,656 | 0 | 2 |
| 8192² | 512 px | Dry, scatter | 1.840 | 416.7 | 9.0 / 15.8 ms | 14.0 / 17.0 ms | 5,568 | 0 | 0 |
| 8192² | 512 px | Wet, scatter | 1.554 | 188.7 | 46.7 / 46.7 ms | 20.6 / 24.0 ms | 1,456 | 0 | 7 |

The small brush misses by an order of magnitude: sixteen times the dabs is
sixteen times the draws, and the paint falls a tenth of a second behind the
pen. (The 512 px wet row counts 1,456 dabs against the dry row's 5,568: the
paced count follows what reached the ring, and the frames had fallen behind
the pen.)

By live brushes 10's rule the floor rises and the bar does not drop. **The
wet spacing floor is multiplied by the scatter count**, so the dabs in a
frame are what they were without scatter: a wet brush laying sixteen dabs a
step is held to 64 px between steps, or to its radius where that is more. A
brush whose own spacing is wider keeps it. With that:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry | 0.618 | 1000.0 | 1.7 / 14.4 ms | 12.3 / 14.7 ms | 614 | 0 | 0 |
| 2048² | 64 px | Wet | 0.624 | 1000.0 | 2.0 / 42.8 ms | 13.1 / 15.6 ms | 614 | 0 | 1 |
| 2048² | 64 px | Wet, pickup | 0.627 | 1000.0 | 2.0 / 30.1 ms | 13.5 / 16.5 ms | 614 | 0 | 1 |
| 2048² | 64 px | Wet, densest | 0.632 | 1000.0 | 2.1 / 45.6 ms | 14.0 / 17.2 ms | 1,223 | 0 | 1 |
| 2048² | 64 px | Dry, scatter | 0.614 | 1000.0 | 1.9 / 13.7 ms | 12.5 / 15.2 ms | 9,824 | 0 | 0 |
| 2048² | 64 px | Wet, scatter | 0.670 | 909.1 | 3.9 / 51.7 ms | 14.2 / 16.9 ms | 1,280 | 0 | 1 |
| 2048² | 512 px | Dry | 0.655 | 909.1 | 1.7 / 6.8 ms | 12.6 / 14.9 ms | 80 | 0 | 0 |
| 2048² | 512 px | Wet | 0.685 | 1000.0 | 2.2 / 54.0 ms | 12.9 / 15.3 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, pickup | 0.714 | 1000.0 | 2.2 / 34.0 ms | 12.9 / 15.3 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, densest | 0.736 | 1000.0 | 2.0 / 40.1 ms | 12.9 / 15.8 ms | 310 | 0 | 1 |
| 2048² | 512 px | Dry, scatter | 0.776 | 1000.0 | 2.4 / 6.3 ms | 12.6 / 14.8 ms | 1,280 | 0 | 0 |
| 2048² | 512 px | Wet, scatter | 1.253 | 909.1 | 6.1 / 49.9 ms | 13.0 / 17.1 ms | 352 | 0 | 1 |
| 8192² | 64 px | Dry | 1.493 | 400.0 | 3.2 / 13.9 ms | 13.7 / 16.1 ms | 2,753 | 0 | 0 |
| 8192² | 64 px | Wet | 1.542 | 416.7 | 4.3 / 27.8 ms | 14.5 / 18.0 ms | 2,753 | 0 | 1 |
| 8192² | 64 px | Wet, pickup | 1.581 | 434.8 | 3.1 / 39.7 ms | 14.5 / 17.5 ms | 2,744 | 0 | 1 |
| 8192² | 64 px | Wet, densest | 1.671 | 384.6 | 3.7 / 20.2 ms | 15.6 / 19.2 ms | 5,494 | 0 | 1 |
| 8192² | 64 px | Dry, scatter | 1.524 | 416.7 | 4.0 / 17.5 ms | 13.8 / 16.4 ms | 44,080 | 0 | 0 |
| 8192² | 64 px | Wet, scatter | 1.888 | 344.8 | 6.1 / 31.3 ms | 16.2 / 20.2 ms | 5,568 | 0 | 2 |
| 8192² | 512 px | Dry | 1.514 | 400.0 | 5.0 / 11.2 ms | 14.0 / 16.7 ms | 348 | 0 | 0 |
| 8192² | 512 px | Wet | 1.656 | 416.7 | 3.8 / 34.1 ms | 14.1 / 17.9 ms | 348 | 0 | 7 |
| 8192² | 512 px | Wet, pickup | 1.728 | 384.6 | 3.7 / 35.6 ms | 14.2 / 17.5 ms | 348 | 0 | 7 |
| 8192² | 512 px | Wet, densest | 2.068 | 357.1 | 6.9 / 36.0 ms | 15.0 / 18.2 ms | 1,377 | 0 | 7 |
| 8192² | 512 px | Dry, scatter | 2.001 | 400.0 | 15.4 / 16.6 ms | 14.1 / 17.1 ms | 5,568 | 0 | 0 |
| 8192² | 512 px | Wet, scatter | 5.207 | 227.3 | 191.9 / 206.0 ms | 15.9 / 41.1 ms | 1,424 | 0 | 22 |

The 64 px scattering brush is back with the floor's own row: 16.2 / 20.2 ms
at 8192² against 15.6 / 19.2 ms for wet at the densest spacing, which lays
the same number of dabs, and every row clears 120 fps unpaced. Nothing is
read back. The worst first frames in this run are higher across the board
than in the section above, the unscattered rows included, and were not
looked into; the medians are level.

**What does not hold: a 512 px wet brush thrown four radii.** Its frames
are level in the median, but the frame a stroke opens in takes 192 ms and
the p95 is 41 ms. The count is not the cause, and so the floor is not the
cure. Varying one thing at a time on that row (8192², 512 px, single runs):

| scatter | pickup | ms/frame, unpaced | stroke's first frame, median / worst | all frames, median / p95 | allocations |
|---|---|---:|---:|---:|---:|
| ×16, 4 radii | 0.8 | 5.495 | 168.4 / 309.3 ms | 15.6 / 43.6 ms | 22 |
| ×16, stacked on the path | 0.8 | 1.706 | 10.1 / 31.6 ms | 14.5 / 21.7 ms | 6 |
| ×16, 1 radius | 0.8 | 2.550 | 14.6 / 34.9 ms | 15.1 / 23.6 ms | 9 |
| ×4, 4 radii | 0.8 | 5.512 | 190.8 / 306.4 ms | 16.2 / 71.0 ms | 22 |
| ×16, 4 radii | 0 | 2.506 | 27.0 / 80.8 ms | 15.0 / 24.9 ms | 22 |
| ×16, 4 radii, cancel pages kept between strokes | 0.8 | 4.401 | 51.4 / 67.5 ms | 15.3 / 26.3 ms | 6 |
| ×16, 4 radii, cancel pages kept between strokes | 0 | 2.240 | 15.0 / 54.9 ms | 14.5 / 21.3 ms | 6 |

It is the throw. A 512 px dab thrown a thousand pixels lands on tiles no dab
has touched, and each is copied out for a cancel (smudge 06); by arithmetic
the first step of a stroke can reach some 120 tiles at once, which is two
32 MiB cancel pages made in that frame, which the stroke
before had just released. Keeping the pages between strokes takes two
thirds off the opening frame in that run (and 2 ms in the runs of live
brushes 20, below, where the frame was 22 ms to begin with), at the cost of
holding them. What is left is
there only with pickup and was not found. Thrown within a radius the brush
is close to the rest of the table. This is the cancel backup's cost and not
scatter's, a dry brush pays nothing like it, and it is ticketed as live
brushes 20 and not fixed here.

## A wide-thrown wet brush's opening frame: pages kept, the frame still missed (live brushes 20)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-11, on top of `94f43cd`. The row live brushes 12
left open, 8192², 512 px, wet with heavy pickup, count 16 thrown four radii,
measured again before anything was changed, five runs:

| | stroke's first frame, median | all frames, median / p95 | allocations |
|---|---:|---:|---:|
| as live brushes 12 left it | 21.5 to 23.4 ms | 14.2 to 14.5 / 22.8 to 23.5 ms | 22 |

The 192 ms that section recorded did not come back on this machine on this
day: the opening frame is 22 ms. It is still a miss, against 3 ms for the
same brush unscattered, and the rest of this section is about that 22 ms.

**Cancel pages are now kept between strokes, up to four.** A stroke gave
back every page but the first as it ended, and the next made them again with
the pen down. Keeping them takes the allocations of this row from 22 to 9
and those of the unscattered 512 px rows from 7 to 3, and takes about 2 ms
off this row's opening frame (20.1 to 21.0 ms over five runs) and about 4 ms
with no pickup (11.5 to 12.5 ms down to 7.5 to 7.8 ms). It is not what the
opening frame is made of. Four pages are 256 tiles, a full step of sixteen
512 px dabs at the most a dab's box can cover, where this row's opening step
reached 91; the cost is up to 96 MiB more held between strokes (see the
architecture document). A stroke of this row needs five pages, so each still
makes one with the pen down, though not in the frame it opens in.

The other two things live brushes 12 left to decide were not done. Pages are
not allocated ahead of need: the frame that pays is the first, before there
is an ahead. And a wet brush's throw is not limited by its size: thrown one
radius the row opens in 10.1 ms but its p95 is still 21.7 ms (the table
below), so the limit would cost the brush its reach and not buy the frame.
With the pages kept:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 512 px | Wet, scatter | 0.979 | 909.1 | 4.2 / 12.7 ms | 12.3 / 17.1 ms | 352 | 0 | 1 |
| 8192² | 64 px | Wet, scatter | 1.496 | 416.7 | 5.3 / 25.8 ms | 15.5 / 21.0 ms | 5,552 | 0 | 2 |
| 8192² | 512 px | Dry | 1.246 | 500.0 | 2.4 / 11.4 ms | 13.0 / 16.2 ms | 348 | 0 | 0 |
| 8192² | 512 px | Wet | 1.288 | 454.5 | 3.0 / 16.8 ms | 13.2 / 16.2 ms | 348 | 0 | 3 |
| 8192² | 512 px | Wet, pickup | 1.359 | 476.2 | 3.0 / 16.5 ms | 13.4 / 16.0 ms | 348 | 0 | 3 |
| 8192² | 512 px | Wet, all layers | 1.357 | 454.5 | 19.7 / 82.2 ms | 13.2 / 16.2 ms | 345 | 0 | 4 |
| 8192² | 512 px | Wet, densest | 1.649 | 434.8 | 2.9 / 17.2 ms | 14.2 / 17.5 ms | 1,375 | 0 | 3 |
| 8192² | 512 px | Dry, scatter | 1.476 | 500.0 | 3.2 / 13.7 ms | 13.3 / 16.1 ms | 5,568 | 0 | 0 |
| 8192² | 512 px | Wet, scatter | 3.646 | 263.2 | 20.1 / 21.1 ms | 14.1 / 22.3 ms | 1,424 | 0 | 9 |

**The row still misses**: 20.1 ms to open and a p95 of 22.3 ms, where the
other 512 px wet rows open in 3 ms and hold 16 to 17.5 ms (sampling all
layers apart, whose opening frame is live brushes 21's). The bar is not
dropped and the miss is recorded as a miss (live brushes 24).

**What pickup costs.** Not the dab, and not fresh tiles. Varying one thing
at a time on that row, single runs, with every page kept so allocation is
out of the picture; the first column is what was changed, in the build or in
the bench, and none of it is shipped:

| changed | ms/frame, unpaced | stroke's first frame, median | all frames, median / p95 |
|---|---:|---:|---:|
| nothing | 3.69 | 20.9 ms | 14.5 / 22.5 ms |
| no pickup | 1.77 | 7.8 ms | 13.7 / 20.0 ms |
| pickup pass not drawn | 1.77 | 8.3 ms | 13.8 / 19.9 ms |
| pickup drawn, the dab lays a flat colour and not its load | 1.78 | 10.7 ms | 13.8 / 20.7 ms |
| pickup drawn, the load left as it was | 1.78 | 10.0 ms | 13.8 / 21.4 ms |
| pigment mix replaced by a linear one | 3.37 | 18.8 ms | 14.2 / 20.9 ms |
| reservoir square held to 128 px | 3.74 | 19.4 ms | 14.3 / 21.5 ms |
| pickup pass scissored to its square | 3.74 | 20.7 ms | 14.6 / 22.6 ms |
| dab's box one radius, not √2 radii | 3.62 | 21.0 ms | 14.4 / 22.2 ms |
| thrown one radius | 1.97 | 10.1 ms | 13.9 / 21.7 ms |
| stacked on the path | 1.37 | 9.0 ms | 13.8 / 19.6 ms |
| 640 × 360 window | 0.97 | 20.9 ms | 12.9 / 22.8 ms |

The pass that picks up is cheap: drawn in full and made to leave the load
alone, the row is as it is with no pickup. What costs is that the load stops
being one flat colour. A dab thrown wide lands across the ground's edge, the
bare canvas and the stroke's own earlier dabs, the load takes that patchwork
up, and every dab after it lays the patchwork down; laying a flat colour
instead, with pickup still running, takes the cost away. The pigment mix,
the size of the reservoir square, the area of the dab's copy and the present
pass are each not it.

Nor is it the sixteen dabs of the opening step. With the first draw of each
stroke skipped the frame still opened in 14.9 ms, and with a wet stroke's
scattered dabs laid one to a frame (tried, and not kept: a tap would lay one
dab where the same brush dry lays sixteen) a stroke opening on one dab took
16.7 ms and the p95 was 19.6 ms. The reservoir's clears at pen-down are not
it (filled as a tip-sized square instead: 20.7 ms), nor is the rest between
strokes (0, 120 and 1500 ms: the same), and the main thread does not stall
in the 60 ms after pen-down.

Two things were found that are part of it and not all of it. History keeps
each stroke's changed tiles and compresses the older ones, and tiles that
are not flat are slow to compress: with that compression off the opening
frame was 14.6 to 19.6 ms paced, and with no history recorded at all it was
15.4 to 16.6 ms against 20 to 22 ms, so some 4 to 6 ms is the stroke
before, still being put away. And the unpaced ms/frame of this row is not the frame's cost: the
mean is over every interval, the pause between strokes included, and
history's settling is in that pause (3.68 ms with history's compression on,
2.07 ms with it off).

It is the stroke and not the layer: the unscattered rows painted over a
ground this brush had already covered opened in 3.2 ms dry and 3.7 ms wet
with pickup. What the remaining 10 ms of a thrown, picking-up stroke's
first frame is was not found.

It was found later (live brushes 24, below): the wait before the stroke,
which the changes in the table above each shortened. That table measures
how long history took, and not what its rows name.

## Sample all layers (live brushes 15)

Measured on 11 October 2026 on Apple M4 with `bun run bench/run.ts --wet`, at `596d4c7`. The added row first paints its ground, adds an empty layer above it, enables sampling and runs the same wet workload. Other rows retain the active-layer source. Browser regressions ran concurrently with the early 2048² rows; the 8192² rows ran after them. The display remains 75 Hz.

| document | brush | paint | mean frame | sustained fps | first frame median / worst | latency median / p95 | dabs | painting readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | dry | 0.518 ms | 1250.0 | 1.6 / 6.9 ms | 12.5 / 14.8 ms | 5904 | 0 | 0 |
| 2048² | 64 px | wet | 0.530 ms | 1250.0 | 2.0 / 18.0 ms | 12.3 / 14.8 ms | 617 | 0 | 1 |
| 2048² | 64 px | wet, pickup | 0.566 ms | 1250.0 | 2.1 / 18.8 ms | 12.8 / 15.2 ms | 617 | 0 | 1 |
| 2048² | 64 px | wet, all layers | 0.545 ms | 1250.0 | 2.4 / 21.2 ms | 12.7 / 15.2 ms | 617 | 0 | 2 |
| 2048² | 64 px | wet, densest | 0.576 ms | 1111.1 | 2.1 / 21.5 ms | 13.5 / 16.2 ms | 1226 | 0 | 1 |
| 2048² | 512 px | dry | 0.597 ms | 1000.0 | 1.4 / 6.7 ms | 12.5 / 14.7 ms | 80 | 0 | 0 |
| 2048² | 512 px | wet | 0.652 ms | 1000.0 | 1.6 / 12.2 ms | 12.5 / 15.0 ms | 80 | 0 | 1 |
| 2048² | 512 px | wet, pickup | 0.667 ms | 1111.1 | 2.2 / 12.0 ms | 12.1 / 15.7 ms | 115 | 0 | 1 |
| 2048² | 512 px | wet, all layers | 0.716 ms | 833.3 | 2.7 / 19.4 ms | 12.2 / 14.6 ms | 80 | 0 | 2 |
| 2048² | 512 px | wet, densest | 0.601 ms | 1111.1 | 1.9 / 12.4 ms | 12.6 / 15.0 ms | 310 | 0 | 1 |
| 8192² | 64 px | dry | 1.228 ms | 476.2 | 2.5 / 14.9 ms | 13.1 / 15.2 ms | 2744 | 0 | 0 |
| 8192² | 64 px | wet | 1.282 ms | 476.2 | 2.6 / 21.5 ms | 14.0 / 16.8 ms | 2751 | 0 | 1 |
| 8192² | 64 px | wet, pickup | 1.289 ms | 476.2 | 2.9 / 20.9 ms | 13.9 / 16.4 ms | 2744 | 0 | 1 |
| 8192² | 64 px | wet, all layers | 1.323 ms | 454.5 | 16.6 / 42.1 ms | 14.0 / 16.6 ms | 2751 | 0 | 2 |
| 8192² | 64 px | wet, densest | 1.361 ms | 454.5 | 2.7 / 22.4 ms | 15.1 / 18.6 ms | 5481 | 0 | 1 |
| 8192² | 512 px | dry | 1.257 ms | 476.2 | 3.7 / 13.1 ms | 13.1 / 15.4 ms | 348 | 0 | 0 |
| 8192² | 512 px | wet | 1.309 ms | 454.5 | 2.9 / 17.1 ms | 13.2 / 16.1 ms | 348 | 0 | 7 |
| 8192² | 512 px | wet, pickup | 1.386 ms | 434.8 | 3.5 / 17.3 ms | 13.2 / 15.6 ms | 348 | 0 | 7 |
| 8192² | 512 px | wet, all layers | 1.366 ms | 434.8 | 16.4 / 40.8 ms | 13.4 / 16.1 ms | 348 | 0 | 8 |
| 8192² | 512 px | wet, densest | 1.665 ms | 434.8 | 2.8 / 17.7 ms | 14.4 / 17.4 ms | 1376 | 0 | 7 |

Sampling sustains **434–454 fps at 8192²**, above D30's 120 fps throughput target, with zero painting readbacks. Steady-stroke median/p95 latency is close to active-layer pickup: 14.0/16.6 ms against 13.9/16.4 ms at 64 px; 13.4/16.1 ms against 13.2/15.6 ms at 512 px.

**The opening frame is not held.** Freezing the whole artwork raises its median to 16.4–16.6 ms (worst 40.8–42.1 ms), against 2.9–3.5 ms for active-layer pickup. A single full-opacity normal surface can be copied directly, but later strokes also contain the new active paint and need full composition. Avoiding that document-sized freeze is follow-up 21 in the local live-brushes tracker. (Done since: see "Sampled artwork frozen where the stroke reads (live brushes 21)" below.) These measurements do not establish the under-10-ms pointer-to-pixel target; the existing 120 Hz display validation is also still required. The throughput pass must not be read as full D30 acceptance.

The frozen RGBA16F artwork costs 512 MiB at 8192², reused between strokes; an additional 32 MiB bounded destination carry is allocated with the renderer. The all-layer row allocates one extra texture on its first stroke, then only the existing cancel-backup pages. Hidden layers, group opacity, masks, blend modes and clipping use the artwork compositor, and no display background is baked into pickup.

## Sampled artwork frozen where the stroke reads (live brushes 21)

Measured on 12 October 2026 on Apple M4 with `bun run bench/run.ts --wet`, twice, on the working tree over `0b26302`. The display is still 75 Hz. The "wet, all layers" row is the one of ticket 15: a ground, an empty layer above it, sampling on.

The picture a stroke samples is no longer frozen whole at pen-down. It is flattened a 1024 px chunk at a time, each the first time a dab reads there, into pages of that size (architecture §6.2). The source is the same one, the artwork as it stood at pen-down, since a chunk is always flattened before the stroke has written in it.

| document | brush | paint | mean frame | sustained fps | first frame median / worst | latency median / p95 | dabs | painting readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | dry | 0.520 ms | 1250.0 | 1.7 / 8.7 ms | 12.1 / 14.5 ms | 615 | 0 | 0 |
| 2048² | 64 px | wet | 0.527 ms | 1250.0 | 1.8 / 19.9 ms | 12.3 / 14.7 ms | 617 | 0 | 1 |
| 2048² | 64 px | wet, pickup | 0.528 ms | 1250.0 | 2.0 / 20.5 ms | 12.9 / 15.7 ms | 615 | 0 | 1 |
| 2048² | 64 px | wet, all layers | 0.550 ms | 1250.0 | 2.3 / 23.6 ms | 12.9 / 15.9 ms | 617 | 0 | 6 |
| 2048² | 64 px | wet, densest | 0.541 ms | 1250.0 | 2.0 / 19.3 ms | 13.6 / 16.7 ms | 1230 | 0 | 1 |
| 2048² | 64 px | dry, scatter | 0.526 ms | 1428.6 | 1.6 / 7.1 ms | 12.2 / 14.2 ms | 9872 | 0 | 0 |
| 2048² | 64 px | wet, scatter | 0.564 ms | 1000.0 | 3.9 / 22.4 ms | 13.5 / 16.3 ms | 1280 | 0 | 1 |
| 2048² | 512 px | dry | 0.542 ms | 1111.1 | 1.6 / 5.5 ms | 12.2 / 14.4 ms | 80 | 0 | 0 |
| 2048² | 512 px | wet | 0.557 ms | 1000.0 | 1.9 / 11.9 ms | 12.1 / 14.9 ms | 80 | 0 | 1 |
| 2048² | 512 px | wet, pickup | 0.569 ms | 1000.0 | 2.1 / 11.1 ms | 12.3 / 14.6 ms | 80 | 0 | 1 |
| 2048² | 512 px | wet, all layers | 0.588 ms | 1111.1 | 3.0 / 18.6 ms | 12.5 / 14.9 ms | 80 | 0 | 6 |
| 2048² | 512 px | wet, densest | 0.585 ms | 1250.0 | 2.0 / 10.8 ms | 12.7 / 16.2 ms | 311 | 0 | 1 |
| 2048² | 512 px | dry, scatter | 0.634 ms | 1000.0 | 3.7 / 5.8 ms | 12.3 / 14.8 ms | 1280 | 0 | 0 |
| 2048² | 512 px | wet, scatter | 1.015 ms | 909.1 | 4.6 / 13.4 ms | 12.5 / 16.1 ms | 352 | 0 | 1 |
| 8192² | 64 px | dry | 1.227 ms | 476.2 | 2.6 / 15.8 ms | 13.1 / 15.2 ms | 2742 | 0 | 0 |
| 8192² | 64 px | wet | 1.275 ms | 476.2 | 2.8 / 19.8 ms | 13.9 / 16.9 ms | 2751 | 0 | 1 |
| 8192² | 64 px | wet, pickup | 1.286 ms | 476.2 | 2.8 / 22.7 ms | 13.9 / 16.5 ms | 2742 | 0 | 1 |
| 8192² | 64 px | wet, all layers | 1.319 ms | 454.5 | 3.5 / 37.9 ms | 13.9 / 16.9 ms | 2744 | 0 | 13 |
| 8192² | 64 px | wet, densest | 1.360 ms | 476.2 | 2.8 / 23.6 ms | 15.1 / 18.5 ms | 5481 | 0 | 1 |
| 8192² | 64 px | dry, scatter | 1.264 ms | 476.2 | 2.4 / 17.3 ms | 12.9 / 15.1 ms | 43904 | 0 | 0 |
| 8192² | 64 px | wet, scatter | 1.503 ms | 400.0 | 5.2 / 24.0 ms | 15.2 / 18.7 ms | 5568 | 0 | 2 |
| 8192² | 512 px | dry | 1.251 ms | 476.2 | 2.4 / 10.6 ms | 13.1 / 15.1 ms | 348 | 0 | 0 |
| 8192² | 512 px | wet | 1.307 ms | 454.5 | 2.8 / 14.8 ms | 13.1 / 15.4 ms | 348 | 0 | 3 |
| 8192² | 512 px | wet, pickup | 1.383 ms | 454.5 | 2.9 / 17.5 ms | 13.3 / 15.7 ms | 348 | 0 | 3 |
| 8192² | 512 px | wet, all layers | 1.360 ms | 434.8 | 5.7 / 36.6 ms | 13.5 / 15.8 ms | 348 | 0 | 21 |
| 8192² | 512 px | wet, densest | 1.673 ms | 434.8 | 2.8 / 14.1 ms | 14.3 / 17.3 ms | 1375 | 0 | 3 |
| 8192² | 512 px | dry, scatter | 1.495 ms | 476.2 | 2.9 / 12.9 ms | 13.3 / 15.6 ms | 5568 | 0 | 0 |
| 8192² | 512 px | wet, scatter | 3.692 ms | 270.3 | 20.8 / 23.6 ms | 14.4 / 22.2 ms | 1424 | 0 | 9 |

The repeat:

| document | brush | paint | mean frame | sustained fps | first frame median / worst | latency median / p95 | dabs | painting readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | dry | 0.517 ms | 1250.0 | 1.6 / 7.0 ms | 12.3 / 14.2 ms | 615 | 0 | 0 |
| 2048² | 64 px | wet | 0.520 ms | 1250.0 | 1.8 / 18.6 ms | 12.9 / 15.8 ms | 617 | 0 | 1 |
| 2048² | 64 px | wet, pickup | 0.522 ms | 1250.0 | 1.9 / 18.8 ms | 12.3 / 15.2 ms | 617 | 0 | 1 |
| 2048² | 64 px | wet, all layers | 0.542 ms | 1250.0 | 2.2 / 22.6 ms | 13.1 / 16.4 ms | 617 | 0 | 6 |
| 2048² | 64 px | wet, densest | 0.530 ms | 1250.0 | 1.9 / 17.2 ms | 13.4 / 17.4 ms | 1230 | 0 | 1 |
| 2048² | 64 px | dry, scatter | 0.524 ms | 1250.0 | 1.8 / 7.8 ms | 12.2 / 15.0 ms | 9872 | 0 | 0 |
| 2048² | 64 px | wet, scatter | 0.568 ms | 1000.0 | 5.0 / 23.1 ms | 13.3 / 17.1 ms | 1280 | 0 | 1 |
| 2048² | 512 px | dry | 0.541 ms | 1000.0 | 1.6 / 6.6 ms | 12.1 / 15.1 ms | 80 | 0 | 0 |
| 2048² | 512 px | wet | 0.558 ms | 1000.0 | 1.9 / 11.0 ms | 12.3 / 15.0 ms | 80 | 0 | 1 |
| 2048² | 512 px | wet, pickup | 0.570 ms | 1000.0 | 1.9 / 10.9 ms | 12.1 / 15.0 ms | 80 | 0 | 1 |
| 2048² | 512 px | wet, all layers | 0.586 ms | 1000.0 | 2.9 / 18.4 ms | 12.2 / 14.7 ms | 80 | 0 | 6 |
| 2048² | 512 px | wet, densest | 0.585 ms | 1250.0 | 1.9 / 9.9 ms | 12.8 / 15.9 ms | 311 | 0 | 1 |
| 2048² | 512 px | dry, scatter | 0.634 ms | 1111.1 | 3.4 / 7.3 ms | 12.2 / 15.3 ms | 1280 | 0 | 0 |
| 2048² | 512 px | wet, scatter | 1.000 ms | 909.1 | 4.7 / 12.4 ms | 12.7 / 17.0 ms | 352 | 0 | 1 |
| 8192² | 64 px | dry | 1.225 ms | 476.2 | 2.6 / 15.8 ms | 13.1 / 16.2 ms | 2751 | 0 | 0 |
| 8192² | 64 px | wet | 1.275 ms | 476.2 | 2.7 / 20.1 ms | 13.9 / 17.3 ms | 2744 | 0 | 1 |
| 8192² | 64 px | wet, pickup | 1.285 ms | 500.0 | 2.8 / 15.8 ms | 13.8 / 17.3 ms | 2749 | 0 | 1 |
| 8192² | 64 px | wet, all layers | 1.304 ms | 454.5 | 3.4 / 37.3 ms | 14.1 / 17.5 ms | 2744 | 0 | 13 |
| 8192² | 64 px | wet, densest | 1.365 ms | 476.2 | 3.1 / 26.0 ms | 15.2 / 19.1 ms | 5481 | 0 | 1 |
| 8192² | 64 px | dry, scatter | 1.265 ms | 476.2 | 2.7 / 16.6 ms | 13.1 / 16.1 ms | 44048 | 0 | 0 |
| 8192² | 64 px | wet, scatter | 1.501 ms | 400.0 | 5.4 / 25.9 ms | 15.7 / 19.3 ms | 5552 | 0 | 2 |
| 8192² | 512 px | dry | 1.252 ms | 476.2 | 2.4 / 13.0 ms | 13.2 / 16.0 ms | 348 | 0 | 0 |
| 8192² | 512 px | wet | 1.308 ms | 454.5 | 2.7 / 16.5 ms | 13.2 / 16.1 ms | 348 | 0 | 3 |
| 8192² | 512 px | wet, pickup | 1.384 ms | 454.5 | 4.2 / 14.8 ms | 13.3 / 16.0 ms | 348 | 0 | 3 |
| 8192² | 512 px | wet, all layers | 1.353 ms | 454.5 | 5.5 / 32.8 ms | 13.5 / 16.2 ms | 348 | 0 | 21 |
| 8192² | 512 px | wet, densest | 1.668 ms | 434.8 | 3.3 / 15.1 ms | 14.4 / 17.8 ms | 1376 | 0 | 3 |
| 8192² | 512 px | dry, scatter | 1.499 ms | 476.2 | 2.8 / 15.4 ms | 13.3 / 16.0 ms | 5568 | 0 | 0 |
| 8192² | 512 px | wet, scatter | 3.687 ms | 250.0 | 19.5 / 22.7 ms | 14.5 / 22.5 ms | 1424 | 0 | 9 |

**The opening frame is held at the median.** On 8192² a stroke sampling all layers opens in 3.4–3.5 ms at 64 px and 5.5–5.7 ms at 512 px, against 16.6 and 16.4 ms before, and 2.7–4.2 ms for active-layer pickup beside it. On 2048² it is 2.2–3.0 ms. The 512 px brush pays more than the 64 px one because its first dab reaches up to four chunks, each a clear, a pass per visible layer over a megapixel and an 8 MiB copy; a 64 px dab reaches one. Neither is a cost of the document's size: the same brushes on 2048² open within the same few milliseconds.

**The worst opening frame is not level with the other rows.** It is 32.8–37.9 ms on 8192² against 14.8–22.7 ms for the wet rows beside it (40.8–42.1 ms before). It is one stroke in six, the first to sample: on 2048² the same row's worst is 18.4–23.6 ms against 10.9–20.5 ms. What that stroke does that the others do not was not separated here; it is the stroke that allocates the first pages and the window compositor's targets. Follow-up 26 owns it; see [the initialization measurements below](#the-first-sampling-stroke-readying-its-textures-live-brushes-26).

Throughput and steady frames are where they were: 434.8–454.5 fps at 8192², median/p95 latency 13.9–14.1 / 16.9–17.5 ms at 64 px and 13.5 / 15.8–16.2 ms at 512 px, with zero painting readbacks. The other rows are within their run-to-run spread of the tables above; the "wet, scatter" 512 px row at 8192² still opens in 19.5–20.8 ms, which is ticket 24's.

**Memory.** The 512 MiB document-sized snapshot is gone. A page is 8 MiB; the allocations column counts them, and the cancel pages, as the stroke first needs them: 13 for the 64 px row at 8192² and 21 for the 512 px row across six strokes, 6 on 2048², where there are four chunks. Up to sixteen pages (128 MiB) are kept between strokes.

These rows do not establish the under-10-ms pointer-to-pixel target: a 75 Hz panel paces the median to about one 13.3 ms period whatever the engine does. The 120 Hz run is follow-up 25.

## Small blenders keep the smear, paying for closer dabs (live brushes 23)

A blender now caps its pitch at smudge's spacing: a quarter of the dab's
radius, at least one pixel. The wet performance floor still applies where
it is closer; a preset requesting a wider pitch cannot put the comb back.
This follows the actual dab radius as dynamics size it. Reservoir brushes
retain their existing floor and spacing.

The browser regression draws out of the same bar as the smudge spec, with
pickup 0.9. Radii 0.5, 1, 2, 4, 6, 8, 12, 16 and 32 px are checked for no
back-step larger than two displayed channel levels along the smear. At
radii below a pixel the tip may carry nothing that far; the check still
requires that it leave no comb.

**Reservoir brushes were checked too, and the earlier assumption needs
correction.** With white clean paint, pickup 0.9 and flow 0.3, a brush
leaving the red bar does carry red past its end, but it can ripple: at a
4 px radius the largest displayed green-channel back-step was 18 levels
at the four-pixel floor. The final single-worker check recorded 6, 18, 13
and 8 levels at radii 2, 4, 8 and 16 px respectively. Giving it smudge
spacing removed that small-tip
ripple in the trial, but at radii 16 and 32 px back-steps of 8 and 5 levels
remained even at smudge spacing. This is different from the blender's
pixel-behind hand-off: different bristles hold different paint. The check
records reservoir back-steps as test attachments; it does not assert that
a reservoir smear is monotone or lock in a particular ripple. Changing its
spacing does not establish the same guarantee, so its behavior is left
for separate investigation.

`bun run bench/run.ts --blender` reproduces a small-tip sweep on 2048² and
8192² documents. The measured stroke has pickup 0.9, flow zero for the
blender and 0.3 for the reservoir brush, and spacing 0.125 of the diameter.
The dry ground is laid at flow 0.3 before timing either stroke. The runner
accepts `VELURA_BENCH_PORT` to isolate it from other harness servers.

Measured on 12 October 2026 on Apple M4, on the working tree over `af3c4da`,
with browser tests stopped. Sizes below are **radii**; the runner prints
diameters. These are one run, not a claim about run-to-run spread.

| document | radius | paint | mean frame | sustained fps | first frame median / worst | latency median / p95 | dabs | painting readbacks | allocations |
|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 2 px | blender | 0.640 ms | 1000.0 | 2.5 / 29.9 ms | 16.3 / 21.5 ms | 4886 | 0 | 1 |
| 2048² | 2 px | wet, pickup | 0.765 ms | 833.3 | 2.2 / 20.7 ms | 13.7 / 17.2 ms | 1226 | 0 | 1 |
| 2048² | 4 px | blender | 0.630 ms | 1000.0 | 2.0 / 35.2 ms | 16.1 / 20.7 ms | 4886 | 0 | 1 |
| 2048² | 4 px | wet, pickup | 0.711 ms | 909.1 | 2.1 / 39.0 ms | 14.2 / 17.7 ms | 1223 | 0 | 1 |
| 2048² | 8 px | blender | 0.603 ms | 1000.0 | 2.5 / 22.4 ms | 14.1 / 17.5 ms | 2445 | 0 | 1 |
| 2048² | 8 px | wet, pickup | 0.604 ms | 1000.0 | 1.9 / 18.8 ms | 14.2 / 17.3 ms | 1226 | 0 | 1 |
| 2048² | 16 px | blender | 0.631 ms | 1000.0 | 2.7 / 23.4 ms | 13.1 / 15.9 ms | 1223 | 0 | 1 |
| 2048² | 16 px | wet, pickup | 0.616 ms | 909.1 | 2.1 / 24.3 ms | 14.1 / 16.9 ms | 1220 | 0 | 1 |
| 8192² | 2 px | blender | 2.192 ms | 243.9 | 3.1 / 22.3 ms | 23.6 / 72.1 ms | 21990 | 0 | 1 |
| 8192² | 2 px | wet, pickup | 1.569 ms | 416.7 | 4.0 / 26.5 ms | 15.3 / 18.9 ms | 5503 | 0 | 1 |
| 8192² | 4 px | blender | 2.230 ms | 303.0 | 4.4 / 14.9 ms | 23.5 / 65.4 ms | 21990 | 0 | 1 |
| 8192² | 4 px | wet, pickup | 1.592 ms | 400.0 | 3.5 / 18.9 ms | 15.4 / 19.1 ms | 5498 | 0 | 1 |
| 8192² | 8 px | blender | 1.770 ms | 357.1 | 3.9 / 17.1 ms | 18.9 / 24.9 ms | 10987 | 0 | 1 |
| 8192² | 8 px | wet, pickup | 1.628 ms | 400.0 | 4.0 / 29.0 ms | 15.4 / 18.8 ms | 5507 | 0 | 1 |
| 8192² | 16 px | blender | 1.592 ms | 400.0 | 4.4 / 16.3 ms | 16.0 / 20.2 ms | 5503 | 0 | 1 |
| 8192² | 16 px | wet, pickup | 1.610 ms | 400.0 | 3.1 / 29.8 ms | 15.3 / 19.0 ms | 5503 | 0 | 1 |

**The small blender does not hold the frame.** On 8192² the 2 and 4 px
radii lay about 21,990 dabs, four times the reservoir brush at its floor,
and median/p95 latency is 23.6/72.1 and 23.5/65.4 ms against 15.3/18.9
and 15.4/19.1 ms. At 8 px it lays twice the dabs and costs 18.9/24.9 ms;
at 16 px both brushes are back at four-pixel pitch and the blender costs
16.0/20.2 ms against 15.3/19.0 ms. The small-document medians are
16.1–16.3 ms at the two smallest sizes, against 13.7–14.2 ms with flow.

Throughput stays above 120 fps (243.9–303.0 fps at the smallest sizes on
8192²), but this does not establish D30: the smooth smear still pays too
many separate copy/draw dabs in a paced frame, as small smudge does. Making
those direct dabs cheaper is live brushes 22. All rows have zero painting
readbacks and one cancel-page allocation across the run. The existing
120 Hz display validation is still required; these timings do not establish
under-10-ms pointer-to-pixel latency.

## A run of dragging dabs shares a pass (live brushes 22)

Spacing could not buy a small smudge its frame (live brushes 19), so the dab
is cheaper. A dab that drags was a copy of its neighbourhood and a render
pass of its own, because a render pass cannot read what it writes, and the
pass is what cost. A compute pass can read one texture and write another
afresh at every dispatch. So consecutive dabs that read within one 256 px
square are now a run: the region is copied out of the layer once, each dab
is a dispatch that reads the region as the dab before left it and writes it
on, and what the last wrote is copied back. Two copies and one pass, however
many dabs. A dab whose own neighbourhood is over 256 px, which is a radius
past about 80 px, is drawn as before, and so is every dab of a wet brush
that lays paint.

`bun run bench/run.ts --smudge`, which now also counts the textures and
buffers created while the pen is down. Apple M4 (integrated), 75 Hz display,
Chrome/WebGPU, 2560 × 1440 window, six strokes, 2026-10-12, on top of
`af3c4da`. Before, on the same day and machine:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks |
|---|---|---:|---:|---:|---:|
| 2048² | Brush | 1.8 / 4.9 ms | 12.5 / 15.7 ms | 1,650 | 0 |
| 2048² | Smudge | 2.2 / 26.8 ms | 13.1 / 16.4 ms | 1,220 | 0 |
| 2048² | Smudge, 4 px | 2.1 / 41.3 ms | 15.5 / 21.8 ms | 4,886 | 0 |
| 8192² | Brush | 3.5 / 281.0 ms | 13.5 / 16.5 ms | 7,045 | 0 |
| 8192² | Smudge | 4.5 / 26.8 ms | 16.0 / 20.6 ms | 5,494 | 0 |
| 8192² | Smudge, 4 px | 3.3 / 14.6 ms | 24.6 / 77.1 ms | 21,990 | 0 |

After, two runs:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks | allocations |
|---|---|---:|---:|---:|---:|---:|
| 2048² | Brush | 1.7 / 32.5 ms | 12.0 / 15.1 ms | 1,634 | 0 | 0 |
| 2048² | Smudge | 2.1 / 18.8 ms | 12.3 / 15.8 ms | 1,223 | 0 | 1 |
| 2048² | Smudge, 4 px | 2.2 / 21.4 ms | 12.2 / 15.5 ms | 4,886 | 0 | 1 |
| 8192² | Brush | 3.0 / 226.1 ms | 13.6 / 16.4 ms | 7,102 | 0 | 0 |
| 8192² | Smudge | 3.6 / 15.3 ms | 13.4 / 16.8 ms | 5,494 | 0 | 1 |
| 8192² | Smudge, 4 px | 3.9 / 19.4 ms | 13.2 / 16.3 ms | 21,972 | 0 | 1 |
| 2048², repeat | Brush | 1.6 / 2.8 ms | 12.4 / 15.2 ms | 1,650 | 0 | 0 |
| 2048², repeat | Smudge | 2.1 / 7.0 ms | 12.1 / 15.1 ms | 1,226 | 0 | 1 |
| 2048², repeat | Smudge, 4 px | 2.1 / 7.4 ms | 12.2 / 15.4 ms | 4,911 | 0 | 1 |
| 8192², repeat | Brush | 2.7 / 16.2 ms | 12.9 / 15.9 ms | 7,314 | 0 | 0 |
| 8192², repeat | Smudge | 3.0 / 18.4 ms | 13.3 / 16.0 ms | 5,494 | 0 | 1 |
| 8192², repeat | Smudge, 4 px | 3.3 / 14.8 ms | 13.4 / 16.7 ms | 21,972 | 0 | 1 |

**The small smudge holds.** At 8192² the 4 px row is 13.2–13.4 / 16.3–16.7 ms
against 21.0 / 42.0 ms as live brushes 19 recorded it and 24.6 / 77.1 ms
before this change on the day: level with smudge at its default size
(13.3–13.4 / 16.0–16.8 ms), with four times the dabs. Both are now level
with the dry brush on the same document, where smudge at its default size
sat about 2.5 ms over it: a smudge frame is the panel's period, as a brush
frame is.

**The opening frame** is where it was at the median. The worst is the first
stroke of six in every row, before and after, and reads anywhere from 7 to
41 ms for smudge on either build; a dispatch run when the renderer is made,
to pay for the pipeline's first use ahead of the first stroke, moved it by
nothing and was not kept.

**Readback and allocation.** Nothing is read back. The one allocation in a
run is the page the stroke's cancel tiles are kept in (smudge 06), the first
stroke's, since each row is a fresh renderer: none per dab or per run. The
two run textures (256², a mebibyte between them) and the buffer the dabs of
a call are described in (128 KiB) are allocated with the renderer.

**The smear.** The compute pass does the render pass's arithmetic, with one
difference: where a pixel lies in the dab is worked out from the pixel
instead of interpolated across the dab's quad. On the suite's software
rasteriser a bar and a stripe were smudged along a path of four legs at
radii of 2, 4, 8, 16 and 40 px, before and after, and the pictures compared
as presented, in 8 bits:

| radius | channels that differ, of 115,200 | largest difference, of 255 |
|---:|---:|---:|
| 2 px | 342 | 3 |
| 4 px | 709 | 3 |
| 8 px | 1,474 | 5 |
| 16 px | 2,800 | 8 |
| 40 px | 1,223 | 2 |

Nearly all are one level. The few larger, 2 to 8 levels, sit in small
clusters along the smear; what sets those pixels apart was not separated.
That the interpolation is the whole of it was checked: with the render
pass given the same worked-out position, the two paths agree in every
channel of every picture. So it is not pixel for pixel against what shipped;
it is inside what the browser specs hold a smear to, which all pass
unchanged. Those specs are not golden images, and smudge has none, so this
is a weaker bar than the ticket set; and it is every smudge under about
80 px that moved, the default 16 px included, not the small ones alone. A
larger dab is still drawn by the render pass, so a large smudge and a small
one now differ by that rounding, and a dab that grows past the limit in
mid-stroke changes from one to the other. Giving the render pass the same
worked-out position would close that, and would move every wet brush's
pixels by the same rounding; it was not done here, and live brushes 27,
below, did it.

**Blenders.** A blender's dabs drag as smudge's do and go the same way.
Live brushes 23, above, gave a small blender smudge's spacing and recorded
it missing the frame for it. `bun run bench/run.ts --blender` with both
changes in, same machine and day, one run; sizes are radii, and the
"before" column is 23's table:

| document | radius | paint | latency median / p95, before | after | dabs | painting readbacks | allocations |
|---|---:|---|---:|---:|---:|---:|---:|
| 2048² | 2 px | blender | 16.3 / 21.5 ms | 12.3 / 14.5 ms | 4,898 | 0 | 1 |
| 2048² | 4 px | blender | 16.1 / 20.7 ms | 12.5 / 14.7 ms | 4,898 | 0 | 1 |
| 2048² | 8 px | blender | 14.1 / 17.5 ms | 12.0 / 14.2 ms | 2,451 | 0 | 1 |
| 2048² | 16 px | blender | 13.1 / 15.9 ms | 12.2 / 14.3 ms | 1,226 | 0 | 1 |
| 8192² | 2 px | blender | 23.6 / 72.1 ms | 13.2 / 15.6 ms | 21,972 | 0 | 1 |
| 8192² | 4 px | blender | 23.5 / 65.4 ms | 13.3 / 15.8 ms | 22,008 | 0 | 1 |
| 8192² | 8 px | blender | 18.9 / 24.9 ms | 13.3 / 15.3 ms | 11,005 | 0 | 1 |
| 8192² | 16 px | blender | 16.0 / 20.2 ms | 13.2 / 15.6 ms | 5,503 | 0 | 3 |

A small blender holds the frame at every size, with four times the dabs of
the reservoir brush beside it, which reads 14.8 / 18.1–18.6 ms on 8192² and
13.2–13.6 / 16.0–16.6 ms on 2048² in the same run: a blender is now the
cheaper of the two, since the reservoir brush's dabs are still a copy and
one or two passes each. The three allocations in the last row are cancel
pages, as six 16 px strokes across the large document reach more tiles.

**Validation on current dev.** On 2026-10-12, the committed implementation
was reapplied over `19d3285`, including live brushes 23's closer blender
spacing. The same Apple M4 smudge sweep, without browser-test load, measured:

| document | tool | stroke's first frame, median / worst | all frames, median / p95 | dabs | painting readbacks | allocations |
|---|---|---:|---:|---:|---:|---:|
| 2048² | Brush | 2.0 / 13.8 ms | 12.7 / 15.0 ms | 1,658 | 0 | 0 |
| 2048² | Smudge | 2.1 / 20.8 ms | 12.4 / 14.9 ms | 1,223 | 0 | 1 |
| 2048² | Smudge, 4 px | 2.1 / 10.2 ms | 12.7 / 15.3 ms | 4,898 | 0 | 1 |
| 8192² | Brush | 3.4 / 256.4 ms | 13.9 / 16.6 ms | 7,066 | 0 | 0 |
| 8192² | Smudge | 3.5 / 17.5 ms | 13.8 / 16.6 ms | 5,498 | 0 | 1 |
| 8192² | Smudge, 4 px | 3.5 / 14.6 ms | 13.8 / 16.2 ms | 21,990 | 0 | 1 |

The 4 px row remains level with the default-size smudge. This validation
preceded moving the unchanged compute shader body into a `.wgsl` file to
follow D34; the arithmetic and workgroup size remain the same.

## The run pass and the render pass are one smear (live brushes 27)

Live brushes 22 left a small smudge and a large one differing by the
rasteriser's rounding, and a few pixels by more with no account of why.

**What moved them by more than a level.** The rasteriser snaps a quad's
corners to its own grid before it draws, so what it interpolates across the
quad is the position in a quad a fraction of a pixel away from the dab. On
the suite's software rasteriser one hard-edged 16 px dab drawn each way
disagreed over a pixel whose centre lay 0.01 px from the rim, and the render
pass left out a pixel whose centre lay 0.01 px inside the quad's edge. Over most of a dab
that is nothing. At the rim the default dab falls from covered to clear in
one pixel, so a hundredth of a pixel of position is a level or more of
coverage: of the 16 pixels one dab left different at 16 px, the 7 that
differed by more than one level of 255 all lay between 0.95 and 0.98 of the
radius, inside the ramp that starts at 0.94. Each dab reads what the one
before wrote, so the smear carries those pixels along, which is the small
clusters. Along the four legs, as the layer stores it, before this change:

| dab | channels that differ, of 115,200 | by more than 1/255 | largest difference |
|---|---:|---:|---:|
| 16 px, rim of 1 px | 24,002 | 262 | 0.024 |
| 16 px, rim of 12 px | 21,714 | 0 | 0.004 |
| 16 px, hard edge | 21,941 | 620 | 0.80 |
| 4 px, rim of 1 px | 7,233 | 137 | 0.029 |

The softer the rim the smaller the difference, and with a hard edge a pixel
is in the dab one way and out of it the other. (More channels differ here
than in 22's table because these are the stored half floats, not the
picture in 8 bits.)

**The decision: the rounding is accepted, and the render pass is given the
compute pass's position.** The position worked out from the pixel is the
dab as the brush asked for it; the interpolated one was the dab moved to
the rasteriser's grid. So `fragmentMain` now asks the same function the run
does (`dabLocal`, `engine/shaders/dab-local.wgsl`), and the quad is drawn a
pixel wide of the dab with the fragment saying where the dab ends, as the
run's bounds test does, so the edge is not the rasteriser's either. A smudge
of any size, a blender that grows past the run's limit in mid-stroke, and a
wet brush are one arithmetic. Against what shipped before 22 a smudge has
moved by the table above, and a wet brush's dabs now move by the same. The
bar a smear is held to is that the two passes agree, not a golden image:
`tests/browser/smudge-passes.spec.ts` draws the same dabs through each
(discs of 2 to 40 px, a hard edge, a soft rim, a turned and narrowed tip,
and a dab that grows past the run's limit along the stroke) and holds the
layer to the same bits in every channel. A wet brush that lays paint has
only the render pass, so nothing can be compared for it; it shares the
fragment the test holds. The reservoir's
pickup pass draws the tip itself, not a dab on the canvas, and still
interpolates.

**What it costs.** Every fragment of a dab the render pass draws now turns
its own position back. `bun run bench/run.ts --wet`, Apple M4 (integrated),
75 Hz display, Chrome/WebGPU, 2560 × 1440 window, six strokes, 2026-10-12,
before and after on the same day, all frames median / p95:

| document | brush | paint | before | after |
|---|---|---|---:|---:|
| 2048² | 64 px | Wet, pickup | 12.7 / 16.8 ms | 12.9 / 15.7 ms |
| 2048² | 512 px | Wet, pickup | 12.5 / 15.4 ms | 12.4 / 14.6 ms |
| 2048² | 512 px | Wet, densest | 13.1 / 17.4 ms | 12.7 / 15.3 ms |
| 8192² | 64 px | Wet, pickup | 13.9 / 17.0 ms | 13.9 / 16.7 ms |
| 8192² | 512 px | Wet, pickup | 13.2 / 16.2 ms | 13.4 / 15.6 ms |
| 8192² | 512 px | Wet, densest | 14.4 / 17.7 ms | 14.3 / 17.5 ms |
| 8192² | 512 px | Wet, scatter | 14.3 / 22.4 ms | 14.2 / 22.2 ms |

Nothing that a run apart does not move. (A first run after the change read
three 8192², 64 px rows at 14.7–15.5 / 22.2–24.7 ms with dab counts up to
twice the row's own, while other work ran on the machine; the repeat above,
with it idle, did not.)

## A stroke after a pause opened late: cold textures (live brushes 24)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-12, on top of `0ed1d61`. The row live brushes
20 left open, 8192², 512 px, wet with heavy pickup, count 16 thrown four
radii, opened a stroke in 20.1 ms and held a p95 of 22.3 ms. They were two
things, and neither was pickup. The first is fixed here.

**The opening frame was the pause before it.** The frame's submissions were
each given a fence of their own (a scratch build, not shipped), and after a
thrown stroke the first of them, the two clears of the reservoir at
pen-down, took 14.5 ms to come back where it takes 1.1 ms after an
unscattered stroke, with the main thread free: the frame after it ran on
time. The benchmark waits for history between strokes, and history takes
about two seconds to put a thrown stroke's 300 to 500 patchwork tiles away,
so that row and no other went down two seconds after the last frame. Giving
the other rows the same wait gave them the same frame, 8192², paced, the
median opening frame of six strokes:

| row | waited for history only | and 500 ms | and 1000 ms | and 2000 ms |
|---|---:|---:|---:|---:|
| 512 px, wet, pickup | 3.0 ms | 5.0 ms | | 36.5 ms |
| 512 px, dry, scatter | 2.7 ms | | 22.1 ms | 32.9 ms |
| 512 px, wet, scatter | 20.6 ms | 39.4 ms | | 40.5 ms |

On a 2048² document the first of those rows opened in 13.6 ms after two
seconds. So it is any brush, it grows with the document, and it is the
wait. That is why the one-variable table of live brushes 20 read as it
did: laying a flat colour, laying no pickup, or throwing less each left
tiles that compress quickly, a shorter wait, and a frame on time. None of
those rows measured what it changed.

**It is the texture, left alone.** With no engine in the way,
`bun run bench/run.ts --cold` draws 512 px, scissored, into a texture the
size of a layer after leaving it for a time, and times the draw to the
GPU's fence, median of three:

| texture | left for | ms |
|---|---|---:|
| 2048² | 0 ms | 0.5 |
| 2048² | 500 ms | 2.2 |
| 2048² | 1000 ms | 2.2 |
| 2048² | 2000 ms | 6.9 |
| 2048² | 4000 ms | 6.5 |
| 2048² | 4100 ms, another texture drawn into every 800 ms | 2.1 |
| 2048² | 4100 ms, a pass that draws nothing into it every 800 ms | 2.0 |
| 8192² | 0 ms | 1.0 |
| 8192² | 500 ms | 2.1 |
| 8192² | 1000 ms | 2.3 |
| 8192² | 2000 ms | 24.6 |
| 8192² | 4000 ms | 24.4 |
| 8192² | 4100 ms, another texture drawn into every 800 ms | 19.2 |
| 8192² | 4100 ms, a pass that draws nothing into it every 800 ms | 1.8 |

A texture that no pass has drawn into for between one and two seconds
costs the next pass that does about 20 ms at 8192² rgba16float and 5 ms
at 2048², once, and the pass after it nothing. At 2048² a draw into
another texture meanwhile spared it; at 8192² it did not. Keeping the GPU busy does not prevent it: empty
command buffers, a small pass, or a clear of another 8192² texture every
16 ms each left the engine's opening frame where it was. A pass into the
same texture that loads, stores and draws nothing does prevent it. A copy
into or out of it pays the same on first use and leaves a draw still slow
by 4 to 5 ms. What the driver does to a texture left alone was not looked
into; the system compressed and swapped nothing during a run. It is this
machine's GPU and driver that were measured, and no other.

**So what a stroke draws into is kept warm**: every 800 ms while the artist
is at the canvas and no frame is in flight, one pass each that draws
nothing into the surface being painted, the stroke buffer and its coverage
depth, and the reservoir textures (see the architecture document). Warming
the surface alone took the thrown row's opening frame from 20 ms to 12 to
14 ms; the depth texture was 4 ms of a dry stroke's opening frame after two
seconds (9.5 ms with the two surfaces warm, 5 to 6.5 ms with it warm too).

**The rest is sixteen dabs in one frame.** With everything warm the row
opens in 10 to 12 ms and its p95 has not moved. By the dabs a frame drew,
paced, and the fence of the submission that drew them:

| frames that drew | frames | pen-to-pixel, median / p95 | the dabs' submission, median |
|---|---:|---:|---:|
| no dab | 362 | 14.0 / 16.3 ms | |
| sixteen dabs | 94 | 20.8 / 27.4 ms | 7.4 ms |

One frame in five draws a whole step, and the p95 of the row is inside
those: the floor times the count holds the dabs of a frame on the whole
and not in any one. Sixteen 512 px dabs with pickup are 7.4 ms of drawing,
0.46 ms each.

Holding a step's dabs and laying four a frame was tried and not kept. It
read well: the row opened in 5.5 ms and its p95 was 19.0 ms. But
pen-to-pixel is timed from the oldest sample a frame consumes, and a held
dab is laid one to three frames after the sample that placed it, which
the fence does not see. The paint was later and the number said earlier.
The dab has to be cheaper, and that is live brushes 29.

**The bench's unpaced mean now leaves out the pause between strokes.** It
was a mean over every interval between frames, the pen being up among
them, so a row's ms/frame carried however long history took: 3.65 ms for
the thrown row where a frame of it costs 1.06 ms. `summarize` is given
where each stroke began and drops the interval that ends there. The
unpaced figures in this table are lower than their like in the tables
above for that (0.31 ms against 0.52 ms at 2048², 0.86 ms against 1.3 ms
at 8192²); sustained fps is the p95 interval and barely moves. The
recorded history in `bench/results` compares runs made before and after
this as if they were alike, and they are not.

With the warming:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry | 0.311 | 1428.6 | 1.7 / 6.8 ms | 11.7 / 14.6 ms | 617 | 0 | 0 |
| 2048² | 64 px | Wet | 0.314 | 1428.6 | 1.9 / 15.8 ms | 12.4 / 15.4 ms | 617 | 0 | 1 |
| 2048² | 64 px | Wet, pickup | 0.314 | 1428.6 | 2.0 / 15.5 ms | 12.8 / 15.8 ms | 615 | 0 | 1 |
| 2048² | 64 px | Wet, all layers | 0.325 | 1428.6 | 2.5 / 24.4 ms | 12.7 / 15.4 ms | 614 | 0 | 6 |
| 2048² | 64 px | Wet, densest | 0.321 | 1250.0 | 2.0 / 17.4 ms | 13.5 / 17.3 ms | 1,230 | 0 | 1 |
| 2048² | 64 px | Dry, scatter | 0.317 | 1428.6 | 1.8 / 7.7 ms | 12.3 / 15.9 ms | 9,872 | 0 | 0 |
| 2048² | 64 px | Wet, scatter | 0.322 | 1111.1 | 3.9 / 17.2 ms | 13.6 / 17.7 ms | 1,280 | 0 | 1 |
| 2048² | 512 px | Dry | 0.310 | 1111.1 | 1.7 / 6.2 ms | 12.0 / 15.1 ms | 80 | 0 | 0 |
| 2048² | 512 px | Wet | 0.312 | 1250.0 | 1.9 / 12.1 ms | 12.1 / 14.8 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, pickup | 0.317 | 1111.1 | 2.0 / 10.9 ms | 12.1 / 14.7 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, all layers | 0.323 | 1000.0 | 3.7 / 16.7 ms | 12.2 / 15.2 ms | 80 | 0 | 6 |
| 2048² | 512 px | Wet, densest | 0.321 | 1428.6 | 2.0 / 13.2 ms | 12.8 / 16.3 ms | 311 | 0 | 1 |
| 2048² | 512 px | Dry, scatter | 0.312 | 1111.1 | 1.9 / 4.8 ms | 12.1 / 15.2 ms | 1,280 | 0 | 0 |
| 2048² | 512 px | Wet, scatter | 0.337 | 909.1 | 4.4 / 12.1 ms | 12.2 / 16.0 ms | 352 | 0 | 1 |
| 8192² | 64 px | Dry | 0.861 | 476.2 | 2.6 / 11.6 ms | 13.2 / 16.0 ms | 2,744 | 0 | 0 |
| 8192² | 64 px | Wet | 0.880 | 476.2 | 2.6 / 18.4 ms | 13.8 / 17.9 ms | 2,744 | 0 | 1 |
| 8192² | 64 px | Wet, pickup | 0.883 | 500.0 | 2.8 / 20.0 ms | 13.8 / 17.8 ms | 2,751 | 0 | 1 |
| 8192² | 64 px | Wet, all layers | 0.899 | 454.5 | 4.6 / 38.5 ms | 14.1 / 17.7 ms | 2,744 | 0 | 13 |
| 8192² | 64 px | Wet, densest | 0.912 | 476.2 | 2.8 / 23.6 ms | 14.8 / 19.0 ms | 5,481 | 0 | 1 |
| 8192² | 64 px | Dry, scatter | 0.857 | 500.0 | 3.6 / 16.8 ms | 13.0 / 15.8 ms | 44,016 | 0 | 0 |
| 8192² | 64 px | Wet, scatter | 0.930 | 400.0 | 5.8 / 26.3 ms | 15.7 / 19.2 ms | 5,568 | 0 | 2 |
| 8192² | 512 px | Dry | 0.840 | 476.2 | 2.3 / 9.9 ms | 13.1 / 15.8 ms | 348 | 0 | 0 |
| 8192² | 512 px | Wet | 0.852 | 476.2 | 3.1 / 13.3 ms | 13.3 / 16.1 ms | 348 | 0 | 3 |
| 8192² | 512 px | Wet, pickup | 0.866 | 476.2 | 4.9 / 13.6 ms | 13.1 / 15.9 ms | 348 | 0 | 3 |
| 8192² | 512 px | Wet, all layers | 0.880 | 500.0 | 4.2 / 30.4 ms | 13.4 / 16.8 ms | 348 | 0 | 21 |
| 8192² | 512 px | Wet, densest | 0.918 | 434.8 | 2.8 / 15.8 ms | 14.1 / 17.7 ms | 1,376 | 0 | 3 |
| 8192² | 512 px | Dry, scatter | 0.846 | 500.0 | 3.3 / 12.5 ms | 13.1 / 16.3 ms | 5,568 | 0 | 0 |
| 8192² | 512 px | Wet, scatter | 1.062 | 285.7 | 11.3 / 20.3 ms | 14.3 / 22.5 ms | 1,424 | 0 | 9 |

The 512 px "wet, scatter" row at 8192² opens in 11.3 ms, from 20.1 ms:
inside the panel's 13.3 ms frame, and not the 2.3 to 4.9 ms of the other
512 px rows, since it opens on sixteen dabs where they open on one. Its
p95 is 22.5 ms, where it was, against their 15.8 to 17.7 ms. The 64 px
"wet, scatter" row at 8192² is the same shape smaller: 5.8 ms to open and
a p95 of 19.2 ms. Both are the dabs of a step in one frame (live brushes
29). The other rows are within their run-to-run spread of the tables
above. The worst column is each row's first stroke, which no stroke before
it has warmed the pipelines or the pages for.

**History and the next stroke.** Waited for, history is out of the opening
frame: the wait made the textures cold and nothing else of it reached the
frame. An artist does not wait for it, and what history costs a stroke
begun while it is still putting the one before away was not measured on
what ships: a scratch run with the wait taken out of the driver, made
while the dabs were held, opened in 5.8 to 9.6 ms against 5.5 ms and held
a p95 of 21.6 ms against 19.0 ms. That is live brushes 28's.


## The first sampling stroke: readying its textures (live brushes 26)

Apple M4, Chrome 153/WebGPU (Metal), measured 75 Hz display, 2560 × 1440
viewport, 12 October 2026, working tree over `0172b20` (including live
brushes 24's texture warming). The first 64 px stroke sampling all layers
still opened in 37.6 ms; the second in 5.2 ms, in a focused two-stroke run
of the wet workload.

**First GPU use, not just texture creation.** The first stroke copies the
single painted ground directly, so it does not flatten through the window
compositor and cannot be waiting for that compositor's first pipeline.
Temporary submission fences showed the first ground-to-page copy finishing
9.3 ms after submission, followed by 8.8 ms to finish the first direct-dab
submission. Its main-thread work was 1.0 ms. The later page copy finished in
1.9 ms. These fences are diagnostic timings, not GPU timestamp queries.

The initialization probes used the same focused two-stroke workload on
8192² with a 64 px brush. Each waited for setup's GPU queue before enabling
sampling returned, to compare like with like. The page probes prepared
sixteen pages; the shipped change prepares only four.

| preparation before pen-down | first stroke's opening frame |
|---|---:|
| setup fence alone | 29.4 ms |
| create frozen pages, without filling them | 31.1 ms |
| create and fill frozen pages | 25.0 ms |
| initialize the destination carry | 25.0 ms |
| initialize both | 19.7 ms |

Creating the objects alone does not remove the cost. Filling both resources
with transparent pixels moves their first GPU use out of the opening frame.
The shipped four-page preparation opened in 21.3 ms in the focused run,
against 37.6 ms before, with zero painting readbacks. Diagnostic code is
not shipped; the acceptance repeat below uses the full sweep’s workload and metrics.

**What enabling sampling does.** It initializes the already-allocated
32 MiB destination carry once per renderer, using a temporary clear target,
and prepares up to four 8 MiB frozen pages and the 8 MiB window target. It
waits for that work before publishing the enabled setting. On documents
with fewer than four chunks it prepares only that many pages. Larger or
scattered opening neighbourhoods may still need more pages; the existing
sixteen-page retention cap is unchanged. No artwork is captured early and
no retained paint is cleared. Resize, import and initialization also prepare
the pages if sampling is already enabled.

The browser benchmark regression drives engine commands and counts actual
WebGPU entry points: on a 512² document, painting allocates only its cancel
page (one allocation), against three before (cancel page, frozen page,
window target). Existing sampling pixel tests hold the chunk boundary,
hidden layers, opacity, masks, groups, clipping, undo and retained loads.

The under-10-ms paced target still needs ticket 25's 120 Hz display.

**Acceptance measurement.** `VELURA_BENCH_PORT=3105 bun run bench/run.ts
--wet --opening`, with no other benchmark or browser suite running. The
optional filter runs the four rows below with the full wet sweep’s six
strokes, unpaced pass and paced pass unchanged. The preceding complete
`--wet` sweep shared the machine with a software-GPU browser suite; its
37.0 / 28.4 ms worst sampling openings are a loaded run, not this comparison.

| 8192² brush | paint | opening median / worst | all frames median / p95 | painting readbacks | allocations |
|---|---|---:|---:|---:|---:|
| 64 px | Wet, pickup | 2.7 / 21.9 ms | 14.1 / 16.6 ms | 0 | 1 |
| 64 px | Wet, all layers | 3.9 / 21.5 ms | 14.2 / 17.5 ms | 0 | 8 |
| 512 px | Wet, pickup | 3.5 / 14.9 ms | 13.3 / 16.5 ms | 0 | 3 |
| 512 px | Wet, all layers | 5.4 / 20.1 ms | 13.9 / 17.2 ms | 0 | 16 |

The sampling worst openings are now within the other wet rows’ 14.8–22.7 ms
range recorded by the ticket, instead of 32.8–37.9 ms. The 64 px row matches
its pickup control; the 512 px row still costs 5.2 ms more than its pickup
control. This removes the first-use spike, not every cost of sampling. The
allocations include cancel pages and further frozen pages as the six strokes
reach new chunks; preparation moves only the first four pages out of painting.


## History putting a stroke away, and the stroke after it (live brushes 28)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-12, on top of `954fb42`. The benchmark waits
for history between strokes and an artist does not, so what history costs
the stroke after the one it is putting away was in no row. It is now:
`bun run bench/run.ts --wet --unwaited` runs the scattering rows paced,
each with the wait and again without it, pen down 120 ms and two frames
after pen up.

**What history did on the main thread.** Timed in a scratch build, the
strokes of the 512 px "wet, scatter" row at 8192², which read back 130 to
480 tiles and found 95 to 347 of them changed:

| step | where | a stroke of 300 to 480 tiles |
|---|---|---:|
| the readback, to the buffer being mapped | GPU, awaited | 35 to 155 ms |
| each tile copied out of the mapped buffer | main thread, one task | 10 to 60 ms |
| each tile checked for blank, hashed (two FNV passes in script), and copied into the store | main thread, one task | 185 to 425 ms |
| each tile past the 64 MiB kept raw deflated, a `Blob` and a `CompressionStream` apiece, one after another | started and collected on the main thread | 1.6 to 2.0 s, some 5 to 8 ms a tile |

The second and third are single tasks: nothing else ran on the thread
until each was done, and the third alone is fifteen to thirty frames. The
raw pool holds 128 tiles, so most of a thrown stroke is compressed as
soon as it is stored. The compression's two seconds are wall time: how
much of it was the main thread's own was not separated out.

**What that cost.** One run before the change, the machine not otherwise
idle (its waited column is itself above the table of live brushes 24 in
places, the last row most of all, so read it for the difference and not
the figures):

| document | brush | paint | waited: first frame, median / worst | waited: all, median / p95 | unwaited: first frame, median / worst | unwaited: all, median / p95 |
|---|---|---|---:|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 1.9 / 14.0 ms | 12.4 / 14.8 ms | 5.5 / 20.0 ms | 13.9 / 19.2 ms |
| 2048² | 64 px | Wet, scatter | 4.4 / 25.2 ms | 14.2 / 17.6 ms | 14.2 / 37.4 ms | 21.4 / 30.2 ms |
| 2048² | 512 px | Dry, scatter | 3.1 / 7.2 ms | 13.1 / 15.5 ms | 4.3 / 8.6 ms | 13.2 / 20.4 ms |
| 2048² | 512 px | Wet, scatter | 11.6 / 15.3 ms | 13.9 / 22.4 ms | 8.9 / 13.7 ms | 13.3 / 23.5 ms |
| 8192² | 64 px | Dry, scatter | 2.6 / 15.1 ms | 13.6 / 18.4 ms | 4.4 / 19.1 ms | 14.1 / 18.3 ms |
| 8192² | 64 px | Wet, scatter | 8.7 / 25.8 ms | 17.9 / 21.9 ms | 18.1 / 26.8 ms | 28.3 / 103.3 ms |
| 8192² | 512 px | Dry, scatter | 3.5 / 12.2 ms | 14.0 / 16.5 ms | 12.1 / 23.5 ms | 15.0 / 22.0 ms |
| 8192² | 512 px | Wet, scatter | 38.4 / 48.4 ms | 15.8 / 44.4 ms | 20.5 / 42.2 ms | 16.6 / 28.2 ms |

The 64 px "wet, scatter" rows took it worst, a p95 of 30.2 ms against
17.6 ms and of 103.3 ms against 21.9 ms: their strokes change as many
tiles and draw more frames for history to be in the way of.

**So the hashing and the compression are a worker's.** The tile store is
given its work to do elsewhere (`engine/doc/tile-worker.ts`): a
readback's tiles are transferred to the worker, checked for blank and
hashed there, and handed back, so they are not copied and are stored as
they are; a tile being compressed or read back from the compressed tiers
is a message each way. The copy out of the mapped buffer stays on the
main thread, where the buffer is, and is taken a millisecond at a time
with the frame let in between. What is left on the main thread after a
stroke is that copy, some ten tiles to the millisecond, each into a
512 KiB array made for it; moving the index onto the hashes, a map lookup
a tile; and one 512 KiB copy for each tile sent to be compressed. Until
the worker has said it loaded the work is done on the main thread as
before, so a worker that cannot start costs frames and not pixels. One
that stops after it started is another matter: a tile it was compressing
or reading back is done on the main thread instead, having been sent as a
copy, but tiles it was hashing went with it, and that stroke is reported
as one that could not be recorded. That the worker starts is held by a
test (`tests/browser/history.spec.ts`), and in the product's own build it
was seen to.

With it:

| document | brush | paint | waited: first frame, median / worst | waited: all, median / p95 | unwaited: first frame, median / worst | unwaited: all, median / p95 |
|---|---|---|---:|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 1.7 / 7.8 ms | 12.1 / 14.3 ms | 1.8 / 8.8 ms | 12.1 / 14.7 ms |
| 2048² | 64 px | Wet, scatter | 4.1 / 19.7 ms | 13.4 / 17.0 ms | 3.9 / 18.4 ms | 13.1 / 16.4 ms |
| 2048² | 512 px | Dry, scatter | 1.6 / 6.3 ms | 12.2 / 14.3 ms | 1.6 / 5.9 ms | 11.9 / 14.2 ms |
| 2048² | 512 px | Wet, scatter | 4.9 / 12.6 ms | 12.6 / 16.9 ms | 4.7 / 11.7 ms | 12.6 / 16.9 ms |
| 8192² | 64 px | Dry, scatter | 2.4 / 15.6 ms | 12.9 / 15.3 ms | 2.3 / 13.4 ms | 13.0 / 15.2 ms |
| 8192² | 64 px | Wet, scatter | 5.1 / 25.1 ms | 15.5 / 18.8 ms | 5.5 / 24.3 ms | 15.8 / 19.4 ms |
| 8192² | 512 px | Dry, scatter | 2.6 / 17.8 ms | 13.8 / 17.0 ms | 2.8 / 15.2 ms | 13.3 / 16.6 ms |
| 8192² | 512 px | Wet, scatter | 11.7 / 28.9 ms | 14.2 / 22.7 ms | 10.8 / 24.7 ms | 14.5 / 23.1 ms |

A stroke begun while history is putting the one before away holds the
p95 it holds when history is waited for, to within 0.6 ms in every row,
and opens as it does then. The waited columns are the table of live
brushes 24 again: 22.7 ms for the 512 px "wet, scatter" row at 8192²,
which is the sixteen dabs of a step in one frame (live brushes 29) and
none of it history. No readback was begun with the pen down in the
unwaited runs: the one a stroke leaves starts on the frame after pen-up,
and it is what follows it that the next stroke used to wait behind.

**The benchmark gets the pass, as a flag and not in every run.** The
recorded run and the sweeps go on waiting for history: their rows are a
stroke alone, comparable with every run recorded before, and a row that
also carried whatever history was doing would say less about either.
`--wet --unwaited` is the pass a person's painting is, for when history
or the store is what changed.

**Not done.** The readback is still the tiles of the stroke's bounding
box, of which a thrown stroke changed half to three quarters: the rest
are read, hashed and found the same, on the worker now. The 160 to
256 MiB buffer that takes is a mapped allocation between strokes and was
not seen in a frame. That is live brushes 30's. Reading a tile back from
the compressed tiers for an undo goes through the worker too, a message
and a copy each way, and was not timed.


## History reads back the tiles a stroke drew into (live brushes 30)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-12, on top of `3600b4b`. A stroke was read
back as every tile of the box round it, in one buffer. The renderer now
says which tiles its dabs drew into and history reads those alone: a
direct stroke's are the tiles it kept for a cancel, each copied out as a
dab first wrote to it, and a buffered stroke's are those under each dab's
square out to √2 radii, which is as far as the stamp pass may write, of
the region that was landed.

`bun run bench/run.ts --wet --unwaited` gained two columns for it: the
largest buffer mapped for reading over the row's two runs, at 512 KiB a
tile, and the time from each pen-up to `engine.save()` resolving, median
and worst of the six strokes, taken in the run that waits for history
(unwaited, the stroke after is being recorded by then and the two are not
told apart). The harness has nowhere to save to, so that is history: the
two frames to the readback starting, the readback, the hashing, and the
compression of what is past the 64 MiB kept raw. One run each:

| document | brush | paint | largest readback, before | after | pen-up to history settled, median / worst, before | after |
|---|---|---|---:|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 12.0 MiB | 9.5 MiB | 26 / 28 ms | 23 / 27 ms |
| 2048² | 64 px | Wet, scatter | 12.0 MiB | 8.5 MiB | 23 / 31 ms | 25 / 28 ms |
| 2048² | 512 px | Dry, scatter | 32.0 MiB | 32.0 MiB | 125 / 131 ms | 131 / 134 ms |
| 2048² | 512 px | Wet, scatter | 32.0 MiB | 32.0 MiB | 452 / 558 ms | 461 / 570 ms |
| 8192² | 64 px | Dry, scatter | 101.5 MiB | 39.5 MiB | 190 / 300 ms | 102 / 156 ms |
| 8192² | 64 px | Wet, scatter | 98.0 MiB | 35.5 MiB | 259 / 293 ms | 150 / 204 ms |
| 8192² | 512 px | Dry, scatter | 240.0 MiB | 195.0 MiB | 620 / 641 ms | 485 / 552 ms |
| 8192² | 512 px | Wet, scatter | 240.0 MiB | 169.5 MiB | 1996 / 2429 ms | 2010 / 2274 ms |

The 64 px rows at 8192² read back some 200 tiles and now read 70 to 80,
and settle in a little over half the time. The 2048² document is 64
tiles, and a 512 px brush thrown across it draws into every one: nothing
to leave out. The 512 px "wet, scatter" row at 8192² reads 339 tiles
where it read 480, 70 MiB less to map and copy out, and settles no
sooner: its two seconds are the compression of the tiles that changed,
which are the same tiles as before; the hundred and forty left out
were hashed, found the same and dropped, and were not where the time
went. The dry
row beside it settles in a third of the time with more tiles read, and
does gain. The pen-to-pixel columns of the run are where
they were, within its spread.

That a stroke's readback is its dabs' tiles and no others is held by
tests: `tests/unit/history.test.ts` for what history asks of the bridge,
`tests/unit/tile-grid.test.ts` for the set, and
`tests/browser/history.spec.ts`, where a scattered stroke, dry and wet,
thrown corner to corner of a four by two tile canvas reads back six
tiles at most and is undone to the pixel, which a tile drawn into and not
read back would not be.

**Not done.** The two seconds a thrown 512 px wet stroke takes to be put
away are compression, a `CompressionStream` a tile on the worker, one
after another. It is off the main thread and costs the next stroke no
frames (live brushes 28), so it is left: what it could cost is an undo
pressed inside those two seconds, which waits, and that was not measured.
(It was in live brushes 32, below, and the undo no longer waits.)


## A large wet dab’s cost is deposition (live brushes 29)

Apple M4, Chrome 153/WebGPU, 2026-10-12. The diagnostic uses warm textures;
the old cold-texture one-variable table is not evidence for these pass costs.
The original implementation was measured over `954fb42`; the retained change
also includes `dev`'s history worker (`db418f4`, live brushes 28).

`bun run bench/run.ts --wet-dab --layer-target` drives sixteen 512 px dabs
with flow 0.3 and pickup 0.8 on an 8192² layer. Before each submission it
restores the same painted ground and clean load, then waits for the queue.
Restoration, clears and first-use work are outside the interval. Controls and
ablations are interleaved for eighty rounds, discarding the first twenty.
Timing is CPU encoding through the completion fence, divided by sixteen.
An omitted pass is encoded into an unsubmitted encoder, removing its whole
GPU attachment load/store while retaining its CPU encoding.

The initial, close-packed control and ablations were:

| submitted work omitted | median / p95 per dab |
|---|---:|
| Nothing | 0.625 / 0.713 ms |
| Neighbourhood copy | 0.575 / 0.662 ms |
| Layer deposition pass | 0.288 / 0.344 ms |
| Reservoir pickup pass | 0.594 / 0.663 ms |

The marginal savings were 0.337 ms for deposition, 0.050 ms for the copy and
0.031 ms for pickup. Deposition was the largest component. These are not an
additive GPU-pass decomposition: the fence includes encoding and cancel-tile
copies, and omissions change later inputs. GPU timestamps were tried, but
summed intervals exceeded the complete submission fence on this adapter;
those measurements were rejected. Production painting gains no readback.

`--scatter-dabs` uses the workload's seeded sixteen thrown centres instead of
the close-packed grid. Repeated full-layer scattered controls ranged from
0.419 to 0.650 ms median per dab as the host's GPU clock changed. Cross-run
ratios should therefore not be treated as precise speedups.

The implementation moves deposition into bounded carry levels. A procedural
round dab without paper and with a matching power-of-two reservoir diameter
uses separate deposition and pickup compute kernels within one pass. They read
the same incoming layer and load; their writes land in scratch and the next
reservoir. Power-of-two documents allow direct layer sampling without a
neighbourhood copy. Scratch levels add 10.65625 MiB. Shaped or textured tips,
paper, sampled artwork and differently sized loads retain the render path.
No dabs are held across frames.

The final scattered diagnostic, `--wet-dab --scatter-dabs`, recorded:

| submitted work omitted | median / p95 per dab |
|---|---:|
| Nothing | 0.175 / 0.181 ms |
| Neighbourhood copy (absent on this path) | 0.175 / 0.175 ms |
| Combined wet compute pass | 0.075 / 0.081 ms |
| Cancel-tile backup copies | 0.138 / 0.150 ms |

The warm diagnostic identifies the work; the unchanged `--wet` workload
judges opening and sustained latency. Early wide scratch runs reached
0.169 ms in the close-packed probe but still left scattered p95 at 21.3 ms;
read/load atlases, reservoir mips, independent-dab pickup batches and optional
read-write full-layer storage also failed to
meet the paced target and were removed. Their best isolated values are not
reported as the final result.

Procedural round pickup now derives its coordinates from reservoir texel
centres in both render and compute, rather than raster-varying interpolation.
The full-layer equivalence control uses that same mapping. A separate legacy
control retains the previous interpolation and bounds the numerical change:
radii 32, 33, 129 and 513, with retained loads and cancellation, differed by
at most 0, 1/8192, 1/4096 and 1/4096 per stored linear channel respectively
on the test adapter. All 28 path comparisons and the three-way direct-read,
copied-read and full-layer comparison matched stored half-float bits exactly.

The acceptance run is `bun run bench/run.ts --wet --dab --large`: the same
512 px pickup, densest and scatter workloads at 8192², with both paced and
unpaced passes, selected from the complete wet sweep without changing samples,
spacing, scattering, pressure, stroke count or sample-to-fence attribution.

Batched deposition and eager initialization of four cancel pages did not
close the gap and were removed, including their extra 48.189 MiB of batch
arrays and 128 MiB of eager backup pages. Cancel pages continue to grow and be
retained as before.

Final paced and unpaced run of the split-kernel candidate (`ef296de`),
`bun run bench/run.ts --wet --dab --large`, on an otherwise idle local host:

| 8192², 512 px | unpaced ms/frame / sustained fps | opening median / worst | all frames median / p95 | dabs | painting readbacks / allocations |
|---|---:|---:|---:|---:|---:|
| Wet, pickup | 0.863 / 454.5 | 3.3 / 19.0 ms | 13.2 / 15.2 ms | 348 | 0 / 2 |
| Wet, densest | 0.905 / 454.5 | 3.3 / 17.2 ms | 13.7 / 15.9 ms | 1376 | 0 / 2 |
| Wet, scatter | 1.046 / 270.3 | 7.7 / 23.4 ms | 14.2 / 18.3 ms | 1424 | 0 / 6 |

Scatter is cheaper than the ticket's recorded baseline, but its opening and
p95 remain above these controls: the dab is some three times cheaper and a
step is still sixteen of them. The six allocations are within the existing
cancel-page growth and history behavior; no scratch, reservoir or compute
resource is allocated per dab.

### A step's dabs are laid along the path

Same machine and day, over `3cb4345`. What follows is why the dab was not
made cheaper again, and what was done instead.

**Where the rest of a dab is.** The probe's scratch path was given each part
to omit in turn (`--wet-dab --scatter-dabs`; "all" submits none of a dab's
work, leaving the encoding and the fence). With eight modes interleaved the
GPU idles more between submissions than it did for the four above and every
figure is higher for it, the control included, so read the table within
itself. Two runs:

| submitted work omitted | median per dab |
|---|---:|
| Nothing | 0.34 to 0.39 ms |
| Deposition dispatch | 0.24 to 0.30 ms |
| Pickup dispatch | 0.26 to 0.28 ms |
| Cancel-tile backup copies | 0.26 to 0.29 ms |
| Copy back into the layer | 0.29 ms |
| Both dispatches | 0.14 to 0.15 ms |
| All of it | 0.05 ms |

The same in the paced `--wet` row itself, with a scratch switch in the direct
stroke (not shipped), the 512 px "wet, scatter" row at 8192²:

| omitted from every dab | opening, median | frames that drew sixteen dabs, median / p95 | all frames, median / p95 |
|---|---:|---:|---:|
| Nothing | 7.7 ms | 17.1 / 20.4 ms | 14.1 / 18.6 ms |
| Cancel-tile backup copies | 6.3 ms | 16.7 / 19.9 ms | 14.1 / 18.4 ms |
| Deposition and the copy back | 4.0 ms | 13.7 / 17.7 ms | 13.5 / 16.2 ms |
| Pickup | 4.8 ms | 15.2 / 18.6 ms | 13.5 / 16.7 ms |
| All of it | 2.7 ms | 12.8 / 16.3 ms | 12.9 / 15.3 ms |

No part is most of it. A 512 px dab reads its 514² of the layer and its load
and writes scratch, reads both again and writes the next load, copies scratch
back, and the first time it reaches them copies nine tiles out: 6.3, 6.3, 4.2
and 9.4 MB, some 26 MB a dab and 420 MB for a step, in the 4.3 to 5.0 ms the
last row says a step costs. That is 80 to 100 GB/s on a machine whose memory
moves 120 GB/s at the most. A dab that read each texture once and wrote the
layer where it stands would still move 8 MB before its tiles were kept, and
that is not on offer: a pass cannot read what it writes. Sixteen such dabs do not fit beside a frame
however they are arranged, which is what the batches, atlases and read-write
storage above each found.

**Starting the step's work as its sample arrives** was tried and not kept: a
wet stroke's dabs drawn from the input handler, ahead of the frame that
presents them, and timed from their sample as before. The sixteen-dab frames
went from 17.0 / 20.3 ms to 14.0 / 18.9 ms and the row's p95 from 18.8 to
17.7 ms; the opening frame, which follows its sample at once, stayed at
7.6 ms. It is also the stroke pipeline drawing outside the frame.

**So a step is not sixteen dabs in one frame.** A scattering wet brush now
lays its dabs one at a time, one every `count`th of its spacing step and
never closer than the wet floor, each thrown from where the pen has got to;
the throws are the ones the step would have made, in the same order (see the
architecture document). Over a length of path it is the dabs the floor times
the count allowed, 1,376 where the row laid 1,424. No dab is held: each is
placed by the sample that reaches it and drawn in that sample's frame, so
pen-to-pixel means what it did. This changes what a scattering wet brush
paints: no clumps of `count` thrown from one point.

`bun run bench/run.ts --wet --dab --large`, two runs:

| 8192², 512 px | unpaced ms/frame / sustained fps | opening median / worst | all frames median / p95 | dabs | painting readbacks / allocations |
|---|---:|---:|---:|---:|---:|
| Wet, pickup | 0.863 / 454.5 | 3.2 / 17.9 ms | 13.1 / 15.4 ms | 348 | 0 / 2 |
| Wet, densest | 0.910 / 434.8 | 3.0 / 18.6 ms | 13.7 / 16.1 ms | 1,376 | 0 / 2 |
| Wet, scatter | 1.060 / 312.5 | 4.2 / 20.8 ms | 14.0 / 17.2 ms | 1,376 | 0 / 6 |
| Wet, pickup | 0.865 / 434.8 | 3.0 / 18.6 ms | 13.1 / 15.5 ms | 348 | 0 / 2 |
| Wet, densest | 0.908 / 454.5 | 3.0 / 18.7 ms | 13.7 / 16.3 ms | 1,377 | 0 / 2 |
| Wet, scatter | 1.068 / 303.0 | 4.2 / 20.5 ms | 14.2 / 17.1 ms | 1,377 | 0 / 6 |

The row opens in 4.2 ms, from 7.7 ms and from the ticket's 11.3 ms, and holds
a p95 of 17.1 to 17.2 ms, from 18.3 to 18.8 ms and from 22.5 ms. The ticket
recorded 2.3 to 4.9 ms to open and a p95 of 15.8 to 17.7 ms for the other
512 px rows: the opening is inside that, and the p95 is inside it in these
runs and at its edge over the day, 17.0 to 17.9 ms. Against the same run's
unscattered rows it is still about a millisecond over on each; over the day
their p95 ranged from 15.2 to 16.9 ms (pickup) and 15.9 to 17.2 ms (densest).
What is left of the p95 was not run down.

**What is left is not the step.** Each opening frame draws one dab in all
three rows. With the row's brush throwing one dab a step instead of sixteen
(count 1, four radii, a scratch run) it opens in 3.2 ms and holds 16.7 ms,
and with sixteen thrown a quarter of a radius it opens in 3.1 ms and holds
16.6 ms: a thrown dab costs what a dab on the path does. What differs is the
stroke before. History takes 1.4 to 3.0 s to put one of this row's strokes
away, which reach some hundreds of tiles, and 0.2 to 1.0 s for the others,
and the benchmark waits for it. Not waiting does not help (`--wet --unwaited`: 4.4 ms
waited, 4.0 ms not; history is then at work under the stroke instead). With
every row waiting two seconds more before each pen-down the three open
alike, and late: 8.3, 8.2 and 9.3 ms. `dev` does the same (8.3 and 9.1 ms
for the first two, at `db418f4`), so it is not this change's path. That
pause is live brushes 31's, and the tiles history reads back for a thrown
stroke are live brushes 30's.

The whole sweep, `bun run bench/run.ts --wet`, one run:

| document | brush | paint | ms/frame, unpaced | sustained fps | stroke's first frame, median / worst | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry | 0.311 | 1428.6 | 1.7 / 8.1 ms | 11.9 / 14.5 ms | 615 | 0 | 0 |
| 2048² | 64 px | Wet | 0.314 | 1428.6 | 2.6 / 18.9 ms | 12.1 / 14.9 ms | 615 | 0 | 1 |
| 2048² | 64 px | Wet, pickup | 0.314 | 1250.0 | 2.5 / 13.6 ms | 12.2 / 14.8 ms | 615 | 0 | 1 |
| 2048² | 64 px | Wet, all layers | 0.324 | 1250.0 | 2.9 / 11.4 ms | 13.0 / 15.8 ms | 619 | 0 | 1 |
| 2048² | 64 px | Wet, densest | 0.313 | 1250.0 | 2.5 / 14.9 ms | 12.3 / 15.1 ms | 1,226 | 0 | 1 |
| 2048² | 64 px | Dry, scatter | 0.311 | 1428.6 | 1.8 / 8.7 ms | 11.8 / 14.0 ms | 9,840 | 0 | 0 |
| 2048² | 64 px | Wet, scatter | 0.322 | 1250.0 | 2.6 / 13.9 ms | 12.8 / 16.1 ms | 1,226 | 0 | 1 |
| 2048² | 512 px | Dry | 0.343 | 1111.1 | 1.6 / 6.2 ms | 12.2 / 14.4 ms | 80 | 0 | 0 |
| 2048² | 512 px | Wet | 0.316 | 1000.0 | 2.5 / 11.1 ms | 12.2 / 14.4 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, pickup | 0.355 | 1000.0 | 2.7 / 8.2 ms | 12.1 / 14.5 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, all layers | 0.326 | 1000.0 | 3.5 / 15.8 ms | 12.2 / 15.5 ms | 80 | 0 | 1 |
| 2048² | 512 px | Wet, densest | 0.362 | 1250.0 | 2.7 / 8.3 ms | 12.4 / 14.8 ms | 311 | 0 | 1 |
| 2048² | 512 px | Dry, scatter | 0.342 | 1111.1 | 1.5 / 6.7 ms | 12.5 / 14.8 ms | 1,280 | 0 | 0 |
| 2048² | 512 px | Wet, scatter | 0.337 | 1111.1 | 2.3 / 9.8 ms | 12.6 / 15.5 ms | 310 | 0 | 1 |
| 8192² | 64 px | Dry | 0.860 | 500.0 | 2.4 / 14.8 ms | 12.8 / 15.3 ms | 2,749 | 0 | 0 |
| 8192² | 64 px | Wet | 0.857 | 500.0 | 3.3 / 22.8 ms | 13.6 / 16.1 ms | 2,755 | 0 | 1 |
| 8192² | 64 px | Wet, pickup | 0.852 | 454.5 | 3.1 / 17.4 ms | 13.2 / 15.6 ms | 2,749 | 0 | 1 |
| 8192² | 64 px | Wet, all layers | 0.892 | 454.5 | 4.9 / 18.3 ms | 14.0 / 17.4 ms | 2,749 | 0 | 8 |
| 8192² | 64 px | Wet, densest | 0.854 | 476.2 | 3.0 / 17.7 ms | 13.5 / 16.4 ms | 5,507 | 0 | 1 |
| 8192² | 64 px | Dry, scatter | 0.856 | 500.0 | 2.3 / 14.8 ms | 12.8 / 15.7 ms | 43,984 | 0 | 0 |
| 8192² | 64 px | Wet, scatter | 0.887 | 454.5 | 3.1 / 22.6 ms | 13.5 / 16.6 ms | 5,494 | 0 | 2 |
| 8192² | 512 px | Dry | 0.839 | 476.2 | 2.3 / 13.5 ms | 13.1 / 15.6 ms | 348 | 0 | 0 |
| 8192² | 512 px | Wet | 0.853 | 476.2 | 3.1 / 18.5 ms | 13.1 / 16.0 ms | 348 | 0 | 2 |
| 8192² | 512 px | Wet, pickup | 0.863 | 454.5 | 4.6 / 17.4 ms | 12.9 / 15.9 ms | 348 | 0 | 2 |
| 8192² | 512 px | Wet, all layers | 0.875 | 454.5 | 4.8 / 17.8 ms | 13.5 / 16.8 ms | 348 | 0 | 16 |
| 8192² | 512 px | Wet, densest | 0.905 | 434.8 | 3.0 / 22.7 ms | 13.6 / 17.0 ms | 1,377 | 0 | 2 |
| 8192² | 512 px | Dry, scatter | 0.843 | 476.2 | 2.7 / 14.7 ms | 13.2 / 16.4 ms | 5,568 | 0 | 0 |
| 8192² | 512 px | Wet, scatter | 1.064 | 312.5 | 4.2 / 22.7 ms | 14.1 / 17.9 ms | 1,377 | 0 | 6 |

The "wet, scatter" rows lay the dabs of their "wet, densest" rows, thrown,
and are within a millisecond of them on both figures everywhere but the
512 px row at 8192², which opens 1.2 ms later and held 17.9 ms in this run
against 17.0 ms.

## A sampling stroke after a pause opened a frame late: cold layers (live brushes 31)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-12, on top of `a471e03`.
`bun run bench/run.ts --wet --pause 2000` waits two seconds more before each
pen-down of the 512 px rows at 8192², paced. Before this change, the
pen-to-pixel of the frame each stroke opens in, median / worst, one run:

| paint | no pause | 2000 ms pause |
|---|---:|---:|
| dry | 2.5 / 15.6 ms | 6.2 / 6.5 ms |
| wet | 3.4 / 18.1 ms | 8.7 / 23.8 ms |
| wet, pickup | 3.2 / 18.9 ms | 7.6 / 20.1 ms |
| wet, all layers | 5.2 / 18.2 ms | 24.2 / 28.4 ms |
| wet, densest | 3.1 / 19.4 ms | 7.6 / 17.6 ms |
| dry, scatter | 2.5 / 16.1 ms | 6.6 / 6.7 ms |
| wet, scatter | 4.0 / 19.6 ms | 8.9 / 18.1 ms |

Every row opens 4 to 5 ms later after the pause and stays under one 75 Hz
frame. That is measured and left: it is no path's own, and may be the GPU's
clock falling when it idles. "Wet, all layers" alone missed a frame, on
every stroke.

**It was the other layers, left alone.** The row paints on an empty layer
over a painted one with sampling on. A sampling stroke freezes the picture
under its first dab as it opens: a chunk of 1024² copied out of the one
other layer, or with more to show flattened from all of them, into a page.
The warming of live brushes 24 keeps the layer painted and nothing the
picture is read from. The row alone, two seconds' pause, with more given the
same empty pass every 800 ms (a scratch build; the last line is what
shipped), median / worst of six strokes, one run each:

| also kept warm | opening frame |
|---|---:|
| nothing more | 25.7 / 29.2 ms |
| the other visible layers | 13.2 / 19.9 ms |
| those and the target a chunk is flattened in | 11.2 / 18.5 ms |
| those and the frozen pages a stroke takes first | 10.0 / 18.3 ms |
| those and the dab's carry | 12.8 / 17.6 ms |
| all four | 10.2 / 17.6 ms, 10.8 / 16.8 ms |
| layers, pages and flatten target | 11.2 / 23.2 ms |

Twelve of the 24 ms were the layer the picture is read from: a texture left
two seconds is as slow to be sampled or copied out of as to be drawn into.
The pages, which are only copied into and out of, were some 3 ms and the
flatten target 1 to 2 ms, each near the spread of a run, which is about a
millisecond. The carry was nothing, as live brushes 24 found. So with a wet
brush or smudge in hand and sampling on, `keepWarm` gives its pass to every
visible layer but the one painted, to the four pages the next stroke takes
first and to the flatten target; the pages carry the render-attachment usage
for that and nothing else. A brush that does not sample is given none of it.

After, the whole of `--wet --pause 2000`, one run:

| paint | no pause | 2000 ms pause |
|---|---:|---:|
| dry | 2.3 / 15.9 ms | 6.4 / 7.0 ms |
| wet | 3.4 / 17.6 ms | 8.3 / 15.5 ms |
| wet, pickup | 3.3 / 19.2 ms | 7.8 / 19.5 ms |
| wet, all layers | 4.7 / 19.5 ms | 11.2 / 23.2 ms |
| wet, densest | 3.2 / 18.2 ms | 7.8 / 19.0 ms |
| dry, scatter | 2.6 / 16.5 ms | 6.3 / 6.8 ms |
| wet, scatter | 4.3 / 19.7 ms | 9.3 / 15.6 ms |

The row opens in 10.1 to 12.4 ms for five of its six strokes, from 17.0 to
28.4 ms: inside a 75 Hz frame, and not under the 10 ms the ticket asked for.
The sixth is the one late frame every row has with or without the pause.
The other rows are where they were.

**What is left is the pause every brush pays, on a frame that does more.**
The pause does not add the same to each row; it multiplies. In the run
above the opening frame after two seconds is 2.8 times the unpaused one for
dry, 2.4 for wet, wet with pickup, wet densest and dry scatter, 2.2 for wet
scatter, and 2.4 for wet, all layers. That row's unpaused opening frame is
the longest, 4.7 ms against 3.2 to 3.4 ms, because it freezes up to four
chunks before its first dab, each a flatten and a copy submitted on its
own, and so it is the longest after the pause. Under 10 ms after a pause
would take an unpaused opening frame of about 4 ms, which is the freezing's
cost and not the pause's, or the every-brush factor gone, which is not
chased. Neither was tried here.

That reading is from the ratios of one run of six strokes and is not a
measurement of the frame: its submissions were not fenced one by one. Read
as a sum instead, the row pays 6.5 ms for the pause where the others pay
3.7 to 5.0 ms, and 2 ms of it are then unaccounted for; a cache the chunk
compositor keeps, or something else not found, may still be cold. The masks
over the layers read are given the pass too, as the same kind of texture,
unmeasured: the benchmark has none. Nor was the warming's own cost measured
beyond one other layer, where the sweep below holds; it is one empty pass
per visible layer every 800 ms, and a stack of many 8192² layers was not
run.

`bun run bench/run.ts --wet`, the 512 px rows at 8192² after, one run,
against the table of live brushes 30 above:

| paint | stroke's first frame, median / worst | all frames, median / p95 |
|---|---:|---:|
| Dry | 2.3 / 15.0 ms | 13.0 / 15.2 ms |
| Wet | 3.1 / 21.6 ms | 13.1 / 15.5 ms |
| Wet, pickup | 3.1 / 19.2 ms | 13.2 / 15.5 ms |
| Wet, all layers | 4.7 / 18.4 ms | 13.3 / 16.2 ms |
| Wet, densest | 3.1 / 18.9 ms | 13.5 / 16.2 ms |
| Dry, scatter | 2.7 / 14.7 ms | 13.3 / 15.8 ms |
| Wet, scatter | 4.1 / 23.2 ms | 14.3 / 17.3 ms |

Medians and p95 are within 0.3 ms and 0.9 ms of that table's, most of them
lower.


## An undo pressed while a stroke is being put away (live brushes 32)

Apple M4 (integrated, 16 GiB), 75 Hz display, Chrome/WebGPU, 2560 × 1440
window, six strokes, 2026-10-12, on top of `05ba079`. Live brushes 30 left
the two seconds a thrown 512 px wet stroke takes to be put away, as
compression off the main thread, and said that what it could cost was an
undo pressed inside them, unmeasured. `bun run bench/run.ts --wet --undo`
measures it: the scattering rows, paced, with undo pressed after each
stroke and timed to the step having been taken back, its tiles handed to
the GPU, then redone so the stroke after paints over the same ground. It
is pressed as the stroke reaches history (two frames after pen-up), a
second later, and once `engine.save()` has resolved, which is what the
undo itself takes. Median / worst of the six, one run:

| document | brush | paint | as the stroke reaches history | a second later | history settled |
|---|---|---|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 3 / 9 ms | 7 / 8 ms | 2 / 3 ms |
| 2048² | 64 px | Wet, scatter | 3 / 12 ms | 6 / 10 ms | 2 / 3 ms |
| 2048² | 512 px | Dry, scatter | 117 / 126 ms | 26 / 31 ms | 15 / 17 ms |
| 2048² | 512 px | Wet, scatter | 452 / 572 ms | 33 / 58 ms | 14 / 31 ms |
| 8192² | 64 px | Dry, scatter | 90 / 161 ms | 33 / 50 ms | 13 / 24 ms |
| 8192² | 64 px | Wet, scatter | 152 / 166 ms | 36 / 48 ms | 14 / 22 ms |
| 8192² | 512 px | Dry, scatter | 577 / 639 ms | 131 / 134 ms | 97 / 104 ms |
| 8192² | 512 px | Wet, scatter | 2114 / 2653 ms | 1109 / 1622 ms | 206 / 407 ms |

The first column is the table of live brushes 30's "pen-up to history
settled" again, row for row: an undo waited for all of it. Undo and redo
called `settle()`, which waits for recording, the readback and the hashing
that make the step, and then for the store to have compressed and spilled
what that left it with. The first an undo cannot do without: popping a
step still being recorded leaves its pixels on the layer. The second it
has no use for. A tile is whole from the moment it is stored, the store
answers a read of one it is deflating with the raw texels it still holds,
and the tiles an undo asks for it asks for raw.

**So undo and redo wait for recording and no more.** Everything else that
calls `settle()` (a save, an export, the steps that read history's index)
waits as it did. After, one run:

| document | brush | paint | as the stroke reaches history | a second later | history settled |
|---|---|---|---:|---:|---:|
| 2048² | 64 px | Dry, scatter | 2 / 6 ms | 7 / 9 ms | 2 / 3 ms |
| 2048² | 64 px | Wet, scatter | 2 / 9 ms | 6 / 10 ms | 2 / 3 ms |
| 2048² | 512 px | Dry, scatter | 48 / 49 ms | 29 / 31 ms | 12 / 16 ms |
| 2048² | 512 px | Wet, scatter | 44 / 57 ms | 33 / 58 ms | 13 / 30 ms |
| 8192² | 64 px | Dry, scatter | 38 / 67 ms | 36 / 51 ms | 14 / 23 ms |
| 8192² | 64 px | Wet, scatter | 38 / 64 ms | 35 / 47 ms | 14 / 21 ms |
| 8192² | 512 px | Dry, scatter | 293 / 387 ms | 128 / 131 ms | 101 / 102 ms |
| 8192² | 512 px | Wet, scatter | 344 / 591 ms | 189 / 402 ms | 202 / 403 ms |

An undo pressed straight after a thrown 512 px wet stroke at 8192² takes
344 ms where it took 2114 ms, and a second later takes what it takes with
history settled. What is left in the first column over the last is the
readback and the hashing of the stroke, which the undo has to have.

**Not done, and left.** The stroke is still two seconds being compressed
(2010 / 2274 ms from pen-up, live brushes 30): nothing waits on that now
but a save, so it was not shortened, and a second worker, a faster codec
and streams side by side were not tried. The undo itself is 200 ms for
that row, 339 tiles read from the store and written to the layer, a good
part of them inflated since the stroke pushed the tiles it replaced out of
the 64 MiB kept raw; how it divides between the inflating and the writing
was not measured. The "a second later" column is above the settled one in
the small rows by a few milliseconds in both tables, and was not looked
into. Frames were not re-measured: nothing a stroke does was changed.

That an undo does not wait for compression, and that a stroke landing
while it waits for recording is still the step it takes back, are held by
`tests/unit/history.test.ts`.

## Fluid dabs: one batch and one pour a frame (fluid brushes 10)

A fluid dab is the brush's whole dab now: turned, squashed, shaped by its
tip, thrown by scatter and tinted by colour jitter, with the graph driving
the pigment and the water it carries. A frame's dabs are still one batch,
instanced into the two targets a batch lays into, and one pour of that into
the wet fields, so what a dab adds to a frame is an instance for each wet
tile it reaches. `--fluid` paints the workload with a fluid brush against
the same brush dry: at an eighth of its diameter between dabs, at the
closest a brush can ask for (a hundredth, which is twelve times the dabs
into the same wash), with a tip of four frames, and with the densest scatter
(count 16). The simulation runs under every fluid row, on its own clock.

Apple GPU (Metal 3), Chrome/WebGPU, 2560 × 1440 window, six strokes,
2026-10-13, on top of `2719388`, the second of two runs that agree:

| document | brush | paint | ms/frame, unpaced | sustained fps | dabs/frame, paced | all frames, median / p95 | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| 2048² | 64 px | Dry | 0.319 | 1250.0 | 6.0 | 12.0 / 14.1 ms | 622 | 0 | 0 |
| 2048² | 64 px | Fluid | 0.414 | 625.0 | 5.9 | 13.1 / 15.7 ms | 620 | 0 | 0 |
| 2048² | 64 px | Fluid, densest | 0.414 | 625.0 | 74.3 | 13.0 / 16.3 ms | 7,727 | 0 | 0 |
| 2048² | 64 px | Fluid, tip | 0.413 | 625.0 | 6.0 | 13.0 / 15.7 ms | 620 | 0 | 0 |
| 2048² | 64 px | Dry, scatter | 0.320 | 1428.6 | 94.5 | 12.1 / 14.6 ms | 9,920 | 0 | 0 |
| 2048² | 64 px | Fluid, scatter | 0.418 | 769.2 | 94.5 | 13.4 / 16.0 ms | 9,920 | 0 | 0 |
| 2048² | 512 px | Dry | 0.316 | 1111.1 | 0.8 | 12.2 / 14.8 ms | 81 | 0 | 0 |
| 2048² | 512 px | Fluid | 0.421 | 526.3 | 0.8 | 13.4 / 15.7 ms | 81 | 0 | 0 |
| 2048² | 512 px | Fluid, densest | 0.428 | 526.3 | 9.3 | 13.7 / 17.2 ms | 963 | 0 | 0 |
| 2048² | 512 px | Fluid, tip | 0.420 | 526.3 | 0.8 | 13.5 / 16.3 ms | 81 | 0 | 0 |
| 2048² | 512 px | Dry, scatter | 0.316 | 1000.0 | 12.2 | 12.6 / 14.7 ms | 1,280 | 0 | 0 |
| 2048² | 512 px | Fluid, scatter | 0.446 | 454.5 | 12.2 | 16.2 / 19.2 ms | 1,296 | 0 | 0 |
| 8192² | 64 px | Dry | 0.875 | 500.0 | 6.3 | 13.2 / 15.4 ms | 2,744 | 0 | 0 |
| 8192² | 64 px | Fluid | 1.105 | 312.5 | 6.3 | 14.4 / 16.6 ms | 2,744 | 0 | 0 |
| 8192² | 64 px | Fluid, densest | 1.100 | 312.5 | 78.2 | 14.3 / 16.9 ms | 34,330 | 0 | 0 |
| 8192² | 64 px | Fluid, tip | 1.099 | 322.6 | 6.3 | 14.3 / 16.5 ms | 2,744 | 0 | 0 |
| 8192² | 64 px | Dry, scatter | 0.873 | 476.2 | 100.3 | 13.1 / 15.2 ms | 44,016 | 0 | 0 |
| 8192² | 64 px | Fluid, scatter | 1.118 | 312.5 | 100.7 | 14.9 / 17.7 ms | 43,904 | 130 | 1 |
| 8192² | 512 px | Dry | 0.853 | 476.2 | 0.8 | 13.3 / 15.3 ms | 347 | 0 | 0 |
| 8192² | 512 px | Fluid | 1.115 | 294.1 | 0.8 | 15.1 / 18.3 ms | 347 | 390 | 3 |
| 8192² | 512 px | Fluid, densest | 1.149 | 303.0 | 9.8 | 15.2 / 18.3 ms | 4,286 | 390 | 3 |
| 8192² | 512 px | Fluid, tip | 1.123 | 294.1 | 0.8 | 14.8 / 18.2 ms | 347 | 780 | 6 |
| 8192² | 512 px | Dry, scatter | 0.858 | 476.2 | 12.7 | 13.4 / 15.6 ms | 5,552 | 0 | 0 |
| 8192² | 512 px | Fluid, scatter | 1.530 | 256.4 | 18.8 | 88.7 / 245.1 ms | 5,264 | 3,698 | 189 |

**The dab is not the cost.** Twelve times the dabs into the same wash moves
the frame by nothing that can be read at either size of brush or document
(1.105 against 1.100 ms at 8192² and 64 px, 0.421 against 0.428 ms at
2048² and 512 px), and neither does the tip, nor sixteen dabs a step at
64 px. A hundred dabs in a frame are one draw. What a fluid frame costs over a dry one, a tenth to a quarter of a
millisecond unpaced and one to two milliseconds of pen-to-pixel paced, is
there at six dabs a frame as at a hundred: it is the pour and the simulation
stepping under the pen, not the deposit. The wet spacing floor is not put to
a fluid brush, and nothing here asks for it.

**Left for fluid brushes 13.** The rows with readbacks and allocations are
the ones whose wash outgrows the wet tile limit under the pen: a body
settles to make room, history reads back what it wrote, and the stroke's
pen-down copy is taken again. That is not the deposit, and it was not looked
into here. A 512 px brush at 8192² does it with the pen down in every row,
twice as often with a tip, whose turned corners reach tiles the disc's rim
does not; thrown sixteen a step it misses the bar outright (88.7 / 245.1 ms).
The cause is read from what the code does at the limit, not measured.

## Fluid brushes hold D30: the step, its budget and the wet tile limit (fluid brushes 13)

The simulation now has a budget. Its clock still aims at 120 steps a
second, one a frame at 120 Hz and two at 60, but a frame runs only the
steps it can pay for out of 2 ms of GPU time, and the rest are skipped and
not made up: paint moves and dries more slowly in wall time and ends in the
same pixels, since the step is fixed and a body's deadline is a count of
steps. A step dearer than a whole frame's budget still runs, every few
frames, so paint always dries. The clock and its arithmetic are
`engine/gpu/fluid-clock.ts`, tested on their own.

What a step costs is measured as it runs: a fence before the frame's steps
and one after, no readback. A fence resolves a fixed time after the work it
waits on, about 2.6 ms here, so one step over sixteen tiles fenced alone
reads 3.2 ms and two read 3.8 ms, where the steps cost 0.39 ms each. The
clock reckons with the slope across measurements of different sizes (one
step or two, few tiles or many), a least-squares line with older
measurements counting less, and holds to the benchmark's 24 µs a tile-step
until measurements differ in size. Taken as a ratio, the same fences
reckoned a 64-tile step at 3.3 ms and ran 0.66 steps a frame for one that
costs 1.5.

The steps also run after the frame is presented, from a task the frame
posts, not inside it. Submitted in the frame they sat on the GPU's queue
ahead of the stroke's own work, and the pen's pixel waited for them: over
64 wet tiles that was 16.3 ms median pen-to-pixel, and is 14.8 now. The
simulation gives way; the pen does not.

`--fluid-load` measures both halves. First a step, run by command over a
document flooded worst case: every cell wet, with water, bleed, rim and
granulation at one, laid by 8 px dabs each a hue of its own, so pigment
crossing between dabs is mixed by Kubelka–Munk rather than added. A flood
of 2 px dabs, a cell's every neighbour another colour, steps at the same
cost (0.37 against 0.39 ms at sixteen tiles): what a step costs is the
water standing in its cells, not their colours. A document a whole number
of tiles a side holds no dry ring, so every slot held is a tile of wet
cells. Then the workload painted with a fluid brush over that flood,
against the same brush on a dry document and the brush dry. The strokes do
not wait on history between them, since a save dries the flood. The
flooded documents are 1024² and 2048², sixteen tiles and sixty-four: at
8192² the workload's strokes reach tiles past the flood and settle it to
make room. A step costs by its tiles and not by the document, and the
8192² fluid rows are those of fluid brushes 10.

Apple GPU (Metal 3), Chrome/WebGPU, 75 Hz display, 2560 × 1440 window, six
strokes, 2026-10-15, on top of `0acba2f`, the second of two runs that
agree:

| document | wet tiles | ms a step (median of 7 × 120) | µs a tile-step | tiles in 2 ms | field memory |
|---|---:|---:|---:|---:|---:|
| 1024² | 16 | 0.391 | 24.4 | 82 | 12 MB |
| 2048² | 64 | 1.500 | 23.4 | 85 | 48 MB |

| document | brush | paint | ms/frame, unpaced | sustained fps | all frames, median / p95 | steps/frame, paced | skipped | reckoned ms a step | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1024² | 64 px | Dry | 0.441 | 1428.6 | 11.8 / 14.2 ms | – | – | – | 366 | 0 | 0 |
| 1024² | 64 px | Fluid | 0.885 | 666.7 | 13.5 / 16.1 ms | 1.46 | 0 | 0.157 | 362 | 0 | 5 |
| 1024² | 64 px | Fluid, 16 wet | 1.004 | 555.6 | 14.2 / 18.4 ms | 1.49 | 0 | 0.486 | 356 | 0 | 6 |
| 1024² | 512 px | Dry | 0.445 | 1250.0 | 11.7 / 14.3 ms | – | – | – | 47 | 0 | 0 |
| 1024² | 512 px | Fluid | 0.963 | 555.6 | 14.1 / 16.9 ms | 1.46 | 0 | 0.303 | 47 | 0 | 5 |
| 1024² | 512 px | Fluid, 16 wet | 0.994 | 500.0 | 14.6 / 17.8 ms | 1.52 | 0 | 0.488 | 46 | 0 | 6 |
| 2048² | 64 px | Dry | 0.482 | 1250.0 | 12.1 / 14.1 ms | – | – | – | 620 | 0 | 0 |
| 2048² | 64 px | Fluid | 0.936 | 526.3 | 13.9 / 16.2 ms | 1.51 | 0 | 0.154 | 622 | 0 | 5 |
| 2048² | 64 px | Fluid, 64 wet | 1.018 | 400.0 | 14.8 / 17.5 ms | 0.99 | 59 | 1.744 | 614 | 0 | 6 |
| 2048² | 512 px | Dry | 0.483 | 1111.1 | 12.0 / 14.1 ms | – | – | – | 80 | 0 | 0 |
| 2048² | 512 px | Fluid | 0.944 | 500.0 | 14.3 / 17.6 ms | 1.32 | 16 | 0.739 | 81 | 0 | 5 |
| 2048² | 512 px | Fluid, 64 wet | 1.340 | 416.7 | 14.8 / 18.2 ms | 0.98 | 58 | 1.795 | 80 | 0 | 6 |

**The step is linear in tiles,** 23 to 24 µs a tile-step at worst, which
is the prototype's 26 on the same kind of GPU. Sixty-four tiles are 1.5 ms
run back to back; in the engine, among the frame's other work, the clock
reckons a step over them at 1.7 to 1.8 ms. That fits the budget once a
frame and not twice, so at 75 Hz a frame runs one step and skips what
owed a second: about 74 steps a second against 120, paint moving at three
fifths of its speed while every tile is wet worst case. Under a dry
document's stroke the steps are over a handful of tiles and the clock runs
the steps owed, 1.5 a frame at 75 Hz; the 2048² 512 px row's wash grows
large enough late in a stroke for the second step to be skipped now and
then. On a 60 Hz display the clock runs two steps a frame wherever two fit
the budget (unit-tested; this machine's panel is 75 Hz).

**A stroke drawn while 64 tiles are wet meets D30's frame rate**, 400 fps
unpaced against 120, and history reads nothing back. Pen-to-pixel cannot
be judged at 75 Hz, where it is a panel period plus the frame's GPU work
(brush-library 17); a fluid stroke adds 1.7 to 2.4 ms to it over the same
brush dry and 2.7 to 2.8 ms over 64 wet tiles. The steps are no longer in
that: it is the stroke's own pour and the wet surface in the present pass,
as fluid brushes 10 found. At 120 Hz that would put the 64-wet rows near
11.5 ms, over the bar; there is no 120 Hz display to measure it on.

**The wet tile limit stays at 64.** Its worst-case step is 1.5 ms, inside
the budget with room for a pour, and 48 MB of fields. 85 tiles would fit
2 ms run alone, but not in the engine, where 64 already reckons at 1.75 ms;
and the clock now gives way where the step is dearer, so a slower GPU
slows the paint and not the pen. Weighed with the ring (fluid brushes 08):
a dab allocates its tile's eight neighbours, so a flooded stroke along a
row takes three slots for each tile it reaches, and 64 slots hold a wash
about twenty tiles long, 5,000 px, before the first body is settled to
make room. A ring tile with no slot free is a wall to a bloom. Raising the
limit to 96 would make that thirty tiles and a 2.3 ms worst-case step; the
reach a large brush wants is the coarser simulation of fluid brushes 21,
not more slots at this resolution.

**Rows over the bar, ticketed.** The fluid rows count five or six
allocations with the pen down, flooded or not: each stroke that goes down
into wet paint makes a texture for its pen-down copy (fluid brushes 34).
The 512 px rows at 8192² of `--fluid`, whose wash outgrows the limit under
the pen and settles there with history reading it back, are fluid brushes
33. The batched deposit at 64 and 512 px is the table of fluid brushes 10,
above: the dab is not the cost.

### Blotting wet paint (fluid brushes 17)

`--fluid-load` paints the same workload again over the same flood with a
blot brush (water 1, pigment 0.8, the Tissue's): its dabs reach only tiles
that are wet, take no slot, and run the absorb pass where a fluid stroke
runs the pour. Apple GPU (Metal 3), Chrome/WebGPU, 75 Hz display, 2560 ×
1440 window, six strokes, 2026-10-15, on top of `547e974`; the fluid rows
of the same run are given beside them:

| document | brush | paint | ms/frame, unpaced | sustained fps | all frames, median / p95 | steps/frame, paced | skipped | reckoned ms a step | dabs | readbacks | allocations |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1024² | 64 px | Fluid, 16 wet | 1.060 | 500.0 | 14.4 / 17.2 ms | 1.52 | 0 | 0.470 | 356 | 0 | 6 |
| 1024² | 64 px | Blot, 16 wet | 0.971 | 500.0 | 14.4 / 17.5 ms | 1.46 | 0 | 0.468 | 356 | 0 | 6 |
| 1024² | 512 px | Fluid, 16 wet | 1.044 | 526.3 | 14.3 / 17.1 ms | 1.46 | 0 | 0.470 | 46 | 0 | 6 |
| 1024² | 512 px | Blot, 16 wet | 0.976 | 500.0 | 14.0 / 16.7 ms | 1.46 | 0 | 0.482 | 46 | 0 | 6 |
| 2048² | 64 px | Fluid, 64 wet | 1.345 | 400.0 | 15.0 / 17.7 ms | 0.98 | 59 | 1.775 | 614 | 0 | 6 |
| 2048² | 64 px | Blot, 64 wet | 1.347 | 416.7 | 14.8 / 17.6 ms | 0.99 | 58 | 1.762 | 614 | 0 | 6 |
| 2048² | 512 px | Fluid, 64 wet | 1.385 | 400.0 | 14.6 / 17.4 ms | 0.98 | 60 | 1.784 | 80 | 0 | 6 |
| 2048² | 512 px | Blot, 64 wet | 1.380 | 400.0 | 14.6 / 17.3 ms | 1.00 | 58 | 1.202 | 80 | 0 | 6 |

**A blot stroke over 64 wet tiles meets D30's frame rate,** 400 to 417 fps
unpaced against 120, and costs what a fluid stroke over the same flood
does: the absorb pass is the pour's size, and the step beside it is the
cost. History reads nothing back, since a blot settles nothing. The six
allocations are the pen-down copy each stroke into wet paint takes (fluid
brushes 34). Pen-to-pixel cannot be judged on this 75 Hz panel, where it is
a panel period and the frame's GPU work; the under-10 ms figure needs a 120
Hz display, which there is none of.
