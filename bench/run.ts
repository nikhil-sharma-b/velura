/**
 * The benchmark runner (D30). `bun run bench`.
 *
 * Launches a real browser on the real GPU, drives the workload through the
 * engine, and records the result where the next run can be compared against
 * it. Deliberately not a Playwright test: the suite runs on SwiftShader so its
 * golden images mean the same thing everywhere, and a software rasterizer has
 * nothing to say about whether this architecture reaches 120 fps.
 *
 * It is tracked, not gated: the process exits zero whatever the numbers are,
 * because a benchmark that fails a build teaches people to make it quieter
 * rather than to make the program faster. The one exception is CPU readback
 * during painting, which D30 forbids — that is a rule, not a measurement,
 * and breaking it fails the run. Fluid brushes 40's bounded edge report is
 * allowed only by the steep fluid-load sweep, with throughput still met.
 *
 * `--sweep` runs the document-size ladder instead of the two passes, and
 * `--layers` the layer-count one; `--feather` paints inside a large feathered
 * selection against the same painting with none (11); `--scatter` paints with
 * a dense scattering brush against the same painting without; `--smudge`
 * smudges the painting against painting it (smudge 01); `--wet` paints over
 * it with wet brushes against the same brushes dry (live brushes 10), and
 * with `--unwaited` its scattering rows again with the pen not waiting for
 * history between strokes (live brushes 28), and with `--undo` undo pressed
 * while history is still putting each stroke away (live brushes 32);
 * `--wet --dab --large` selects the 512 px pickup, densest and scattered
 * rows at 8192² without changing their workload; `--wet-dab` measures warm
 * sixteen-dab pass ablations (`--scatter-dabs` uses thrown centres and
 * `--layer-target` selects original layer deposition);
 * `--blender` compares small blenders with wet brushes that have flow;
 * `--fluid` paints with fluid brushes against the same brushes dry (fluid
 * brushes 10); `--fluid-load` times a step of the simulation over 16 and 64
 * wet tiles, moving and held with drying paused, and paints, and blots,
 * with every tile of the document wet (fluid brushes 13, 17, 18); add
 * `--steep` for the full-steepness board comparison (39);
 * `--cold` times a draw into a texture left alone (live brushes 24);
 * `--vector` times
 * redrawing a vector layer of many paths (19); `--navigate` times panning and
 * zooming a stack whose caches each step rebuilds (sharp-zoom 01). They are
 * how the tables in
 * `docs/design/benchmark.md` were measured, and they exist so those tables can
 * be reproduced rather than taken on trust.
 */

import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser } from "@playwright/test"
import type { Environment } from "./driver"
import type { FluidTick, FrameTiming } from "../engine"
import { judge, PERFORMANCE_TARGET, summarize, type Report } from "./report"
import { VECTOR_WORKLOAD } from "./vector-workload"
import { type BrushScatter, MAX_SCATTER_COUNT } from "../engine/brush/scatter"
import {
  BENCHMARK_WORKLOAD,
  createWorkload,
  workloadStats,
  type WorkloadOptions,
} from "./workload"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RESULTS = join(ROOT, "bench", "results")
const HISTORY = join(RESULTS, "history.jsonl")
const PORT = Number(process.env.VELURA_BENCH_PORT ?? 3102)
const HARNESS = `http://127.0.0.1:${PORT}/tests/harness/`

/**
 * Frames discarded from the front of the run. The first frames of a stroke pay
 * for pipeline creation and for tiles the layer has never touched; those are
 * real costs, but they are start-up costs and they are not what "sustained"
 * means.
 */
const WARMUP_FRAMES = 20

/**
 * The two passes a run makes, and why there are two.
 *
 * `paced` leaves the browser's vsync alone, so a frame is presented when the
 * display can show it and the GPU queue stays one frame deep. That is the only
 * arrangement in which the fence timing pen-to-pixel means anything.
 *
 * `unpaced` removes the frame-rate limit, so the loop runs as fast as the
 * engine allows and the frame rate is the engine's rather than the panel's.
 * The cost is that the CPU races ahead of the GPU and the same fence resolves
 * long after the pixel was wanted, which is why latency is not read from here.
 */
const PASSES = [
  { name: "paced", args: [] as string[], measureDisplay: true },
  {
    name: "unpaced",
    args: ["--disable-gpu-vsync", "--disable-frame-rate-limit"],
    measureDisplay: false,
  },
] as const

type PassName = (typeof PASSES)[number]["name"]

type Pass = {
  environment: Environment
  canvas: { width: number; height: number }
  /** Dispatched against requested: a shortfall means the pen could not keep up. */
  pen: { dispatched: number; requested: number; elapsedMs: number }
  readbacks: number
  runEdgeReadbacks: number
  readbacksTotal: number
  /** Textures and buffers created while the pen was down. */
  allocations: number
  report: Report
}

/** A pass with what is kept out of the recorded summary. */
type Measured = Pass & {
  frames: FrameTiming[]
  fluidTicks: (FluidTick & { penDown: boolean })[]
  strokeStarts: number[]
  readbackBytes: number
  historySettledMs: number[]
  undoMs: number[]
}

type BenchRun = {
  version: 1
  recordedAt: string
  git: { commit: string; branch: string; dirty: boolean }
  workload: WorkloadOptions & { strokes: number; samples: number }
  passes: Record<PassName, Pass>
  /** Frame rate from the unpaced pass, latency from the paced one. */
  meetsTarget: { frameRate: boolean; latency: boolean; overall: boolean }
}

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: ROOT })
  return new TextDecoder().decode(result.stdout).trim()
}

/** Vite, serving the harness the browser tests already use. */
async function serve(): Promise<() => void> {
  const server = spawn(
    "bunx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    { cwd: ROOT, stdio: "ignore" }
  )
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(HARNESS)
      if (response.ok) return () => server.kill()
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  server.kill()
  throw new Error("The harness server did not start.")
}

/**
 * Headed, and without the SwiftShader flags the test suite uses. WebGPU on the
 * real adapter is the entire question, and a headless software path answers a
 * different one.
 */
async function launch(extra: readonly string[]): Promise<Browser> {
  return chromium.launch({
    headless: false,
    args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan", ...extra],
  })
}

