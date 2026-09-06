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
 * during painting, which D30 forbids outright — that is a rule, not a
 * measurement, and breaking it fails the run.
 *
 * `--sweep` runs the document-size ladder instead of the two passes, and
 * `--layers` the layer-count one. They are how the tables in
 * `docs/design/benchmark.md` were measured, and they exist so those tables can
 * be reproduced rather than taken on trust.
 */

import { spawn } from "node:child_process"
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium, type Browser } from "@playwright/test"
import type { Environment } from "./driver"
import type { FrameTiming } from "../engine"
import { judge, PERFORMANCE_TARGET, summarize, type Report } from "./report"
import {
  BENCHMARK_WORKLOAD,
  createWorkload,
  workloadStats,
  type WorkloadOptions,
} from "./workload"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const RESULTS = join(ROOT, "bench", "results")
const HISTORY = join(RESULTS, "history.jsonl")
const PORT = 3102
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
  readbacksTotal: number
  report: Report
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
): Promise<Pass & { frames: FrameTiming[] }> {
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
      readbacksTotal: result.readbacksTotal,
      report: summarize(result.frames, { warmupFrames: WARMUP_FRAMES }),
      frames: result.frames,
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

async function main(): Promise<void> {
  const stop = await serve()
  const ladder = process.argv.includes("--sweep")
    ? sweep
    : process.argv.includes("--layers")
      ? layerSweep
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
    const measured = {} as Record<PassName, Pass & { frames: FrameTiming[] }>
    for (const pass of PASSES) {
      console.log(`  running the ${pass.name} pass...`)
      measured[pass.name] = await measure(pass, BENCHMARK_WORKLOAD)
    }
    const strip = ({
      frames: _frames,
      ...pass
    }: Pass & { frames: FrameTiming[] }) => pass
    const passes = {
      paced: strip(measured.paced),
      unpaced: strip(measured.unpaced),
    }
    const stats = workloadStats(createWorkload(BENCHMARK_WORKLOAD))
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
      workload: { ...BENCHMARK_WORKLOAD, ...stats },
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
  const machine = (entry: BenchRun) =>
    JSON.stringify(entry.passes?.paced?.environment?.adapter)
  const previous = history
    .slice(0, -1)
    .reverse()
    .find((entry) => machine(entry) === machine(run))
  if (!previous) {
    console.log("  No earlier run on this machine to compare against.\n")
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
