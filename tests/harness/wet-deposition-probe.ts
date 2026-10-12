import { featherSelection, rectSelection } from "../../engine/doc/selection"
import { createTiledLayer } from "../../engine/doc/tiled-layer"
import { TILE_SIZE } from "../../engine/doc/tile-grid"
import { createRenderer } from "../../engine/gpu/renderer"
import { SMUDGE, SMUDGE_STRIDE } from "../../engine/gpu/smudge-dab"

/** Compares wet deposition paths through stored paint, including load restoration. */
export async function wetDepositionProbe(options: {
  radius: number
  layerTarget: boolean
  tip: boolean
  cancel: boolean
  decorated?: boolean
  large?: boolean
  edge?: boolean
  pickupOnly?: boolean
  spread?: boolean
}) {
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const errors: string[] = []
  device.addEventListener("uncapturederror", (event) =>
    errors.push(event.error.message)
  )
  const renderer = createRenderer(device, {
    format: "rgba8unorm",
    outputColorSpace: "srgb",
    background: [1, 1, 1],
    ink: [0.1, 0.2, 0.7, 1],
    feather: 1,
    directWetTarget: options.layerTarget ? "layer" : undefined,
  })
  try {
    const width = options.edge
      ? 3031
      : options.spread
        ? 3072
        : options.large
          ? 1024
          : 240
    const height = options.edge ? 1007 : options.large ? 1024 : 120
    const offset = options.large ? 300 : 0
    renderer.resize(width, height)
    if (options.decorated) {
      const data = Uint8Array.from(
        { length: 16 * 16 },
        (_, i) => (i * 37) % 256
      )
      renderer.setGrain(
        { width: 16, height: 16, data },
        { scale: 8, depth: 0.7, movement: 0.6 }
      )
      const mask = rectSelection(
        { width, height },
        { x: 80, y: 35, width: 100, height: 50 }
      )!
      renderer.setSelection(featherSelection({ width, height }, mask, 8))
    }
    if (options.tip) {
      // Nonzero at the rim: catches filtering into the clear border texel.
      const data = Uint8Array.from(
        { length: 32 * 32 },
        (_, i) => 64 + (i % 192)
      )
      renderer.setTip({ width: 32, height: 32, data })
    }
    const layer = createTiledLayer({ width, height })
    layer.fillRect(
      { x: 40 + offset, y: 20 + offset, width: 60, height: 80 },
      [0.6, 0.02, 0.03, 1]
    )
    layer.fillRect(
      { x: 130 + offset, y: 20 + offset, width: 12, height: 80 },
      [0.02, 0.15, 0.3, 0.6]
    )
    renderer.uploadLayer("layer", layer)
    const draw = (radius: number, y: number, flow = 0.3) => {
      const count = options.edge ? 5 : 4
      const dabs = new Float32Array(count * SMUDGE_STRIDE)
      for (let i = 0; i < count; i++) {
        const start = i * SMUDGE_STRIDE
        dabs[start + SMUDGE.CENTER_X] =
          40.3 + offset + i * (options.spread ? 700 : 40)
        if (i === 4) dabs[start + SMUDGE.CENTER_X] = width - 16.3
        dabs[start + SMUDGE.CENTER_Y] = i === 4 ? height - 16.6 : y + offset
        dabs[start + SMUDGE.RADIUS] = radius
        dabs[start + SMUDGE.ANGLE] = 0.13
        dabs[start + SMUDGE.ROUNDNESS] = 0.6
        dabs[start + SMUDGE.FLOW] = flow
        dabs[start + SMUDGE.STRENGTH] = 0.8
        dabs[start + SMUDGE.GRAIN_DEPTH] = 0.75
      }
      renderer.drawDirect(dabs, count)
    }
    renderer.beginDirect("layer", [0.1, 0.2, 0.7, 1], true)
    draw(options.radius, 50.6)
    if (options.pickupOnly) draw(options.radius, 80.3, 0)
    renderer.endDirect(true)
    if (options.cancel) {
      // Automatic cleaning uses a different extent, then cancellation
      // must restore the dirty load at its original extent again.
      renderer.beginDirect("layer", [0.9, 0.7, 0.1, 1], false)
      draw(options.radius < 64 ? 128 : 12, 80.3)
      renderer.endDirect(false)
    }
    renderer.beginDirect("layer", [0.9, 0.7, 0.1, 1], true)
    draw(options.radius * 0.5, 70.2)
    renderer.endDirect(true)
    const dirty = renderer.brushDirty()
    renderer.cleanBrush()
    const cleaned = !renderer.brushDirty()
    const tiles = await renderer.readTiles("layer", [
      { x: options.large ? 1 : 0, y: options.large ? 1 : 0 },
      ...(options.spread ? [{ x: 9, y: 1 }] : []),
      ...(options.edge ? [{ x: 11, y: 3 }] : []),
    ])
    if (errors.length) throw new Error(errors.join("\n"))
    const texels: number[] = []
    for (const tile of tiles)
      for (let y = 0; y < (options.large ? TILE_SIZE : height); y++)
        for (let x = 0; x < (options.large ? TILE_SIZE : width) * 4; x++)
          texels.push(tile[y * TILE_SIZE * 4 + x])
    return { texels, dirty, cleaned }
  } finally {
    renderer.destroy()
    device.destroy()
  }
}