/** One browser, one pass of the workload. */
async function measure(
  pass: (typeof PASSES)[number],
  workload: WorkloadOptions
): Promise<Measured> {
  const browser = await launch(pass.args)
  try {
    const page = await browser.newPage()
    page.on("pageerror", (error) => console.error("page error:", error.message))
    await page.goto(HARNESS)
    await page.waitForFunction(() => !!window.runBenchmark)
    const environment = await page.evaluate(
      (measureDisplay) => window.describeEnvironment(measureDisplay),
      pass.measureDisplay
    )
    const result = await page.evaluate(
      (options) => window.runBenchmark(options),
      workload
    )
    return {
      environment,
      canvas: result.canvas,
      pen: {
        dispatched: result.dispatched,
        requested: result.requested,
        elapsedMs: result.elapsedMs,
      },
      readbacks: result.readbacks,
      runEdgeReadbacks: result.runEdgeReadbacks,
      readbacksTotal: result.readbacksTotal,
      allocations: result.allocations,
      report: summarize(result.frames, {
        warmupFrames: WARMUP_FRAMES,
        strokeStarts: result.strokeStarts,
      }),
      frames: result.frames,
      strokeStarts: result.strokeStarts,
      readbackBytes: result.readbackBytes,
      fluidTicks: result.fluidTicks,
      historySettledMs: result.historySettledMs,
      undoMs: result.undoMs,
    }
  } finally {
    await browser.close()
  }
}

function fixed(value: number, places = 1): string {
  return value.toFixed(places)
}

function print(run: BenchRun): void {
  const paced = run.passes.paced
  const unpaced = run.passes.unpaced
  const environment = paced.environment
  const gpu =
    environment.adapter?.description || environment.adapter?.vendor || "unknown"
  const verdict = (met: boolean) => (met ? "MET" : "MISSED")
  const readbacks = paced.readbacks + unpaced.readbacks
  console.log(`
Velura performance benchmark (D30)
  commit      ${run.git.commit.slice(0, 8)}${run.git.dirty ? " (dirty)" : ""} on ${run.git.branch}
  gpu         ${gpu}
  display     ${environment.refreshHz ?? "not measured"} Hz
  canvas      ${paced.canvas.width} x ${paced.canvas.height}
  window      ${run.workload.viewport ? `${run.workload.viewport.width} x ${run.workload.viewport.height}` : "document-sized"}
  workload    ${run.workload.strokes} strokes, ${run.workload.samples} pen samples at ${run.workload.sampleRateHz} Hz
  stamps      ${paced.report.stamps.total} dabs paced, ${unpaced.report.stamps.total} unpaced

  frame rate  (unpaced: the engine's own ceiling, vsync off)
              ${unpaced.report.frames} frames, ${unpaced.report.droppedFrames} dropped
              median ${fixed(unpaced.report.frameRate.median)} fps, sustained ${fixed(unpaced.report.frameRate.sustained)} fps, worst ${fixed(unpaced.report.frameRate.min)} fps
              cpu/frame median ${fixed(unpaced.report.cpuMs.median, 2)} ms, p95 ${fixed(unpaced.report.cpuMs.p95, 2)} ms
              target ${PERFORMANCE_TARGET.fps} fps ..... ${verdict(run.meetsTarget.frameRate)}

  pen-to-px   (paced: presented at the display's rate, one frame in flight)
              ${paced.report.frames} frames at ${fixed(paced.report.frameRate.median)} fps
              median ${fixed(paced.report.latencyMs.median, 2)} ms, p95 ${fixed(paced.report.latencyMs.p95, 2)} ms, worst ${fixed(paced.report.latencyMs.max, 2)} ms
              cpu/frame median ${fixed(paced.report.cpuMs.median, 2)} ms, p95 ${fixed(paced.report.cpuMs.p95, 2)} ms
              target ${PERFORMANCE_TARGET.latencyMs} ms ..... ${verdict(run.meetsTarget.latency)}

  readback    ${readbacks} calls while the pen was down ..... ${readbacks === 0 ? "NONE" : "PRESENT — D30 violated"}
              ${paced.readbacksTotal + unpaced.readbacksTotal} in total, history reading back what each mark landed in (D21)
  overall     ${verdict(run.meetsTarget.overall)}
`)
  if (
    environment.refreshHz !== null &&
    environment.refreshHz < PERFORMANCE_TARGET.fps
  )
    console.log(
      `  Note: the display refreshes at ${environment.refreshHz} Hz. That caps the paced pass,\n` +
        `  and pen-to-pixel there includes up to one panel period of waiting for a\n` +
        `  vsync this machine cannot give at ${PERFORMANCE_TARGET.fps} Hz. Re-run on a ${PERFORMANCE_TARGET.fps} Hz display\n` +
        `  before concluding the latency target is out of reach.\n`
    )
}

/**
 * The document-size ladder, unpaced. Frame rate falling as the area rather
 * than as the work is what identifies a cost that belongs to the size of the
 * document rather than to painting, so this is the diagnostic that follows a
 * missed target.
 */
const SWEEP_SIZES = [1024, 2048, 4096, 8192]

/** Fewer strokes than a recorded run: this measures scaling, not a baseline. */
const SWEEP_STROKES = 6

async function sweep(): Promise<void> {
  const pass = PASSES.find((entry) => entry.name === "unpaced")!
  // The mean, not the median or the p95. Unpaced, the frame interval is
  // bimodal — the CPU runs ahead for free until the queue backs up — and every
  // frame runs the same full present pass whether or not a dab landed in it.
  // The average cost per frame is what scaling with document size is a claim
  // about, and it is the one statistic that bimodality does not distort.
  console.log("\n  document      ms/frame   mean fps   sustained fps   frames")
  for (const size of SWEEP_SIZES) {
    const measured = await measure(pass, {
      ...BENCHMARK_WORKLOAD,
      // A claim about the document's size, so the window grows with it.
      viewport: undefined,
      width: size,
      height: size,
      strokes: SWEEP_STROKES,
    })
    const { report } = measured
    const perFrame = report.frameIntervalMs.mean
    console.log(
      `  ${String(size).padStart(4)}²    ${fixed(perFrame, 3).padStart(10)}   ` +
        `${fixed(1000 / perFrame).padStart(8)}   ` +
        `${fixed(report.frameRate.sustained).padStart(13)}   ` +
        `${String(report.frames).padStart(6)}`
    )
  }
  console.log()
}

