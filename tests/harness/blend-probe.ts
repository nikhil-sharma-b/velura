import { createRenderer } from "../../engine/gpu/renderer"
import { createTiledLayer } from "../../engine/doc/tiled-layer"
import type { BlendMode } from "../../engine/doc/document"

export type BlendProbe = {
  render(
    mode: BlendMode,
    opacity?: number,
    selected?: number
  ): Promise<number[]>
  stroke(commit: boolean): void
  dispose(): void
}

/** Canonical pair: endpoint/midtone grid, then colour and transparency bands. */
export async function openBlendProbe(): Promise<BlendProbe> {
  const width = 96
  const height = 144
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const errors: string[] = []
  device.addEventListener("uncapturederror", (event) =>
    errors.push(event.error.message)
  )
  const renderer = createRenderer(device, {
    format: "rgba8unorm",
    outputColorSpace: "srgb",
    background: [0.125, 0.125, 0.125],
    ink: [0.5, 0.5, 0.5, 1],
    feather: 0,
  })
  renderer.resize(width, height)
  const bottom = createTiledLayer({ width, height })
  const top = createTiledLayer({ width, height })
  const levels = [0, 0.125, 0.25, 0.5, 0.75, 1]
  for (let y = 0; y < 6; y++)
    for (let x = 0; x < 6; x++) {
      const rect = { x: x * 16, y: y * 16, width: 16, height: 16 }
      bottom.fillRect(rect, [levels[y], levels[y], levels[y], 1])
      top.fillRect(rect, [levels[x], levels[x], levels[x], 1])
    }
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 6; x++) {
      const a = levels[x]
      const b = y / 2
      const rect = { x: x * 16, y: 96 + y * 16, width: 16, height: 16 }
      bottom.fillRect(rect, [0.25 * b, 0.5 * b, 0.75 * b, b])
      top.fillRect(rect, [0.75 * a, 0.25 * a, 0.5 * a, a])
    }
  renderer.uploadLayer("bottom", bottom)
  renderer.uploadLayer("top", top)
  const output = device.createTexture({
    size: { width, height },
    format: "rgba8unorm",
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  })
  const bytesPerRow = 512
  const buffer = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  return {
    async render(mode, opacity = 1, selected = 1) {
      const items = [
        { id: "bottom", opacity: 1, blend: "normal" as const, clip: false },
        { id: "top", opacity, blend: mode, clip: false },
        { id: "empty", opacity: 1, blend: "normal" as const, clip: false },
      ]
      renderer.setComposition({
        below: items.slice(0, selected),
        active: items[selected],
        above: items.slice(selected + 1),
      })
      renderer.render(output.createView())
      const encoder = device.createCommandEncoder()
      encoder.copyTextureToBuffer(
        { texture: output },
        { buffer, bytesPerRow },
        { width, height }
      )
      device.queue.submit([encoder.finish()])
      await buffer.mapAsync(GPUMapMode.READ)
      const mapped = new Uint8Array(buffer.getMappedRange())
      const pixels = new Uint8Array(width * height * 4)
      for (let y = 0; y < height; y++)
        pixels.set(
          mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4),
          y * width * 4
        )
      buffer.unmap()
      if (errors.length) throw new Error(errors.join("\n"))
      return Array.from(pixels)
    },
    stroke(commit) {
      if (commit) renderer.endStroke()
      else {
        renderer.beginStroke({
          accumulation: "coverage",
          opacity: 0.5,
          mode: "paint",
        })
        renderer.stamp(
          new Float32Array([40, 40, 12, 1, 0, 1, 1, 0, 0, 0, 0]),
          1
        )
      }
    },
    dispose() {
      renderer.destroy()
      output.destroy()
      buffer.destroy()
      device.destroy()
    },
  }
}
