# Large-brush bleed reach: experimental GPU path

## Outcome — not accepted for shipping

Story 21's first GPU candidate broadens pigment mixing at fixed simulation
steps, but slows delivered simulation progress substantially. It stays disabled
by default. This is an experiment result, **not completion of story 21** or an
approved visual target, cap, or scaling curve.

The user agreed to an experiment gate: preserve small brushes, local mixing
scale, fine detail, existing water/drying behaviour and scheduling protections;
review actual images and GPU cost before selecting a shipping design. We must
not call the candidate successful merely because presentation stays responsive.

## Reproduce

```sh
bunx playwright test tests/browser/fluid-reach.spec.ts --workers=1
bun run bench --fluid-reach
```

The browser tests exercise the engine's command/rendered-pixel seam, using
SwiftShader for repeatability. They save side-by-side PNGs in their test output
directories at 100, 250 and 500 px diameter: **baseline left, candidate right**.
These are blue single-dab washes with an 8 px-radius yellow touch, not a claim
that the full overlapping-stroke/diagonal/fine-detail visual matrix is done.
Both halves use identical settings and 100 manually commanded steps: water 0.5,
drying 0.5, Bleed 1, edge 0, granulation 0. A small touch enters the locally
large-scale wash even though the active brush is now small.

The benchmark uses the existing real-GPU runner and queue-fenced simulation
timing, **not SwiftShader timings**. Raw results are written to the ignored
`bench/results/fluid-reach.json`; the summary below is the retained record.

## Candidate

- Enable only via `createEngine(canvas, { experimentalFluidReach: true })`, or
  the corresponding renderer option. There is no application UI/preset change.
- Retain half-document-resolution water/pigment fields, drying, bloom, the
  64-slot limit, the clock and post-presentation scheduling.
- Store local maximum dab diameter in a fourth ping-pong field; dab rasterization
  writes an extra max-blended attachment only where it lays water. Small
  additions retain existing local larger scale. Scale does not propagate with
  pigment or through allocation bodies. Clear it on dry/blotted cells; slot
  clearing and wet-history capture/restore include the extra field.
- In the experiment only, metadata uses the existing `rgba16float` field format
  for straightforward lifecycle/copy reuse. At 64 slots, the extra two fields
  and laid attachment cost 24 MiB. Wet-history field storage grows by one third.
  The default path allocates none of these resources.
- Smoothstep diameter 150–500 px into provisional weights
  `[1 - 0.75t, 0.375t, 0.375t]` at axial distances 1, 2 and 4 simulation cells.
  Keep a local component even at maximum scale. Cap metadata diameter at 500 px.
  These are **experimental**, not agreed shipping values.
- Pair exchange uses the minimum endpoint weight. This is symmetric and bounded
  by each endpoint's own ring weights; their sum is one. Four directions at
  maximum per-face Bleed 0.05 consume at most 0.2 of a donor's pigment, alongside
  existing water-driven outflow bounded by 0.8. This is an analytical outflow
  bound, **not a measured GPU density-conservation test**. Half-float rounding
  still applies.
- Every intervening cell must hold standing water and every intervening
  selection face must be open. Endpoints alone are insufficient. Mixing remains
  the existing density-weighted pigment model, not RGB blur.

The earlier isolated CPU screen used different weights and a maximum endpoint
scale. Its measurements are not the GPU candidate's measurements. The minimum
weights and retained local component address the joint-advection donor budget
and avoid a zero-coupling boundary between small and large scales.

## GPU measurements, 2026-10-16

Apple GPU / Metal 3, Chrome 153, macOS, device pixel ratio 1, measured display
cadence **75 Hz**. Queue-empty to queue-empty timings include submission/fence
overhead, not timestamp-query-only shader execution. Each step row uses a 500 px
flood brush, 50 warm-up steps, then five rounds of 50 steps. These large-dab
flood rows are a controlled baseline/candidate comparison, **not the original
small-dab, per-cell colour worst-case benchmark**.

| Allocated wet tiles | Baseline median ms/step | Candidate median ms/step | Ratio |
| --- | ---: | ---: | ---: |
| 4 (512²) | 0.116 | 0.344 | 2.97× |
| 16 (1024²) | 0.432 | 1.472 | 3.41× |
| 64 (2048²) | 1.576 | 5.816 | 3.69× |

Paced painting: identical 2048² pre-flooded workload, four 500 px strokes,
history not waited for. Pre-flood uses the existing small-dab flood; large
workload dabs establish larger scale locally. The 80 pen-down clock ticks
include the warm-up portion, whereas reported latency uses the runner's normal
warm-up filtering; raw tick counts are not a separate fixed-duration throughput
test.

| Metric | Baseline | Candidate |
| --- | ---: | ---: |
| Pen-down clock ticks | 80 | 80 |
| Delivered steps | 78 | 23 |
| Skipped steps | 41 | 98 |
| Steps per pen-down tick | 0.975 | 0.288 |
| Pen-to-pixel median / p95 | 14.7 / 18.0 ms | 13.9 / 17.5 ms |
| Interactive readbacks | 0 | 0 |

The scheduler protects presentation by reducing simulation progress. Similar
latency therefore does **not** rescue this candidate: it delivers under one
third as many steps and cannot be accepted as a real-time reach improvement.
The panel-specific latency says only what this 75 Hz setup measured.

## Covered and deliberately outstanding

Engine tests cover fixed-step reach, 100/150 px preservation, Bleed zero,
disconnected marks sharing allocation, a thin selection slit, undo/redo with
continued simulation, and cancelled/undone/cleared large dabs not leaving scale
in reused cells. PNGs provide reproducible comparison evidence, not artist
approval.

Still outstanding: overlapping large strokes and reversed order; isotropy/grid
lobes and cap/curve quality; dry/blotted barriers and feathered selections;
fine suspended/deposited detail and granulation; metadata behaviour with bloom,
hold/pause and natural drying; GPU density-drift/nonnegativity measurements.
Existing default-path tests remain relevant but do not prove these experimental
cases. There is no reason to complete that visual tuning matrix for this
candidate before addressing its already-failed performance gate.

Next design decision: choose a materially cheaper transport/metadata strategy
or explicitly revise scope with the user. Do not enable this method, weaken the
budget, lengthen wet lifetime, or fold capacity/rate-ownership stories into this
one to make the experiment appear successful.