/**
 * The layer ladder, unpaced: the same painting on a document of two layers and
 * on one of fifty. D19 claims a frame costs a constant number of texture reads
 * whatever the stack is, and this is the measurement that claim answers to — a
 * per-frame cost that climbed with the layer count would mean the caches were
 * not doing their job, whatever the pass counts said.
 */
const LAYER_COUNTS = [2, 50]

/**
 * Smaller than the recorded workload. Every layer holding pixels is a
 * canvas-sized `rgba16float` texture until the per-layer atlases land (D-6.1),
 * and fifty of those at 8192² is tens of gigabytes. What is being measured is
 * how the cost moves with the layer count, and that is visible at any size.
 */
const LAYER_SWEEP_SIZE = 1024

async function layerSweep(): Promise<void> {
  const pass = PASSES.find((entry) => entry.name === "unpaced")!
  console.log("\n  layers      ms/frame   mean fps   sustained fps   frames")
  for (const layers of LAYER_COUNTS) {
    const { report } = await measure(pass, {
      ...BENCHMARK_WORKLOAD,
      // As the size ladder: the window is the document, as it was recorded.
      viewport: undefined,
      width: LAYER_SWEEP_SIZE,
      height: LAYER_SWEEP_SIZE,
      strokes: SWEEP_STROKES,
      layers,
    })
    const perFrame = report.frameIntervalMs.mean
    console.log(
      `  ${String(layers).padStart(4)}      ${fixed(perFrame, 3).padStart(10)}   ` +
        `${fixed(1000 / perFrame).padStart(8)}   ` +
        `${fixed(report.frameRate.sustained).padStart(13)}   ` +
        `${String(report.frames).padStart(6)}`
    )
  }
  console.log()
}

/**
 * Painting inside a large feathered selection (11), against the same painting
 * with nothing selected: the soft mask is read by every dab, and this is what
 * says whether that costs a frame anything.
 */
const FEATHER_RADIUS = 64

async function featherSweep(): Promise<void> {
  const pass = PASSES.find((entry) => entry.name === "unpaced")!
  console.log("\n  feather     ms/frame   mean fps   sustained fps   frames")
  for (const feather of [undefined, FEATHER_RADIUS]) {
    const { report } = await measure(pass, {
      ...BENCHMARK_WORKLOAD,
      strokes: SWEEP_STROKES,
      feather,
    })
    const perFrame = report.frameIntervalMs.mean
    console.log(
      `  ${String(feather ?? "none").padStart(7)}   ${fixed(perFrame, 3).padStart(10)}   ` +
        `${fixed(1000 / perFrame).padStart(8)}   ` +
        `${fixed(report.frameRate.sustained).padStart(13)}   ` +
        `${String(report.frames).padStart(6)}`
    )
  }
  console.log()
}

/**
 * Painting with a dense scattering brush, against the same painting with
 * none: every spacing step lays the most dabs a brush may ask for, thrown
 * across and along the path, and this is what says whether the stamp pass
 * still fits in a frame (D30).
 */
const DENSE_SCATTER: BrushScatter = Object.freeze({
  amount: 4,
  count: MAX_SCATTER_COUNT,
  axes: "both",
})

async function scatterSweep(): Promise<void> {
  const pass = PASSES.find((entry) => entry.name === "unpaced")!
  console.log(
    "\n  scatter     ms/frame   mean fps   sustained fps   dabs      readbacks"
  )
  for (const scatter of [undefined, DENSE_SCATTER]) {
    const { report, readbacks } = await measure(pass, {
      ...BENCHMARK_WORKLOAD,
      strokes: SWEEP_STROKES,
      scatter,
    })
    const perFrame = report.frameIntervalMs.mean
    console.log(
      `  ${(scatter ? `×${scatter.count}` : "none").padStart(7)}   ${fixed(perFrame, 3).padStart(10)}   ` +
        `${fixed(1000 / perFrame).padStart(8)}   ` +
        `${fixed(report.frameRate.sustained).padStart(13)}   ` +
        `${String(report.stamps.total).padStart(8)}   ${String(readbacks).padStart(9)}`
    )
    if (readbacks > 0) process.exitCode = 1
  }
  console.log()
}

/**
 * Smudging (smudge 01), against painting the same strokes. A smudge stroke
 * keeps what a cancel puts back, and then its dabs are drawn a run at a time:
 * two copies and a pass for the run (live brushes 22), where each dab was
 * once a copy and a pass of its own. The first shows in the pen-to-pixel of
 * the frame the stroke opens in, and is the stroke's size and not the
 * document's (smudge 06), which is why a small document is run beside the
 * large one; the second is paid per frame. Paced, because pen-to-pixel only
 * means anything with one frame in flight.
 */
const SMUDGE_SIZES = [2048, 8192]
/**
 * Smudge at its default size, and at a size small enough that its spacing,
 * a quarter of its radius, is a pixel (live brushes 19): the most dabs a
 * smudge lays in a frame, which the wet spacing floor would not let a wet
 * brush lay and which smudge, keeping its spacing, does. It holds the frame
 * because the dabs of a frame share a pass (live brushes 22).
 */
const SMUDGE_TOOLS = [
  { name: "brush", smudge: false },
  { name: "smudge", smudge: true },
  { name: "smudge, 4 px", smudge: true, smudgeRadius: 4 },
]

const middle = (values: number[]) =>
  [...values].sort((a, b) => a - b)[values.length >> 1]

/**
 * Pen-to-pixel of the frame each stroke's pen-down was drawn in: the first,
 * from where the stroke began, that consumed a sample.
 */
function openingFrames({ frames, strokeStarts }: Measured): number[] {
  return strokeStarts.flatMap((start) => {
    const frame = frames.slice(start).find((f) => f.latencyMs !== null)
    return frame ? [frame.latencyMs!] : []
  })
}

