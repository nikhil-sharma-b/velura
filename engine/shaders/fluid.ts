import { WET_CELL_SIZE, WET_SLOTS } from "../gpu/wet-tiles"
import { pigmentShader } from "./pigment"
import { preprocess } from "./preprocess"
import wet from "./wet.wgsl"

/** The most water a cell holds. */
export const FLUID_MAX_WATER = 1

/** Steps for damp paper to dry out once its water has gone. */
export const FLUID_DAMP_STEPS = 50

/**
 * A fluid brush's dabs (D42), drawn batched: water and dampness into one
 * target and pigment into the other, each added to the batch's other dabs.
 * The targets are not the wet fields. They hold what one batch laid, which
 * `pourMain` then pours into the fields, so that paint landing on wet paint
 * of another colour mixes with it as pigment.
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
  // A dab leaves the paper damp well out to its rim, where it lays little
  // water: dampness is what lets water move there at all.
  out.water = vec4<f32>(fluid.water * shape, 4.0 * shape, 0.0, 0.0);
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
@group(0) @binding(2) var wetDeposited: texture_2d<f32>;
@group(0) @binding(3) var wetSuspended: texture_2d<f32>;
@group(0) @binding(4) var paper: texture_2d<f32>;

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
  return glazeWet(
    textureLoad(under, texel, 0),
    wetSlots,
    wetDeposited,
    wetSuspended,
    paper,
    position.xy
  );
}
`,
  { pigment: pigmentShader, wet }
)

/**
 * The simulation (D42), the engine's compute pipelines: one pass over every
 * cell of every wet tile, reading one copy of the wet fields and writing the
 * other. An invocation is a cell of a slot; `sim.tiles` says which tile holds
 * the slot, and a neighbour over a tile border is found through the slots
 * map, so a body of water is simulated as one sheet.
 *
 * `stepMain` is one step of the clock. `pourMain` moves nothing: it pours
 * what a batch of dabs laid into the fields.
 *
 * The water field holds standing water in x and the paper's dampness in y,
 * with the water that crossed the cell's right and bottom faces in z and w.
 */
