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