async function smudgeSweep(): Promise<void> {
  const pass = PASSES.find((entry) => entry.name === "paced")!
  console.log(
    "\n  pen-to-pixel in ms" +
      "\n  document  tool          stroke's first frame (median / worst)   all frames (median / p95)   dabs     readbacks   allocations"
  )
  for (const size of SMUDGE_SIZES)
    for (const { name, ...tool } of SMUDGE_TOOLS) {
      const measured = await measure(pass, {
        ...BENCHMARK_WORKLOAD,
        width: size,
        height: size,
        strokes: SWEEP_STROKES,
        ...tool,
      })
      const { report, readbacks, allocations } = measured
      const opening = openingFrames(measured)
      console.log(
        `  ${`${size}²`.padEnd(8)}  ${name.padEnd(12)}  ` +
          `${fixed(middle(opening)).padStart(18)} / ${fixed(Math.max(...opening)).padEnd(15)}   ` +
          `${fixed(report.latencyMs.median).padStart(12)} / ${fixed(report.latencyMs.p95).padEnd(8)}   ` +
          `${String(report.stamps.total).padStart(6)}   ${String(readbacks).padStart(9)}   ${String(allocations).padStart(11)}`
      )
      if (readbacks > 0) process.exitCode = 1
    }
  console.log()
}

const WET_DIAMETERS = process.argv.includes("--blender")
  ? [4, 8, 16, 32]
  : process.argv.includes("--large")
    ? [512]
    : [64, 512]
const HEAVY_PICKUP = 0.8
/**
 * The closest dabs a brush can be given: an imported preset's spacing goes
 * down to this, half what the editor's slider does. It is under the wet
 * spacing floor at both sizes, so this row is the floor itself, measured.
 */
const DENSEST_SPACING = 0.01
const WET_PAINTS = process.argv.includes("--blender")
  ? [
      { name: "blender", pickup: 0.9, flow: 0 },
      { name: "wet, pickup", pickup: 0.9 },
    ]
  : [
      { name: "dry", pickup: 0, dry: true },
      { name: "wet", pickup: 0 },
      { name: "wet, pickup", pickup: HEAVY_PICKUP },
      { name: "wet, all layers", pickup: HEAVY_PICKUP, sampleAllLayers: true },
      { name: "wet, densest", pickup: HEAVY_PICKUP, spacing: DENSEST_SPACING },
      // The most dabs a spacing step can be made to lay (live brushes 12).
      { name: "dry, scatter", pickup: 0, dry: true, scatter: DENSE_SCATTER },
      { name: "wet, scatter", pickup: HEAVY_PICKUP, scatter: DENSE_SCATTER },
    ]

/**
 * Wet brushes (live brushes 10, 11), against the same brushes dry. A wet dab
 * is a copy of its neighbourhood and a draw of its own, and a second draw
 * into the reservoir when it picks up, where a dry brush's dabs are instances
 * in one draw; so a frame can afford only so many, and the wet spacing floor
 * is what keeps to that. Each brush is run dry, wet with no pickup, wet with
 * heavy pickup, wet at the closest spacing a brush can ask for, and dry and
 * wet with the densest scatter a brush can ask for, on a small document and
 * a large one, since nothing a wet stroke does may grow
 * with the document. Both passes, as a recorded run makes: the frame's cost
 * unpaced, pen-to-pixel paced.
 */
async function wetSweep(): Promise<void> {
  if (process.argv.includes("--unwaited")) return unwaitedSweep()
  if (process.argv.includes("--undo")) return undoSweep()
  if (process.argv.includes("--pause")) return pauseSweep()
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const unpaced = PASSES.find((entry) => entry.name === "unpaced")!
  // The acceptance comparison for the first sampling stroke (live brushes
  // 26), with the full sweep's workload and both of its passes unchanged.
  const openingOnly =
    process.argv.includes("--wet") && process.argv.includes("--opening")
  const sizes =
    openingOnly || process.argv.includes("--large") ? [8192] : SMUDGE_SIZES
  const paints = openingOnly
    ? WET_PAINTS.filter(
        ({ name }) => name === "wet, pickup" || name === "wet, all layers"
      )
    : process.argv.includes("--dab")
      ? WET_PAINTS.filter(({ name }) =>
          ["wet, pickup", "wet, densest", "wet, scatter"].includes(name)
        )
      : WET_PAINTS
  console.log(
    "\n                                    unpaced                    paced: pen-to-pixel in ms" +
      "\n  document  brush   paint         ms/frame   sustained fps   stroke's first frame (median / worst)   all frames (median / p95)   dabs    readbacks   allocations"
  )
  for (const size of sizes)
    for (const diameter of WET_DIAMETERS)
      for (const { name, ...paint } of paints) {
        const workload = {
          ...BENCHMARK_WORKLOAD,
          width: size,
          height: size,
          strokes: SWEEP_STROKES,
          wet: { diameter, ...paint },
        }
        const free = await measure(unpaced, workload)
        const held = await measure(paced, workload)
        const opening = openingFrames(held)
        const readbacks = free.readbacks + held.readbacks
        const allocations = Math.max(free.allocations, held.allocations)
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${diameter} px`.padEnd(6)}  ${name.padEnd(12)}  ` +
            `${fixed(free.report.frameIntervalMs.mean, 3).padStart(9)}   ${fixed(free.report.frameRate.sustained).padStart(13)}   ` +
            `${fixed(middle(opening)).padStart(18)} / ${fixed(Math.max(...opening)).padEnd(15)}   ` +
            `${fixed(held.report.latencyMs.median).padStart(12)} / ${fixed(held.report.latencyMs.p95).padEnd(8)}   ` +
            `${String(held.report.stamps.total).padStart(6)}   ${String(readbacks).padStart(9)}   ${String(allocations).padStart(11)}`
        )
        if (readbacks > 0) process.exitCode = 1
      }
  console.log()
}

const FLUID_PAINTS = [
  { name: "dry", dry: true },
  { name: "fluid" },
  // Many times the dabs over the same wash: what a dab adds to a frame.
  { name: "fluid, densest", spacing: DENSEST_SPACING },
  { name: "fluid, tip", tip: true },
  { name: "dry, scatter", dry: true, scatter: DENSE_SCATTER },
  { name: "fluid, scatter", scatter: DENSE_SCATTER },
]

/**
 * Fluid brushes (fluid brushes 10), against the same brush dry. A frame's
 * fluid dabs are one batch drawn into the wet surface and one pour of it
 * into the fields, as a dry brush's are one draw into the stroke buffer; the
 * simulation steps under both. The brush is run at an eighth of its diameter
 * between dabs and at the closest a brush can ask for, which lays many times
 * the dabs into the same wash, with a tip of several frames, and with the
 * densest scatter. Both passes, as a recorded run makes.
 */
