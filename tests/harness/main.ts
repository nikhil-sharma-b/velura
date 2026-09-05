import { BRUSH_COLOR, BRUSH_FEATHER } from "../../engine/brush/round-brush"
import { createTextureLibrary } from "../../engine/brush/texture"
import { BACKGROUND } from "../../engine/doc/scene"
import { createRenderer } from "../../engine/gpu/renderer"
import { STAMP_STRIDE } from "../../engine/gpu/stamp-instance"
import { createEngine, type Engine } from "../../engine"

/** One dab, as a test writes it. Everything past opacity has a neutral default. */
type Dab = {
  x: number
  y: number
  radius: number
  opacity: number
  angle?: number
  roundness?: number
  grainDepth?: number
}

/**
 * The renderer's stroke buffer, driven directly. Discarding stamps has no
 * pointer gesture behind it — it is what prediction (D26) will call — so the
 * tests reach the seam through this rather than through a pen.
 */
type StrokeBufferProbe = {
  beginStroke(accumulation: "coverage" | "buildup", opacity: number): void
  /** The tip texture, by id, or null for the procedural disc. */
  setTip(id: string | null): void
  /** The paper, by id, with the tile scale and how hard it bites. */
  setGrain(id: string | null, scale: number, depth: number): void
  stamp(dabs: Dab[]): void
  discardStamps(count: number): boolean
  endStroke(): void
  present(): void
}

declare global {
  interface Window {
    engine: Engine
    remountEngine(): void
    /** Snapshot notifications counted by the stroke tests. */
    strokeNotifications: number
    openStrokeBufferProbe(width: number, height: number): Promise<void>
    probe: StrokeBufferProbe
  }
}

const canvas = document.querySelector("canvas")!
window.engine = createEngine(canvas)

window.remountEngine = () => {
  window.engine.dispose()
  window.engine = createEngine(canvas)
}

window.openStrokeBufferProbe = async (width, height) => {
  // Created on demand rather than sitting in the page: the other tests locate
  // the engine's canvas by tag, and a second one would make that ambiguous.
  const surface =
    (document.getElementById("probe") as HTMLCanvasElement | null) ??
    document.body.appendChild(document.createElement("canvas"))
  surface.id = "probe"
  surface.width = width
  surface.height = height
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const context = surface.getContext("webgpu")!
  const format = navigator.gpu.getPreferredCanvasFormat()
  context.configure({ device, format, alphaMode: "opaque" })
  const renderer = createRenderer(device, {
    // Pinned to sRGB: a golden image has to mean the same thing on every
    // machine that runs it, whatever the display can show.
    format,
    outputColorSpace: "srgb",
    background: BACKGROUND,
    ink: BRUSH_COLOR,
    feather: BRUSH_FEATHER,
  })
  renderer.resize(width, height)
  const instances = new Float32Array(1024 * STAMP_STRIDE)
  const textures = createTextureLibrary()
  const texture = (id: string) => {
    const found = textures.get(id)
    if (!found) throw new Error(`No texture is registered as ${id}.`)
    return found
  }
  window.probe = {
    beginStroke: (accumulation, opacity) =>
      renderer.beginStroke({ accumulation, opacity }),
    setTip: (id) => renderer.setTip(id ? texture(id) : null),
    setGrain: (id, scale, depth) =>
      renderer.setGrain(id ? texture(id) : null, scale, depth),
    stamp(dabs) {
      dabs.forEach((dab, i) => {
        instances.set(
          [
            dab.x,
            dab.y,
            dab.radius,
            dab.opacity,
            dab.angle ?? 0,
            dab.roundness ?? 1,
            dab.grainDepth ?? 1,
          ],
          i * STAMP_STRIDE
        )
      })
      renderer.stamp(instances, dabs.length)
    },
    discardStamps: (count) => renderer.discardStamps(count),
    endStroke: () => renderer.endStroke(),
    present: () => renderer.render(context.getCurrentTexture().createView()),
  }
}
