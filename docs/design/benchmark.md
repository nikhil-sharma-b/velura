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

**The worst opening frame is not level with the other rows.** It is 32.8–37.9 ms on 8192² against 14.8–22.7 ms for the wet rows beside it (40.8–42.1 ms before). It is one stroke in six, the first to sample: on 2048² the same row's worst is 18.4–23.6 ms against 10.9–20.5 ms. What that stroke does that the others do not was not separated here; it is the stroke that allocates the first pages and the window compositor's targets. Follow-up 26 owns it.

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
pixels by the same rounding; it was not done here (live brushes 27).

A blender's dabs drag as smudge's do and go the same way. Live brushes 23
now caps blender pitch at smudge spacing to keep small smears smooth; its
measurements above predate this compute-pass change.