async function fluidSweep(): Promise<void> {
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const unpaced = PASSES.find((entry) => entry.name === "unpaced")!
  console.log(
    "\n                                      unpaced                               paced: pen-to-pixel in ms" +
      "\n  document  brush   paint           ms/frame   sustained fps   dabs/frame   all frames (median / p95)   dabs    readbacks   allocations"
  )
  for (const size of SMUDGE_SIZES)
    for (const diameter of [64, 512])
      for (const { name, ...paint } of FLUID_PAINTS) {
        const workload = {
          ...BENCHMARK_WORKLOAD,
          width: size,
          height: size,
          strokes: SWEEP_STROKES,
          fluid: { diameter, ...paint },
        }
        const free = await measure(unpaced, workload)
        const held = await measure(paced, workload)
        const readbacks = free.readbacks + held.readbacks
        const allocations = Math.max(free.allocations, held.allocations)
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${diameter} px`.padEnd(6)}  ${name.padEnd(14)}  ` +
            `${fixed(free.report.frameIntervalMs.mean, 3).padStart(9)}   ${fixed(free.report.frameRate.sustained).padStart(13)}   ` +
            `${fixed(held.report.stamps.total / Math.max(1, held.report.frames)).padStart(10)}   ` +
            `${fixed(held.report.latencyMs.median).padStart(12)} / ${fixed(held.report.latencyMs.p95).padEnd(8)}   ` +
            `${String(held.report.stamps.total).padStart(6)}   ${String(readbacks).padStart(9)}   ${String(allocations).padStart(11)}`
        )
      }
  console.log()
}

/** Documents a whole number of tiles a side: 16 wet tiles, and 64. */
const FLOODED_SIZES = [1024, 2048]

/**
 * The fluid simulation under load (fluid brushes 13). First a step's cost
 * over a document flooded worst case, every cell wet and its neighbours
 * another colour, at 16 and 64 wet tiles. Then the workload painted with a
 * fluid brush over the same flood, every tile wet under the pen, against
 * the same brush on a dry document, and a blot brush over the flood: whether
 * the pen still meets D30 with the simulation stepping beside it, and how
 * many steps the clock ran and skipped a frame. Strokes do not wait on
 * history between them, since a save dries the flood.
 */
async function fluidLoadSweep(): Promise<void> {
  const steep = process.argv.includes("--steep")
  console.log(`\n  Board: ${steep ? "full steepness, downhill" : "flat"}`)
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const unpaced = PASSES.find((entry) => entry.name === "unpaced")!
  console.log(
    "\n  document  wet tiles   ms/step (median, min, max)   µs per tile-step   tiles in 2 ms   MB"
  )
  // Each flood again with drying paused and every body of it held (fluid
  // brushes 18): a step passes held paint by.
  for (const size of FLOODED_SIZES)
    for (const held of [false, true]) {
      const browser = await launch(paced.args)
      try {
        const page = await browser.newPage()
        page.on("pageerror", (error) =>
          console.error("page error:", error.message)
        )
        await page.goto(HARNESS)
        await page.waitForFunction(() => !!window.runFluidStepBenchmark)
        const { stepMs } = await page.evaluate(
          ([size, held, steep]) =>
            window.runFluidStepBenchmark(
              { width: size, height: size },
              undefined,
              held,
              steep
            ),
          [size, held, steep] as const
        )
        const tiles = (size / 256) ** 2
        const sorted = [...stepMs].sort((a, b) => a - b)
        const median = sorted[sorted.length >> 1]
        const perTile = (median * 1000) / tiles
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${tiles}${held ? " held" : ""}`.padStart(9)}   ` +
            `${fixed(median, 3).padStart(7)}, ${fixed(sorted[0], 3)}, ${fixed(sorted[sorted.length - 1], 3)}`.padEnd(
              29
            ) +
            `${fixed(perTile, 1).padStart(16)}   ${fixed(2000 / perTile, 0).padStart(13)}   ${fixed(tiles * 0.75, 1)}`
        )
      } finally {
        await browser.close()
      }
    }
  console.log(
    "\n                                     unpaced                    paced: pen-to-pixel in ms" +
      "\n  document  brush   paint        ms/frame   sustained fps   all frames (median / p95)   Hz    steps/frame   skipped   reckoned ms/step   dabs    readbacks (edges)   allocations"
  )
  for (const size of FLOODED_SIZES)
    for (const diameter of [64, 512])
      for (const { name, ...paint } of [
        { name: "dry", dry: true },
        { name: "fluid" },
        { name: `fluid, ${(size / 256) ** 2} wet`, flooded: true },
        // A blot reaches only the tiles that are wet (fluid brushes 17).
        { name: `blot, ${(size / 256) ** 2} wet`, flooded: true, blot: true },
      ]) {
        const workload = {
          ...BENCHMARK_WORKLOAD,
          width: size,
          height: size,
          strokes: SWEEP_STROKES,
          unwaited: true,
          fluid: { diameter, steep, ...paint },
        }
        const free = await measure(unpaced, workload)
        const held = await measure(paced, workload)
        const readbacks = free.readbacks + held.readbacks
        const edges = free.runEdgeReadbacks + held.runEdgeReadbacks
        const allocations = Math.max(free.allocations, held.allocations)
        const ticks = held.fluidTicks.filter((tick) => tick.penDown)
        const steps = ticks.reduce((total, tick) => total + tick.steps, 0)
        const skipped = ticks.reduce((total, tick) => total + tick.skipped, 0)
        const reckoned = ticks.map((tick) => tick.stepMs).sort((a, b) => a - b)
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${diameter} px`.padEnd(6)}  ${name.padEnd(11)}  ` +
            `${fixed(free.report.frameIntervalMs.mean, 3).padStart(9)}   ${fixed(free.report.frameRate.sustained).padStart(13)}   ` +
            `${fixed(held.report.latencyMs.median).padStart(12)} / ${fixed(held.report.latencyMs.p95).padEnd(12)}   ` +
            `${String(held.environment.refreshHz ?? "-").padStart(3)}   ` +
            `${fixed(steps / Math.max(1, ticks.length), 2).padStart(11)}   ${String(skipped).padStart(7)}   ` +
            `${fixed(reckoned[reckoned.length >> 1] ?? 0, 3).padStart(16)}   ` +
            `${String(held.report.stamps.total).padStart(6)}   ${String(readbacks).padStart(9)} (${edges})   ${String(allocations).padStart(11)}`
        )
        // Ticket 40 explicitly permits this bounded report when painting
        // still meets D30's throughput target. All other interactive
        // readbacks remain forbidden; totals above never hide the reports.
        if (
          readbacks > (steep ? edges : 0) ||
          (edges > 0 &&
            free.report.frameRate.sustained < PERFORMANCE_TARGET.fps)
        )
          process.exitCode = 1
      }
  console.log()
}

