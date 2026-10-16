import { WET_CELL_SIZE, WET_SLOTS } from "../gpu/wet-tiles"
import { hslShader } from "./hsl"
import { pigmentShader } from "./pigment"
import { preprocess } from "./preprocess"
import wet from "./wet.wgsl"

/**
 * The most water a cell holds, which is the depth a brush at full `water`
 * fills it to; a brush at less fills it to that share of this.
 */
export const FLUID_MAX_WATER = 2

/**
 * The water the paper holds: only beside water standing deeper than this
 * does dampness advance into dry paper, which is a bloom.
 */
export const FLUID_HOLDS = 1.2

/**
 * How much water the paper's relief is worth, from its deepest valley to its
 * highest peak: water sits a little deeper in the valleys.
 */
export const FLUID_RELIEF = 0.03

/** Steps for damp paper to dry out once its water has gone. */
export const FLUID_DAMP_STEPS = 50

/**
 * What a slot's tile entry says in z of a slot held while drying is paused
 * (fluid brushes 18): a step passes it by, and a pour or a blot does not.
 */
export const FLUID_SLOT_HELD = 2

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
 *
 * It is the brush's own dab (fluid brushes 10): turned and squashed, its
 * shape the tip's where the brush has one, and its ink shifted by the dab's
 * colour offsets, as the stamp pass draws a dry one.
 */
