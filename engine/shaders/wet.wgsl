// Wet paint as the layer shows it (D42). The wet surface is sparse: a wet
// tile holds a slot in the field textures, at half the document's
// resolution, and `slots` names each tile's. The screen and settle both call
// `glazeWet`, which is the whole of the rule that nothing changes at the
// moment paint dries. Needs the pigment mix included before it.

// Cells along one side of a wet tile, and slots along one side of a field.
const WET_CELLS: i32 = 128;
const WET_FIELD_COLUMNS: i32 = 8;

// One cell of a wet field, by its document-wide cell coordinate. A cell in a
// tile with no slot is dry paper.
fn wetCell(slots: texture_2d<u32>, field: texture_2d<f32>, cell: vec2<i32>) -> vec4<f32> {
  if (any(cell < vec2<i32>(0))) { return vec4<f32>(0.0); }
  let tile = cell / WET_CELLS;
  if (any(tile >= vec2<i32>(textureDimensions(slots)))) { return vec4<f32>(0.0); }
  let slot = i32(textureLoad(slots, tile, 0).r) - 1;
  if (slot < 0) { return vec4<f32>(0.0); }
  let origin = vec2<i32>(slot % WET_FIELD_COLUMNS, slot / WET_FIELD_COLUMNS) * WET_CELLS;
  return textureLoad(field, origin + cell - tile * WET_CELLS, 0);
}

// How much more of the pigment it has taken the paper shows in its deepest
// valley, and how much less on its highest peak. The fields hold a cell to
// two document pixels, coarser than the paper's grain, so the grain is put
// back here, at the document's resolution.
const PAPER_GRAIN: f32 = 0.15;

// The paper's height at a document pixel, from none in its deepest valley to
// one on its highest peak. It is one paper, tiled across the document.
fn paperHeight(paper: texture_2d<f32>, pixel: vec2<i32>) -> f32 {
  return textureLoad(paper, pixel & (vec2<i32>(textureDimensions(paper)) - 1), 0).r;
}

// Paint of some density over what is beneath it: a transparent film. Alpha in
// `paint` is pigment density, not coverage, and its colour is premultiplied
// by it.
fn glaze(under: vec4<f32>, paint: vec4<f32>) -> vec4<f32> {
  if (paint.a <= 0.00001) { return under; }
  let amount = 1.0 - exp(-paint.a);
  return mixPaint(under, vec4<f32>(paint.rgb / paint.a, 1.0), amount);
}

// Whether the selection leaves a document pixel out altogether. `selection`
// is its coverage, a texel a document pixel, or a single texel of full
// coverage while nothing is selected: every pixel reads that one.
fn selectedOut(selection: texture_2d<f32>, pixel: vec2<i32>) -> bool {
  let last = vec2<i32>(textureDimensions(selection)) - 1;
  return textureLoad(selection, clamp(pixel, vec2<i32>(0), last), 0).r <= 0.0;
}

// A layer's pixel with whatever is wet over that document point glazed onto
// it: the pigment the paper has taken first, more of it showing in the
// paper's valleys, and what is still in the water over it. A pixel the
// selection leaves out shows none: what cells show is filtered between them, and
// a cell is wider than a pixel, so paint held in by the selection's edge
// would otherwise show a pixel past it.
fn glazeWet(
  under: vec4<f32>,
  slots: texture_2d<u32>,
  deposited: texture_2d<f32>,
  suspended: texture_2d<f32>,
  paper: texture_2d<f32>,
  selection: texture_2d<f32>,
  point: vec2<f32>
) -> vec4<f32> {
  if (selectedOut(selection, vec2<i32>(floor(point)))) { return under; }
  let height = paperHeight(paper, vec2<i32>(floor(point)));
  let grain = 1.0 + PAPER_GRAIN * (1.0 - 2.0 * height);
  // Filtered between cells in what each cell shows, not in its density
  // (fluid brushes 30): the glaze saturates, so half a dense cell's density
  // is nearly as dark as all of it, and a filter in density would leave the
  // edge of a wash a hard step on the cell grid.
  let cellPoint = point * (f32(WET_CELLS) / 256.0) - 0.5;
  let corner = floor(cellPoint);
  let f = cellPoint - corner;
  let cell = vec2<i32>(corner);
  return mix(
    mix(
      glazeCell(under, slots, deposited, suspended, grain, cell),
      glazeCell(under, slots, deposited, suspended, grain, cell + vec2<i32>(1, 0)),
      f.x
    ),
    mix(
      glazeCell(under, slots, deposited, suspended, grain, cell + vec2<i32>(0, 1)),
      glazeCell(under, slots, deposited, suspended, grain, cell + vec2<i32>(1, 1)),
      f.x
    ),
    f.y
  );
}

// A pixel with one cell's paint glazed onto it: the pigment the paper has
// taken, then what is still in the water over it.
fn glazeCell(
  under: vec4<f32>,
  slots: texture_2d<u32>,
  deposited: texture_2d<f32>,
  suspended: texture_2d<f32>,
  grain: f32,
  cell: vec2<i32>
) -> vec4<f32> {
  return glaze(
    glaze(under, wetCell(slots, deposited, cell) * grain),
    wetCell(slots, suspended, cell)
  );
}