/**
 * What a pause before pen-down costs the frame a stroke opens in (live
 * brushes 31): the 512 px rows at 8192², paced, each with no wait but
 * history's and again with `--pause`'s milliseconds more, two seconds where
 * none is given. Every stroke's opening frame is printed, since whether one
 * misses the display's frame is in the worst of them and not the median.
 */
async function pauseSweep(): Promise<void> {
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const given = Number(process.argv[process.argv.indexOf("--pause") + 1])
  const pauseMs = Number.isFinite(given) && given > 0 ? given : 2000
  console.log(
    `\n  8192², 512 px, paced: pen-to-pixel of each stroke's first frame in ms, sorted` +
      `\n  paint            pause      median / worst   each stroke`
  )
  for (const { name, ...paint } of WET_PAINTS)
    for (const pause of [0, pauseMs]) {
      const held = await measure(paced, {
        ...BENCHMARK_WORKLOAD,
        width: 8192,
        height: 8192,
        strokes: SWEEP_STROKES,
        wet: { diameter: 512, ...paint },
        ...(pause ? { pauseMs: pause } : {}),
      })
      const opening = openingFrames(held).sort((a, b) => a - b)
      console.log(
        `  ${name.padEnd(15)}  ${`${pause} ms`.padStart(7)}   ` +
          `${fixed(middle(opening)).padStart(8)} / ${fixed(Math.max(...opening)).padEnd(6)}   ` +
          opening.map((ms) => fixed(ms)).join("  ")
      )
    }
  console.log()
}

/**
 * What history costs the stroke after the one it is putting away (live
 * brushes 28): the scattering rows, whose strokes change the most tiles,
 * paced, each with the pen waiting for history between strokes and again
 * with it not waiting, as a person paints. Unwaited, the readback of a
 * stroke may begin with the pen down again, so readbacks are counted over
 * both and not failed on.
 */
async function unwaitedSweep(): Promise<void> {
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const paints = WET_PAINTS.filter(({ name }) => name.endsWith("scatter"))
  console.log(
    "\n                                    paced, pen-to-pixel in ms: history waited for             history not waited for" +
      "\n  document  brush   paint         first frame (median / worst)   all (median / p95)   first frame (median / worst)   all (median / p95)   readbacks   largest readback   pen-up to history settled (median / worst)"
  )
  for (const size of SMUDGE_SIZES)
    for (const diameter of WET_DIAMETERS)
      for (const { name, ...paint } of paints) {
        const workload = {
          ...BENCHMARK_WORKLOAD,
          width: size,
          height: size,
          strokes: SWEEP_STROKES,
          wet: { diameter, ...paint },
        }
        const cells: string[] = []
        let readbacks = 0
        let readbackBytes = 0
        let settled: number[] = []
        for (const unwaited of [false, true]) {
          const held = await measure(paced, { ...workload, unwaited })
          const opening = openingFrames(held)
          readbacks += held.readbacks
          readbackBytes = Math.max(readbackBytes, held.readbackBytes)
          if (!unwaited) settled = held.historySettledMs
          cells.push(
            `${fixed(middle(opening)).padStart(12)} / ${fixed(Math.max(...opening)).padEnd(13)}   ` +
              `${fixed(held.report.latencyMs.median).padStart(7)} / ${fixed(held.report.latencyMs.p95).padEnd(8)}`
          )
        }
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${diameter} px`.padEnd(6)}  ${name.padEnd(12)}  ` +
            `${cells.join("   ")}   ${String(readbacks).padStart(9)}   ` +
            `${`${fixed(readbackBytes / 2 ** 20)} MiB`.padStart(16)}   ` +
            `${fixed(middle(settled), 0).padStart(12)} / ${fixed(Math.max(...settled), 0)} ms`
        )
      }
  console.log()
}

/**
 * What an undo pressed while history is putting a stroke away waits for (live
 * brushes 32): the scattering rows, whose strokes change the most tiles,
 * paced, with undo pressed as the stroke reaches history, a second later,
 * and once history has settled, which is what the undo itself takes. Timed
 * to the step having been taken back, its tiles handed to the GPU.
 */
const UNDO_AFTER = [0, 1000, "settled"] as const

async function undoSweep(): Promise<void> {
  const paced = PASSES.find((entry) => entry.name === "paced")!
  const paints = WET_PAINTS.filter(({ name }) => name.endsWith("scatter"))
  const sizes = process.argv.includes("--large") ? [8192] : SMUDGE_SIZES
  console.log(
    "\n                                    undo pressed to the step taken back, median / worst in ms" +
      "\n  document  brush   paint         as the stroke reaches history     a second later     history settled"
  )
  for (const size of sizes)
    for (const diameter of WET_DIAMETERS)
      for (const { name, ...paint } of paints) {
        const cells: string[] = []
        for (const undoAfter of UNDO_AFTER) {
          const { undoMs } = await measure(paced, {
            ...BENCHMARK_WORKLOAD,
            width: size,
            height: size,
            strokes: SWEEP_STROKES,
            wet: { diameter, ...paint },
            undoAfter,
          })
          cells.push(
            `${fixed(middle(undoMs), 0)} / ${fixed(Math.max(...undoMs), 0)}`
          )
        }
        console.log(
          `  ${`${size}²`.padEnd(8)}  ${`${diameter} px`.padEnd(6)}  ${name.padEnd(12)}  ` +
            `${cells[0].padStart(29)}   ${cells[1].padStart(16)}   ${cells[2].padStart(17)}`
        )
      }
  console.log()
}

/**
 * What a texture left alone costs the next pass drawn into it (live brushes
 * 24), with no engine in the way: a 512 px scissored draw into a layer-sized
 * texture, timed to the GPU's fence after each length of idleness, and again
 * with something done every 800 ms of the wait. It is why a stroke that
 * opens after a pause opened late, and what the engine's warming is sized by.
 */
