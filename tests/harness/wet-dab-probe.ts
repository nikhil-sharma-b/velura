import { createScatterPlacer } from "../../engine/brush/scatter"
import { createTiledLayer } from "../../engine/doc/tiled-layer"
import { createRenderer } from "../../engine/gpu/renderer"
import { SMUDGE, SMUDGE_STRIDE } from "../../engine/gpu/smudge-dab"

/** Warm, one-variable ablation. Fence timings include CPU encoding and queue work;
 * omitted work deliberately changes paint, so these are diagnostics, not artwork.
 * "all" submits none of a dab's work: what is left is encoding and the fence. */
export async function wetDabProbe(
  options: { scatter?: boolean; layerTarget?: boolean } = {}
) {
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  const reservoirViews = new WeakSet<GPUTextureView>()
  const createTexture = device.createTexture.bind(device)
  device.createTexture = (descriptor) => {
    const texture = createTexture(descriptor)
    if (descriptor.label === "brush reservoir") {
      const createView = texture.createView.bind(texture)
      texture.createView = (descriptor) => {
        const view = createView(descriptor)
        reservoirViews.add(view)
        return view
      }
    }
    return texture
  }
  let active = false
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
  const createEncoder = device.createCommandEncoder.bind(device)
  let omit = "none"
  device.createCommandEncoder = (descriptor) => {
    const encoder = createEncoder(descriptor)
    const copy = encoder.copyTextureToTexture.bind(encoder)
    encoder.copyTextureToTexture = (source, destination, size) => {
      if (
        (omit === "copy" &&
          ["smudge carry", "wet neighbourhoods"].includes(
            destination.texture.label
          )) ||
        (omit === "backup" && destination.texture.label === "smudge backup") ||
        (active &&
          (omit === "copyback" || omit === "all") &&
          source.texture.label === "direct destination carry") ||
        (active && omit === "all")
      )
        return
      copy(source, destination, size)
    }
    const begin = encoder.beginRenderPass.bind(encoder)
    encoder.beginRenderPass = (descriptor) => {
      const view = Array.from(descriptor.colorAttachments)[0]?.view
      const pickup = view instanceof GPUTextureView && reservoirViews.has(view)
      // Encode the omitted pass into a buffer that is never submitted. This
      // removes its attachment load/store too, rather than just its draw.
      if (
        active &&
        ((omit === "pickup" && pickup) || (omit === "layer" && !pickup))
      )
        return createEncoder().beginRenderPass(descriptor)
      return begin(descriptor)
    }
    const compute = encoder.beginComputePass.bind(encoder)
    encoder.beginComputePass = (descriptor) => {
      if (
        active &&
        ((omit === "layer" && descriptor?.label === "wet deposition") ||
          (omit === "pickup" && descriptor?.label === "wet pickup") ||
          (omit === "dab" &&
            ["wet dab", "wet step"].includes(descriptor?.label ?? "")))
      )
        return createEncoder().beginComputePass(descriptor)
      if (active && omit === "all")
        return createEncoder().beginComputePass(descriptor)
      const pass = compute(descriptor)
      // The scratch path's one pass holds two dispatches: deposition into
      // scratch, then pickup into the next reservoir.
      if (active && (omit === "layer" || omit === "pickup")) {
        const dispatch = pass.dispatchWorkgroups.bind(pass)
        let dispatched = 0
        pass.dispatchWorkgroups = (...size) => {
          if ((dispatched++ === 0 ? "layer" : "pickup") !== omit)
            dispatch(...size)
        }
      }
      return pass
    }
    return encoder
  }
  try {
    renderer.resize(8192, 8192)
    const layer = createTiledLayer({ width: 8192, height: 8192 })
    layer.fillRect(
      { x: 512, y: 512, width: 2048, height: 2048 },
      [0.7, 0.1, 0.02, 1]
    )
    renderer.uploadLayer("layer", layer)
    const offsets = new Float32Array(32)
    const placer = createScatterPlacer()
    placer.begin(42)
    placer.place({ amount: 4, count: 16, axes: "both" }, 1, 256, 0, offsets)
    const dabs = new Float32Array(16 * SMUDGE_STRIDE)
    for (let i = 0; i < 16; i++) {
      const start = i * SMUDGE_STRIDE
      dabs[start + SMUDGE.CENTER_X] = options.scatter
        ? 2048 + offsets[i * 2]
        : 1024 + (i % 4) * 256
      dabs[start + SMUDGE.CENTER_Y] = options.scatter
        ? 2048 + offsets[i * 2 + 1]
        : 1024 + Math.floor(i / 4) * 256
      dabs[start + SMUDGE.RADIUS] = 256
      dabs[start + SMUDGE.ROUNDNESS] = 1
      dabs[start + SMUDGE.FLOW] = 0.3
      dabs[start + SMUDGE.STRENGTH] = 0.8
    }
    const modes = options.layerTarget
      ? ["none", "copy", "layer", "pickup", "backup"]
      : ["none", "copy", "dab", "layer", "pickup", "backup", "copyback", "all"]
    const times = modes.map(() => [] as number[])
    renderer.beginDirect("layer", [0.1, 0.2, 0.7, 1])
    // Interleave controls and ablations so GPU clock changes affect all rows.
    for (let i = 0; i < 80 * modes.length; i++) {
      const mode = i % modes.length
      omit = modes[mode]
      active = false
      renderer.endDirect(true)
      renderer.uploadLayer("layer", layer)
      renderer.beginDirect("layer", [0.1, 0.2, 0.7, 1])
      await device.queue.onSubmittedWorkDone()
      active = true
      const start = performance.now()
      renderer.drawDirect(dabs, 16)
      await device.queue.onSubmittedWorkDone()
      const elapsed = (performance.now() - start) / 16
      active = false
      if (i >= 20 * modes.length) times[mode].push(elapsed)
    }
    const results = modes.map((omit, index) => {
      times[index].sort((a, b) => a - b)
      return { omit, medianMs: times[index][30], p95Ms: times[index][57] }
    })
    renderer.endDirect(true)
    if (errors.length) throw new Error(errors.join("\n"))
    return { adapter: adapter!.info.description, results }
  } finally {
    device.createTexture = createTexture
    device.createCommandEncoder = createEncoder
    renderer.destroy()
    device.destroy()
  }
}
