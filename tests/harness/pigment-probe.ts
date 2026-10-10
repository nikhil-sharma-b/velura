import { pigmentShader } from "../../engine/shaders/pigment"

/** Runs the shipped paint mix on the GPU, returning unpresented linear P3. */
export async function mixPaintProbe(
  under: number[],
  over: number[],
  amount: number
): Promise<number[]> {
  const adapter = await navigator.gpu.requestAdapter()
  const device = await adapter!.requestDevice()
  device.pushErrorScope("validation")
  const input = device.createBuffer({
    size: 48,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const output = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  })
  const readback = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })
  try {
    device.queue.writeBuffer(
      input,
      0,
      new Float32Array([...under, ...over, amount, 0, 0, 0])
    )
    const pipeline = await device.createComputePipelineAsync({
      layout: "auto",
      compute: {
        module: device.createShaderModule({
          code: `${pigmentShader}
          struct PaintInput { under: vec4<f32>, over: vec4<f32>, amount: vec4<f32> }
          @group(0) @binding(0) var<storage, read> paints: PaintInput;
          @group(0) @binding(1) var<storage, read_write> result: vec4<f32>;
          @compute @workgroup_size(1) fn main() {
            result = mixPaint(paints.under, paints.over, paints.amount.x);
          }`,
        }),
        entryPoint: "main",
      },
    })
    const encoder = device.createCommandEncoder()
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: input } },
          { binding: 1, resource: { buffer: output } },
        ],
      })
    )
    pass.dispatchWorkgroups(1)
    pass.end()
    encoder.copyBufferToBuffer(output, 0, readback, 0, 16)
    device.queue.submit([encoder.finish()])
    await readback.mapAsync(GPUMapMode.READ)
    const result = Array.from(new Float32Array(readback.getMappedRange()))
    readback.unmap()
    const error = await device.popErrorScope()
    if (error) throw new Error(error.message)
    return result
  } finally {
    input.destroy()
    output.destroy()
    readback.destroy()
    device.destroy()
  }
}