const COLD_SIZES = [2048, 8192]
const COLD_IDLE_MS = [0, 500, 1000, 2000, 4000]

async function coldSweep(): Promise<void> {
  const browser = await launch([])
  try {
    const page = await browser.newPage()
    page.on("pageerror", (error) => console.error("page error:", error.message))
    await page.goto(HARNESS)
    const rows = await page.evaluate(
      async ({ sizes, idles }) => {
        const adapter = await navigator.gpu.requestAdapter()
        if (!adapter) throw new Error("No adapter.")
        const device = await adapter.requestDevice({
          requiredLimits: { maxTextureDimension2D: Math.max(...sizes) },
        })
        const sleep = (ms: number) =>
          new Promise<void>((resolve) => setTimeout(resolve, ms))
        const shader = device.createShaderModule({
          code: `@vertex fn v(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
            var corners = array(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
            return vec4f(corners[i], 0, 1);
          }
          @fragment fn f() -> @location(0) vec4f { return vec4f(0.5); }`,
        })
        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: shader },
          fragment: { module: shader, targets: [{ format: "rgba16float" }] },
        })
        const layer = (size: number) =>
          device
            .createTexture({
              size: [size, size],
              format: "rgba16float",
              usage:
                GPUTextureUsage.RENDER_ATTACHMENT |
                GPUTextureUsage.TEXTURE_BINDING,
            })
            .createView()
        /** A pass into `view`, with a dab's worth drawn or nothing drawn. */
        const pass = (view: GPUTextureView, draws: boolean, clears = false) => {
          const encoder = device.createCommandEncoder()
          const drawn = encoder.beginRenderPass({
            colorAttachments: [
              { view, loadOp: clears ? "clear" : "load", storeOp: "store" },
            ],
          })
          if (draws) {
            drawn.setPipeline(pipeline)
            drawn.setScissorRect(100, 100, 512, 512)
            drawn.draw(3)
          }
          drawn.end()
          device.queue.submit([encoder.finish()])
        }
        const timedDab = async (view: GPUTextureView) => {
          const start = performance.now()
          pass(view, true)
          await device.queue.onSubmittedWorkDone()
          return performance.now() - start
        }
        const middle = (values: number[]) =>
          [...values].sort((a, b) => a - b)[values.length >> 1]
        const rows: { size: number; wait: string; ms: number }[] = []
        for (const size of sizes) {
          const view = layer(size)
          const other = layer(size)
          pass(view, false, true)
          pass(other, false, true)
          await timedDab(view)
          const measure = async (wait: string, idle: () => Promise<void>) => {
            const times: number[] = []
            for (let i = 0; i < 3; i++) {
              await idle()
              times.push(await timedDab(view))
            }
            rows.push({ size, wait, ms: middle(times) })
          }
          for (const idle of idles)
            await measure(`${idle} ms, untouched`, () => sleep(idle))
          const kept = (touch: () => void) => async () => {
            for (let i = 0; i < 5; i++) {
              await sleep(800)
              touch()
            }
            await sleep(100)
          }
          await measure(
            "4100 ms, another texture drawn into every 800 ms",
            kept(() => pass(other, false, true))
          )
          await measure(
            "4100 ms, nothing drawn into it every 800 ms",
            kept(() => pass(view, false))
          )
        }
        return rows
      },
      { sizes: COLD_SIZES, idles: COLD_IDLE_MS }
    )
    console.log(
      "\n  a 512 px draw into a texture after a wait, ms to GPU done (median of 3)" +
        "\n  texture   wait                                                 ms"
    )
    for (const row of rows)
      console.log(
        `  ${`${row.size}²`.padEnd(7)}   ${row.wait.padEnd(50)}   ${fixed(row.ms).padStart(5)}`
      )
    console.log()
  } finally {
    await browser.close()
  }
}

/**
 * Redrawing a vector layer (19), on the real GPU, at a ladder of path counts:
 * the first draw of the whole scene, an edit spanning the layer (every path
 * redrawn), and an edit to one path (only its region redrawn). Re-rasterising
 * is what a vector layer pays instead of a compositor of its own, so this is
 * the number that says what that choice costs. Beside them, navigating at
 * high zoom, where every step draws the paths into the screen through the
 * view (sharp-zoom 02).
 */
const PATH_COUNTS = [500, 2000, 8000]

async function vectorSweep(): Promise<void> {
  const browser = await launch([])
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[values.length >> 1]
  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]
  try {
    console.log(
      `\n  vector layer, ${VECTOR_WORKLOAD.width}², ms from edit to GPU done` +
        "\n  paths     first draw   whole layer (median / p95)   one path (median / p95)   navigating at 8× (median / p95)"
    )
    for (const paths of PATH_COUNTS) {
      const page = await browser.newPage()
      page.on("pageerror", (error) =>
        console.error("page error:", error.message)
      )
      await page.goto(HARNESS)
      await page.waitForFunction(() => !!window.runVectorBenchmark)
      const result = await page.evaluate(
        (options) => window.runVectorBenchmark(options),
        { ...VECTOR_WORKLOAD, paths }
      )
      console.log(
        `  ${String(paths).padStart(5)}   ${fixed(result.firstDrawMs).padStart(10)}   ` +
          `${fixed(median(result.fullRedrawMs)).padStart(12)} / ${fixed(p95(result.fullRedrawMs)).padEnd(12)}   ` +
          `${fixed(median(result.localRedrawMs), 2).padStart(10)} / ${fixed(p95(result.localRedrawMs), 2).padEnd(10)}   ` +
          `${fixed(median(result.navigateMs), 2).padStart(10)} / ${fixed(p95(result.navigateMs), 2)}`
      )
      await page.close()
    }
    console.log()
  } finally {
    await browser.close()
  }
}

/**
 * Navigating a stack (sharp-zoom 01), at the layer ladder's counts: the
 * screen is composited at the window's resolution through the view, so a
 * pan or zoom rebuilds the caches — a draw per layer at viewport size. D30
 * holds painting to a frame whatever the stack is; this is what navigating
 * costs instead, and whether it fits in one.
 */