export const fluidSimShader = preprocess(
  /* wgsl */ `
#include "pigment"
#include "wet"

struct Sim {
  // Water a cell loses in a step.
  evaporation: f32,
  // The share of its pigment a cell trades with each neighbour holding water.
  bleed: f32,
  // How many times faster water evaporates at the very edge of the damp
  // area than in the middle of it, less one.
  edge: f32,
  // How much faster the paper takes pigment in its deepest valley than at
  // its middle height, less one; on its peaks it takes that much less.
  granulation: f32,
  // Each slot's tile in xy, and in z whether one holds it.
  tiles: array<vec4<i32>, ${WET_SLOTS}>,
}

// How fast water levels: the share of a height difference that crosses a
// face in a step.
const FLOW: f32 = 0.2;
// No cell gives more than this share of its water across one face in a step.
const FACE_SHARE: f32 = 0.2;
// The most water a cell holds.
const MAX_WATER: f32 = ${FLUID_MAX_WATER.toFixed(1)};
// How fast paper loses its dampness once no water stands on it.
const DAMP_FADE: f32 = ${(1 / FLUID_DAMP_STEPS).toFixed(4)};
// How far out a cell looks for the edge of the damp area, in cells: the rim
// that dries first is a band this wide, not one cell.
const EDGE_REACH: i32 = 6;
// The share of suspended pigment the paper takes in a step, and of deposited
// pigment that lifts back while water stands on it.
const DEPOSIT: f32 = 0.0003;
const LIFT: f32 = 0.001;
// How much water the paper's relief is worth, from its deepest valley to its
// highest peak: water sits a little deeper in the valleys.
const RELIEF: f32 = 0.03;
// Document pixels along one side of a cell.
const CELL_SIZE: i32 = ${WET_CELL_SIZE};

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var wetSlots: texture_2d<u32>;
@group(0) @binding(2) var water: texture_2d<f32>;
@group(0) @binding(3) var suspended: texture_2d<f32>;
@group(0) @binding(4) var deposited: texture_2d<f32>;
@group(0) @binding(5) var waterOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(6) var suspendedOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(7) var depositedOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var laidWater: texture_2d<f32>;
@group(0) @binding(9) var laidPigment: texture_2d<f32>;
@group(0) @binding(10) var paper: texture_2d<f32>;

// Where a slot's cell is in a field texture.
fn slotTexel(slot: u32, cell: vec2<u32>) -> vec2<i32> {
  let at = i32(slot);
  return vec2<i32>(at % WET_FIELD_COLUMNS, at / WET_FIELD_COLUMNS) * WET_CELLS + vec2<i32>(cell);
}

// The paper's height under a cell, read at one document pixel of it.
fn cellPaper(cell: vec2<i32>) -> f32 {
  return paperHeight(paper, cell * CELL_SIZE + CELL_SIZE / 2);
}

// Water crossing the face from a to b in a step. It follows the difference
// in the height of the water's surface, which is the water's depth and a
// little of the paper's relief under it, and moves only between two cells of
// damp paper, which is what keeps the edge of a wash where the brush put it.
// Both cells work the same number out for the face they share, so none is
// made or lost.
fn faceFlow(a: vec4<f32>, b: vec4<f32>, paperA: f32, paperB: f32) -> f32 {
  let damp = smoothstep(0.02, 0.3, min(a.y, b.y));
  let fall = a.x - b.x + RELIEF * (paperA - paperB);
  return clamp(FLOW * fall * damp, -FACE_SHARE * b.x, FACE_SHARE * a.x);
}

// How damp the paper is at a cell, for one looking for the edge of the damp
// area. Past the document there is no paper to be dry: it counts as being as
// damp as the cell that looks, so a wash that runs off the canvas has no rim
// along the canvas's edge.
fn dampAt(cell: vec2<i32>, own: f32) -> f32 {
  if (any(cell < vec2<i32>(0))) { return own; }
  if (any(cell / WET_CELLS >= vec2<i32>(textureDimensions(wetSlots)))) { return own; }
  return wetCell(wetSlots, water, cell).y;
}

// How near a cell is to the edge of the damp area, from none in the middle of
// it to one where nothing about is damp. It looks next door and EDGE_REACH
// cells out, each way: an eighth for each of the eight.
fn edgeNearness(cell: vec2<i32>, own: f32) -> f32 {
  var damp = 0.0;
  for (var reach = 1; reach <= EDGE_REACH; reach += EDGE_REACH - 1) {
    damp += dampAt(cell + vec2<i32>(-reach, 0), own);
    damp += dampAt(cell + vec2<i32>(reach, 0), own);
    damp += dampAt(cell + vec2<i32>(0, -reach), own);
    damp += dampAt(cell + vec2<i32>(0, reach), own);
  }
  return 1.0 - 0.125 * damp;
}

// How freely pigment diffuses between two cells: both have to hold water.
fn bleedGate(a: vec4<f32>, b: vec4<f32>) -> f32 {
  return sim.bleed * smoothstep(0.0, 0.25, min(a.x, b.x));
}

@compute @workgroup_size(8, 8, 1)
fn stepMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let tile = sim.tiles[id.z];
  if (tile.z == 0) { return; }
  let texel = slotTexel(id.z, id.xy);
  let cell = tile.xy * WET_CELLS + vec2<i32>(id.xy);
  let left = cell + vec2<i32>(-1, 0);
  let right = cell + vec2<i32>(1, 0);
  let up = cell + vec2<i32>(0, -1);
  let down = cell + vec2<i32>(0, 1);

  let c = textureLoad(water, texel, 0);
  let l = wetCell(wetSlots, water, left);
  let r = wetCell(wetSlots, water, right);
  let u = wetCell(wetSlots, water, up);
  let d = wetCell(wetSlots, water, down);

  // Water levels, then evaporates, faster near the edge of the damp area:
  // the water that flows out to replace it is what darkens a wash's rim.
  // Only where there is water does the paper under it matter: most of a wet
  // tile has none, and the paper is five more cells read.
  var height = 0.5;
  var relief = vec4<f32>(0.5);
  if (max(max(c.x, l.x), max(max(r.x, u.x), d.x)) > 0.0) {
    height = cellPaper(cell);
    relief = vec4<f32>(cellPaper(right), cellPaper(left), cellPaper(down), cellPaper(up));
  }
  let toRight = faceFlow(c, r, height, relief.x);
  let fromLeft = faceFlow(l, c, relief.y, height);
  let toDown = faceFlow(c, d, height, relief.z);
  let fromUp = faceFlow(u, c, relief.w, height);
  let level = c.x - toRight + fromLeft - toDown + fromUp;
  // Only a cell with water to lose looks for the edge: most of a wet tile
  // has none, and the looking is eight more cells read.
  var lost = sim.evaporation;
  if (level > 0.0 && sim.edge > 0.0) { lost *= 1.0 + sim.edge * edgeNearness(cell, c.y); }
  let w = clamp(level - lost, 0.0, MAX_WATER);
  // Paper under water is damp, and dries out once the water has gone.
  let dampness = select(max(0.0, c.y - DAMP_FADE), min(1.0, c.y + 0.2), w > 0.001);

  // Suspended pigment rides the water: the share of a cell's water crossing
  // a face carries the same share of its pigment. It also diffuses.
  let mine = 1.0 / max(c.x, 0.0001);
  let outRight = max(toRight, 0.0) * mine;
  let outLeft = max(-fromLeft, 0.0) * mine;
  let outDown = max(toDown, 0.0) * mine;
  let outUp = max(-fromUp, 0.0) * mine;
  let inRight = max(-toRight, 0.0) / max(r.x, 0.0001);
  let inLeft = max(fromLeft, 0.0) / max(l.x, 0.0001);
  let inDown = max(-toDown, 0.0) / max(d.x, 0.0001);
  let inUp = max(fromUp, 0.0) / max(u.x, 0.0001);
  let bleedRight = bleedGate(c, r);
  let bleedLeft = bleedGate(c, l);
  let bleedDown = bleedGate(c, d);
  let bleedUp = bleedGate(c, u);
  // At most a fifth by each face and the brush's bleed by each again: a
  // cell never gives away more than it has, so none is made or lost.
  let leaving = min(
    outRight + outLeft + outDown + outUp + bleedRight + bleedLeft + bleedDown + bleedUp,
    1.0
  );
  var s = textureLoad(suspended, texel, 0) * (1.0 - leaving);
  s = addPaint(s, wetCell(wetSlots, suspended, right) * (inRight + bleedRight));
  s = addPaint(s, wetCell(wetSlots, suspended, left) * (inLeft + bleedLeft));
  s = addPaint(s, wetCell(wetSlots, suspended, down) * (inDown + bleedDown));
  s = addPaint(s, wetCell(wetSlots, suspended, up) * (inUp + bleedUp));

  // The paper takes pigment slowly while water stands on it, faster in its
  // valleys than on its peaks by the brush's granulation, and all of it once
  // the water has gone; a little lifts back while it is under water.
  let p = textureLoad(deposited, texel, 0);
  let settling = DEPOSIT * max(1.0 + sim.granulation * (1.0 - 2.0 * height), 0.0);
  let taken = s * clamp(settling + 1.0 - smoothstep(0.0, 0.05, w), 0.0, 1.0);
  let lifted = p * (LIFT * smoothstep(0.0, 0.25, w));

  textureStore(waterOut, texel, vec4<f32>(w, dampness, toRight, toDown));
  textureStore(suspendedOut, texel, addPaint(s - taken, lifted));
  textureStore(depositedOut, texel, addPaint(p - lifted, taken));
}

@compute @workgroup_size(8, 8, 1)
fn pourMain(@builtin(global_invocation_id) id: vec3<u32>) {
  if (sim.tiles[id.z].z == 0) { return; }
  let texel = slotTexel(id.z, id.xy);
  let c = textureLoad(water, texel, 0);
  let laid = textureLoad(laidWater, texel, 0);
  textureStore(
    waterOut,
    texel,
    vec4<f32>(min(MAX_WATER, c.x + laid.x), max(c.y, min(1.0, laid.y)), c.zw)
  );
  textureStore(
    suspendedOut,
    texel,
    addPaint(textureLoad(suspended, texel, 0), textureLoad(laidPigment, texel, 0))
  );
  textureStore(depositedOut, texel, textureLoad(deposited, texel, 0));
}
`,
  { pigment: pigmentShader, wet }
)