export const fluidDabShader = /* wgsl */ `
${hslShader}

const TAU = 6.283185307179586;

struct Fluid {
  // Premultiplied linear ink.
  ink: vec4<f32>,
  // The field textures' size in cells.
  fieldSize: vec2<f32>,
  // Rim falloff and the brush's water, the first in cells.
  feather: f32,
  water: f32,
  // One when the tip texture is the dab's shape, zero for the disc.
  useTip: f32,
}

@group(0) @binding(0) var<uniform> fluid: Fluid;
@group(0) @binding(1) var tipSampler: sampler;
@group(0) @binding(2) var tipTexture: texture_2d_array<f32>;

struct Instance {
  // The dab's centre and radius in cells of the field texture.
  @location(0) center: vec2<f32>,
  @location(1) radius: f32,
  @location(2) load: f32,
  // The slot's first cell, and the one past its last.
  @location(3) slot: vec4<f32>,
  // Rotation of the tip, as a turn clockwise, and its width against its
  // length.
  @location(4) angle: f32,
  @location(5) roundness: f32,
  // The share of the brush's water this dab carries.
  @location(6) water: f32,
  @location(7) tipFrame: f32,
  @location(8) colorOffsets: vec3<f32>,
}

struct Varyings {
  @builtin(position) position: vec4<f32>,
  @location(0) @interpolate(flat) center: vec2<f32>,
  @location(1) @interpolate(flat) radius: f32,
  @location(2) @interpolate(flat) load: f32,
  @location(3) @interpolate(flat) slot: vec4<f32>,
  // The cosine and sine of the dab's turn.
  @location(4) @interpolate(flat) turn: vec2<f32>,
  @location(5) @interpolate(flat) roundness: f32,
  @location(6) @interpolate(flat) water: f32,
  @location(7) @interpolate(flat) tipFrame: i32,
  @location(8) @interpolate(flat) ink: vec4<f32>,
}

@vertex
fn vertexMain(instance: Instance, @builtin(vertex_index) index: u32) -> Varyings {
  let corner = vec2<f32>(f32(index & 1u), f32((index >> 1u) & 1u)) * 2.0 - 1.0;
  // A turned tip's corners carry ink past the radius. And a cell past the
  // rim, so one the rim only grazes is still drawn.
  let reach = instance.radius * mix(1.0, sqrt(2.0), fluid.useTip) + 1.0;
  let cell = instance.center + corner * reach;
  var out: Varyings;
  out.position = vec4<f32>(
    cell.x / fluid.fieldSize.x * 2.0 - 1.0,
    1.0 - cell.y / fluid.fieldSize.y * 2.0,
    0.0,
    1.0
  );
  out.center = instance.center;
  out.radius = instance.radius;
  out.load = instance.load;
  out.slot = instance.slot;
  out.turn = vec2<f32>(cos(instance.angle * TAU), sin(instance.angle * TAU));
  out.roundness = instance.roundness;
  out.water = instance.water;
  out.tipFrame = i32(instance.tipFrame);
  out.ink = fluid.ink;
  // As the stamp pass: a dab with no offsets lays the ink untouched.
  if (any(instance.colorOffsets != vec3<f32>(0.0)) && fluid.ink.a > 0.0) {
    out.ink = vec4<f32>(adjustHsl(fluid.ink.rgb / fluid.ink.a, instance.colorOffsets) * fluid.ink.a, fluid.ink.a);
  }
  return out;
}

struct Fields {
  @location(0) water: vec4<f32>,
  @location(1) pigment: vec4<f32>,
}

// How much of a cell the dab covers, from none past its rim to one inside it.
fn dabShape(varyings: Varyings) -> f32 {
  let cell = varyings.position.xy;
  // Where the cell lies in the dab, in cells: turned back, and stretched
  // across the tip's length so its squashed rim is a circle's again.
  let offset = cell - varyings.center;
  let across = vec2<f32>(
    offset.x * varyings.turn.x + offset.y * varyings.turn.y,
    (offset.y * varyings.turn.x - offset.x * varyings.turn.y) / varyings.roundness
  );
  // The disc's rim is no narrower than a cell along the tip's length, which
  // is as fine as a field can hold an edge; across it, it is squashed as
  // the dab is.
  let feather = max(fluid.feather, 1.0);
  var shape = 1.0 - smoothstep(varyings.radius - feather, varyings.radius, length(across));
  if (fluid.useTip > 0.0) {
    // A tip replaces the disc, as on a dry dab: read in stamp space, where
    // the rim is at length one, and nothing past its square.
    let local = across / varyings.radius;
    let within = all(abs(local) <= vec2<f32>(1.0));
    shape = select(
      0.0,
      textureSampleLevel(tipTexture, tipSampler, local * 0.5 + 0.5, varyings.tipFrame, 0.0).r,
      within
    );
  }
  return shape;
}

@fragment
fn fragmentMain(varyings: Varyings) -> Fields {
  let cell = varyings.position.xy;
  if (any(cell < varyings.slot.xy) || any(cell >= varyings.slot.zw)) { discard; }
  let shape = dabShape(varyings);
  var out: Fields;
  // One dab lays the whole depth the brush fills a cell to, so a single tap
  // of a flooded brush floods (fluid brushes 12). It leaves the paper damp
  // well out to its rim, where it lays little water: dampness is what lets
  // water move there at all. In alpha, the share of the brush's water the
  // dab carries: the deepest of a batch's dabs at a cell is kept, and the
  // pour fills the cell no deeper.
  out.water = vec4<f32>(
    fluid.water * varyings.water * shape * ${FLUID_MAX_WATER.toFixed(1)},
    4.0 * shape,
    0.0,
    select(0.0, varyings.water, shape > 0.0)
  );
  // Density is the pigment's alpha, and its colour is premultiplied by it.
  out.pigment = varyings.ink * (varyings.load * shape);
  return out;
}

// A blot brush's dab (fluid brushes 17) lays nothing: in every channel of
// the pigment target it gives how strongly it takes at the cell, which the
// target's blend multiplies into what the batch's other dabs leave, so the
// batch keeps the product and not the sum. Nothing goes into the water one.
@fragment
fn blotFragment(varyings: Varyings) -> Fields {
  let cell = varyings.position.xy;
  if (any(cell < varyings.slot.xy) || any(cell >= varyings.slot.zw)) { discard; }
  var out: Fields;
  out.water = vec4<f32>(0.0);
  out.pigment = vec4<f32>(clamp(varyings.load * dabShape(varyings), 0.0, 1.0));
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
@group(0) @binding(5) var selection: texture_2d<f32>;

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
    selection,
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
 * what a batch of dabs laid into the fields, water up to the depth the brush
 * carries. Both read the selection: the pour lays only what it covers, and
 * the step lets nothing cross what it does not.
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
  // The depth of water the brush fills a cell to at a dab's full share, and
  // no deeper.
  level: f32,
  // A blot brush's: the share of water and dampness, and of suspended
  // pigment, it takes where it lands at full strength.
  blotWater: f32,
  blotPigment: f32,
  // The board the paper lies on (fluid brushes 38): in x how much lower the
  // paper is a cell further downhill, in depth of water, zero on a flat
  // board; in yz which way is down, a unit vector in cells.
  fall: vec4<f32>,
  // Each slot's tile in xy, and in z whether one holds it: 0 for none, 1,
  // or HELD for one held while drying is paused.
  tiles: array<vec4<i32>, ${WET_SLOTS}>,
}

// How fast water levels: the share of a height difference that crosses a
// face in a step.
const FLOW: f32 = 0.2;
const HELD: i32 = ${FLUID_SLOT_HELD};
// No cell gives more than this share of its water across one face in a step.
const FACE_SHARE: f32 = 0.2;
// The most water a cell holds.
const MAX_WATER: f32 = ${FLUID_MAX_WATER.toFixed(1)};
// The water the paper holds. Beside water standing deeper than this, and
// wholly so a little deeper still, dampness advances into dry paper.
const HOLDS: f32 = ${FLUID_HOLDS.toFixed(2)};
const SPILL: f32 = 0.4;
// The share of a damper neighbour's dampness dry paper takes up in a step,
// where that neighbour's water spills.
const ABSORB: f32 = 0.1;
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
const RELIEF: f32 = ${FLUID_RELIEF.toFixed(2)};
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
@group(0) @binding(11) var selection: texture_2d<f32>;
@group(0) @binding(12) var selectionSampler: sampler;
// One face mask per slot. The driver claims these tiles between steps.
@group(0) @binding(13) var<storage, read_write> runEdges: array<atomic<u32>, ${WET_SLOTS}>;

fn pressEdge(slot: u32, neighbour: vec2<i32>, open: f32, along: f32, bit: u32) {
  if (along <= 0.0 || open <= 0.0) { return; }
  let size = vec2<i32>(textureDimensions(wetSlots));
  if (any(neighbour < vec2<i32>(0)) || any(neighbour >= size)) { return; }
  if (textureLoad(wetSlots, neighbour, 0).r == 0u) {
    atomicOr(&runEdges[slot], bit);
  }
}

// Where a slot's cell is in a field texture.
fn slotTexel(slot: u32, cell: vec2<u32>) -> vec2<i32> {
  let at = i32(slot);
  return vec2<i32>(at % WET_FIELD_COLUMNS, at / WET_FIELD_COLUMNS) * WET_CELLS + vec2<i32>(cell);
}

// The paper's height under a cell, read at one document pixel of it.
fn cellPaper(cell: vec2<i32>) -> f32 {
  return paperHeight(paper, cell * CELL_SIZE + CELL_SIZE / 2);
}

// How much of a cell the selection covers (fluid brushes 09): the mean over
// the document pixels of it, which is what a filtered read at its middle
// gives, and all of it while nothing is selected. Paper the selection does
// not cover is masked: the pour lays nothing on it and nothing crosses it.
fn selected(cell: vec2<i32>) -> f32 {
  let middle = vec2<f32>(cell * CELL_SIZE + CELL_SIZE / 2);
  return textureSampleLevel(
    selection,
    selectionSampler,
    middle / vec2<f32>(textureDimensions(selection)),
    0.0
  ).r;
}

// Water crossing the face from a to b in a step. It follows the difference
// in the height of the water's surface, which is the water's depth and a
// little of the paper's relief under it, and moves only between two cells of
// damp paper, which is what keeps the edge of a wash where the brush put it,
// and only as far as the selection leaves the face between them open. Both
// cells work the same number out for the face they share, so none is made or
// lost.
//
// On a tilted board (fluid brushes 38) the paper under b also lies lower
// than under a, by the board's drop over a cell times how near down lies to
// the face's direction from a to b, which is along. So water levels to a
// surface tilted as the board is: a wash slopes, deeper downhill, within the
// paper it has wet. A flat board skips it, and paints as it always has.
fn faceFlow(a: vec4<f32>, b: vec4<f32>, paperA: f32, paperB: f32, open: f32, along: f32) -> f32 {
  let damp = open * smoothstep(0.02, 0.3, min(a.y, b.y));
  var fall = a.x - b.x + RELIEF * (paperA - paperB);
  if (sim.fall.x > 0.0) { fall += sim.fall.x * along; }
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

// The dampness a cell's paper takes up from a neighbour's in a step: none
// unless the neighbour is damper and its water stands deeper than the paper
// holds. This is the only way the damp area grows, and it is a bloom.
fn creep(beside: vec4<f32>, own: f32) -> f32 {
  return max(beside.y - own, 0.0) * smoothstep(HOLDS, HOLDS + SPILL, beside.x);
}

// How freely pigment diffuses between two cells: both have to hold water,
// and the selection to leave the face between them open.
fn bleedGate(a: vec4<f32>, b: vec4<f32>, open: f32) -> f32 {
  return sim.bleed * open * smoothstep(0.0, 0.25, min(a.x, b.x));
}

@compute @workgroup_size(8, 8, 1)
fn stepMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let tile = sim.tiles[id.z];
  // A held slot is the same in both copies of the fields, and stays so.
  if (tile.z == 0 || tile.z == HELD) { return; }
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

  // A cell with no water on it or beside it: nothing flows, its paper dries
  // out, and it takes whatever pigment was left in it. Most of a wet tile is
  // so, and all of one in the ring about a stroke until a bloom reaches it;
  // what follows would work out the same, with nine more cells read.
  if (max(max(c.x, l.x), max(max(r.x, u.x), d.x)) <= 0.0) {
    textureStore(waterOut, texel, vec4<f32>(0.0, max(0.0, c.y - DAMP_FADE), 0.0, 0.0));
    textureStore(suspendedOut, texel, vec4<f32>(0.0));
    textureStore(
      depositedOut,
      texel,
      addPaint(textureLoad(deposited, texel, 0), textureLoad(suspended, texel, 0))
    );
    return;
  }

  // Water levels, then evaporates, faster near the edge of the damp area:
  // the water that flows out to replace it is what darkens a wash's rim.
  let height = cellPaper(cell);
  let relief = vec4<f32>(cellPaper(right), cellPaper(left), cellPaper(down), cellPaper(up));
  // The selection is in every gate: how open each face is to what crosses
  // it is the coverage of the cells either side, multiplied.
  let open = selected(cell)
    * vec4<f32>(selected(right), selected(left), selected(down), selected(up));
  // Flat paint never reports edges. A run presses only downhill faces of
  // its body's tile boundary, not the ring a dab would take for a bloom.
  if (sim.fall.x > 0.0 && c.x > HOLDS) {
    if (id.x == u32(WET_CELLS - 1)) { pressEdge(id.z, tile.xy + vec2<i32>(1, 0), open.x, sim.fall.y, 1u); }
    if (id.x == 0u) { pressEdge(id.z, tile.xy + vec2<i32>(-1, 0), open.y, -sim.fall.y, 2u); }
    if (id.y == u32(WET_CELLS - 1)) { pressEdge(id.z, tile.xy + vec2<i32>(0, 1), open.z, sim.fall.z, 4u); }
    if (id.y == 0u) { pressEdge(id.z, tile.xy + vec2<i32>(0, -1), open.w, -sim.fall.z, 8u); }
  }
  let toRight = faceFlow(c, r, height, relief.x, open.x, sim.fall.y);
  let fromLeft = faceFlow(l, c, relief.y, height, open.y, sim.fall.y);
  let toDown = faceFlow(c, d, height, relief.z, open.z, sim.fall.z);
  let fromUp = faceFlow(u, c, relief.w, height, open.w, sim.fall.z);
  let level = c.x - toRight + fromLeft - toDown + fromUp;
  // Only a cell with water to lose looks for the edge: most of a wet tile
  // has none, and the looking is eight more cells read.
  var lost = sim.evaporation;
  if (level > 0.0 && sim.edge > 0.0) { lost *= 1.0 + sim.edge * edgeNearness(cell, c.y); }
  let w = clamp(level - lost, 0.0, MAX_WATER);
  // Paper under water is damp, and dries out once the water has gone. Dry
  // paper beside water it cannot hold back is made damp by it.
  let soaked = c.y + ABSORB * dot(
    open,
    vec4<f32>(creep(r, c.y), creep(l, c.y), creep(d, c.y), creep(u, c.y))
  );
  let dampness = select(max(0.0, soaked - DAMP_FADE), min(1.0, soaked + 0.2), w > 0.001);

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
  let bleedRight = bleedGate(c, r, open.x);
  let bleedLeft = bleedGate(c, l, open.y);
  let bleedDown = bleedGate(c, d, open.z);
  let bleedUp = bleedGate(c, u, open.w);
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
  let tile = sim.tiles[id.z];
  if (tile.z == 0) { return; }
  let texel = slotTexel(id.z, id.xy);
  let c = textureLoad(water, texel, 0);
  // The selection clips what a dab lays, water, dampness and pigment alike:
  // a cell takes the share of each that the selection covers of it.
  let share = selected(tile.xy * WET_CELLS + vec2<i32>(id.xy));
  let batch = textureLoad(laidWater, texel, 0);
  let laid = batch * share;
  textureStore(
    waterOut,
    texel,
    // The brush fills a cell to the depth of water its dabs there carry,
    // however many of them overlap, and takes none from a cell that stands
    // deeper. A dab carries the brush's own water or a share of it.
    vec4<f32>(
      max(c.x, min(c.x + laid.x, sim.level * batch.a * MAX_WATER * share)),
      max(c.y, min(1.0, laid.y)),
      c.zw
    )
  );
  textureStore(
    suspendedOut,
    texel,
    addPaint(textureLoad(suspended, texel, 0), textureLoad(laidPigment, texel, 0) * share)
  );
  textureStore(depositedOut, texel, textureLoad(deposited, texel, 0));
}

// What a batch of blot dabs takes out of the fields (fluid brushes 17): the
// pigment target holds in alpha the share of each cell the batch leaves, so
// one less that is how strongly it takes there, clipped by the selection as
// the pour is. Standing water and dampness go by the same share, so a cell
// blotted dry stops moving, and so does the pigment suspended in it. The
// pigment the paper has taken is left alone: the step lifts a little back
// while water stands on it.
@compute @workgroup_size(8, 8, 1)
fn blotMain(@builtin(global_invocation_id) id: vec3<u32>) {
  let tile = sim.tiles[id.z];
  if (tile.z == 0) { return; }
  let texel = slotTexel(id.z, id.xy);
  let c = textureLoad(water, texel, 0);
  let share = selected(tile.xy * WET_CELLS + vec2<i32>(id.xy));
  let strength = (1.0 - textureLoad(laidPigment, texel, 0).a) * share;
  let kept = 1.0 - sim.blotWater * strength;
  textureStore(waterOut, texel, vec4<f32>(c.xy * kept, c.zw));
  textureStore(
    suspendedOut,
    texel,
    textureLoad(suspended, texel, 0) * (1.0 - sim.blotPigment * strength)
  );
  textureStore(depositedOut, texel, textureLoad(deposited, texel, 0));
}
`,
  { pigment: pigmentShader, wet }
)