async function navigationSweep(): Promise<void> {
  const browser = await launch([])
  const median = (values: number[]) =>
    [...values].sort((a, b) => a - b)[values.length >> 1]
  const p95 = (values: number[]) =>
    [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]
  try {
    console.log(
      `\n  navigating, ${LAYER_SWEEP_SIZE}² document, ms from command to GPU done` +
        "\n  layers   viewport    median     p95"
    )
    for (const layers of LAYER_COUNTS) {
      const page = await browser.newPage()
      page.on("pageerror", (error) =>
        console.error("page error:", error.message)
      )
      await page.goto(HARNESS)
      await page.waitForFunction(() => !!window.runNavigationBenchmark)
      const result = await page.evaluate(
        (options) => window.runNavigationBenchmark(options),
        { width: LAYER_SWEEP_SIZE, height: LAYER_SWEEP_SIZE, layers }
      )
      console.log(
        `  ${String(result.layers).padStart(6)}   ${`${result.viewport.width}×${result.viewport.height}`.padStart(8)}   ` +
          `${fixed(median(result.frameMs), 2).padStart(7)}   ${fixed(p95(result.frameMs), 2).padStart(6)}`
      )
      await page.close()
    }
    console.log()
  } finally {
    await browser.close()
  }
}

async function wetDabDiagnostic(): Promise<void> {
  const browser = await launch([])
  try {
    const page = await browser.newPage()
    await page.goto(HARNESS)
    await page.waitForFunction(() => !!window.wetDabProbe)
    console.log(
      JSON.stringify(
        await page.evaluate((options) => window.wetDabProbe(options), {
          scatter: process.argv.includes("--scatter-dabs"),
          layerTarget: process.argv.includes("--layer-target"),
        }),
        null,
        2
      )
    )
  } finally {
    await browser.close()
  }
}

async function main(): Promise<void> {
  const workload = process.argv.includes("--colour")
    ? { ...BENCHMARK_WORKLOAD, colourDynamics: true }
    : BENCHMARK_WORKLOAD
  const stop = await serve()
  const ladder = process.argv.includes("--wet-dab")
    ? wetDabDiagnostic
    : process.argv.includes("--sweep")
      ? sweep
      : process.argv.includes("--layers")
        ? layerSweep
        : process.argv.includes("--feather")
          ? featherSweep
          : process.argv.includes("--scatter")
            ? scatterSweep
            : process.argv.includes("--smudge")
              ? smudgeSweep
              : process.argv.includes("--fluid-load")
                ? fluidLoadSweep
                : process.argv.includes("--fluid")
                  ? fluidSweep
                  : process.argv.includes("--wet") ||
                      process.argv.includes("--blender")
                    ? wetSweep
                    : process.argv.includes("--cold")
                      ? coldSweep
                      : process.argv.includes("--vector")
                        ? vectorSweep
                        : process.argv.includes("--navigate")
                          ? navigationSweep
                          : null
  if (ladder) {
    try {
      await ladder()
    } finally {
      stop()
    }
    return
  }
  try {
    const measured = {} as Record<PassName, Measured>
    for (const pass of PASSES) {
      console.log(`  running the ${pass.name} pass...`)
      measured[pass.name] = await measure(pass, workload)
    }
    const strip = ({
      frames: _frames,
      strokeStarts: _strokeStarts,
      fluidTicks: _fluidTicks,
      ...pass
    }: Measured) => pass
    const passes = {
      paced: strip(measured.paced),
      unpaced: strip(measured.unpaced),
    }
    const stats = workloadStats(createWorkload(workload))
    const run: BenchRun = {
      version: 1,
      recordedAt: new Date().toISOString(),
      git: {
        commit: git(["rev-parse", "HEAD"]),
        branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
        // Excluding what this run is about to write: a run is not "dirty"
        // for having produced its own result.
        dirty:
          git(["status", "--porcelain", "--", ".", ":!bench/results"]).length >
          0,
      },
      workload: { ...workload, ...stats },
      passes,
      meetsTarget: judge(passes.unpaced.report, passes.paced.report),
    }

    mkdirSync(RESULTS, { recursive: true })
    const name = run.recordedAt.replace(/[:.]/g, "-")
    // The whole run, every frame of it, so a suspicious number can be re-read
    // later without re-running it on a machine that has since changed.
    writeFileSync(
      join(RESULTS, `${name}.json`),
      `${JSON.stringify(
        {
          ...run,
          frames: {
            paced: measured.paced.frames,
            unpaced: measured.unpaced.frames,
          },
        },
        null,
        2
      )}\n`
    )
    // And one line per run, which is what a regression is spotted in.
    appendFileSync(HISTORY, `${JSON.stringify(run)}\n`)
    print(run)
    compare(run)

    // The only failing condition: D30's rule, not D30's numbers.
    if (passes.paced.readbacks + passes.unpaced.readbacks > 0)
      process.exitCode = 1
  } finally {
    stop()
  }
}

/** The previous run on this machine, so a regression shows up as it happens. */
function compare(run: BenchRun): void {
  let history: BenchRun[]
  try {
    history = readFileSync(HISTORY, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BenchRun)
  } catch {
    return
  }
  // The same adapter painting through the same window: a run through a
  // document-sized window measures a different frame from one through a
  // screen-sized one.
  const comparable = (entry: BenchRun) =>
    JSON.stringify([
      entry.passes?.paced?.environment?.adapter,
      entry.workload.viewport ?? null,
      !!entry.workload.colourDynamics,
    ])
  const previous = history
    .slice(0, -1)
    .reverse()
    .find((entry) => comparable(entry) === comparable(run))
  if (!previous) {
    console.log(
      "  No earlier run on this machine and window to compare against.\n"
    )
    return
  }
  const delta = (now: number, before: number, places = 2) =>
    `${now >= before ? "+" : ""}${fixed(now - before, places)}`
  console.log(
    `  Against ${previous.git.commit.slice(0, 8)} (${previous.recordedAt}):\n` +
      `    sustained fps ${delta(run.passes.unpaced.report.frameRate.sustained, previous.passes.unpaced.report.frameRate.sustained)}` +
      `   p95 latency ${delta(run.passes.paced.report.latencyMs.p95, previous.passes.paced.report.latencyMs.p95)} ms\n` +
      // The workload is seeded, but how many dabs reach the GPU depends on how
      // many samples a slow frame let into the ring. A frame-rate delta beside
      // a dab-count delta is a change in the work, not necessarily in the code.
      `    dabs ${delta(run.passes.unpaced.report.stamps.total, previous.passes.unpaced.report.stamps.total, 0)}\n`
  )
}

await main()
