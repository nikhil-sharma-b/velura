import { pigmentShader } from "./pigment"
import { preprocess } from "./preprocess"
import wet from "./wet.wgsl"

/**
 * A fluid brush's dabs (D42), drawn batched into the wet fields: water into
 * one target and pigment into the other, each added to what is there.
 *
 * An instance is one dab in one wet tile, placed in the field texture where
 * that tile's slot is; a dab over a border is an instance for each tile it
 * reaches, and each is cut to its own slot here. Where a cell lies in the dab
 * is worked out from the cell, as a direct dab's is, so the two instances of
 * a dab either side of a border lay the same paint and leave no seam.
 */
export const fluidDabShader = /* wgsl */ `
struct Fluid {
  // Premultiplied linear ink.
  ink: vec4<f32>,
  // The field textures' size in cells.
  fieldSize: vec2<f32>,
  // Rim falloff and water per dab, the first in cells.
  feather: f32,
  water: f32,
}

@group(0) @binding(0) var<uniform> fluid: Fluid;

struct Varyings {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) center: vec2<f32>,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) load: f32,
  @location(3) @interpolate(flat) slot: vec4<f32>,
}

@vertex
fn vertexMain(
  @builtin(vertex_index) index: u32,
  // The dab's centre and radius in cells of the field texture.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  @location(2) load: f32,
  // The slot's first cell, and the one past its last.
  @location(3) slot: vec4<f32>,
) -> Varyings {
  let corner = vec2<f32>(f32(index & 1u), f32((index >> 1u) & 1u)) * 2.0 - 1.0;
  // A cell past the rim, so one the rim only grazes is still drawn.
  let cell = center + corner * (radius + 1.0);
  var out: Varyings;
  out.position = vec4<f32>(
    cell.x / fluid.fieldSize.x * 2.0 - 1.0,
    1.0 - cell.y / fluid.fieldSize.y * 2.0,
    0.0,
    1.0
  );
  out.center = center;
  out.radius = radius;
  out.load = load;
  out.slot = slot;
  return out;
}

struct Fields {
  @location(0) water: vec4<f32>,
  @location(1) pigment: vec4<f32>,
}

@fragment
fn fragmentMain(varyings: Varyings) -> Fields {
  let cell = varyings.position.xy;
  if (any(cell < varyings.slot.xy) || any(cell >= varyings.slot.zw)) { discard; }
  // A plain round tip. Its rim is never narrower than a cell, which is as
  // fine as a field can hold an edge.
  let feather = max(fluid.feather, 1.0);
  let shape = 1.0 - smoothstep(varyings.radius - feather, varyings.radius, distance(cell, varyings.center));
  var out: Fields;
  out.water = vec4<f32>(fluid.water * shape, 0.0, 0.0, 0.0);
  // Density is the pigment's alpha, and its colour is premultiplied by it.
  out.pigment = fluid.ink * (varyings.load * shape);
  return out;
}
`

/**
 * Settling (D42): a wet tile's paint glazed onto the layer's own pixels, by
 * the function the screen shows it with. `under` is a copy of the tile as the
 * layer holds it, since a pass cannot read what it draws into.
 */
export const fluidSettleShader = preprocess(
  /* wgsl */ `
#include "pigment"
#include "wet"

@group(0) @binding(0) var under: texture_2d<f32>;
@group(0) @binding(1) var wetSlots: texture_2d<u32>;
@group(0) @binding(2) var wetPigment: texture_2d<f32>;

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(index) / 2) * 4.0 - 1.0;
  let y = f32(i32(index) & 1) * 4.0 - 1.0;
  return vec4<f32>(x, y, 0.0, 1.0);
}

@fragment
fn fragmentMain(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
  // The copy holds one tile, from its own corner.
  let texel = vec2<i32>(position.xy) & vec2<i32>(255);
  return glazeWet(textureLoad(under, texel, 0), wetSlots, wetPigment, position.xy);
}
`,
  { pigment: pigmentShader, wet }
)
