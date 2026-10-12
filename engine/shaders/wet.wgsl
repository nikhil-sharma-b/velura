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

// A wet field at a document point, filtered between cells. Neighbours are
// found a cell at a time, so a tile's border is filtered across like any other.
fn wetField(slots: texture_2d<u32>, field: texture_2d<f32>, point: vec2<f32>) -> vec4<f32> {
  let cellPoint = point * (f32(WET_CELLS) / 256.0) - 0.5;
  let corner = floor(cellPoint);
  let f = cellPoint - corner;
  let cell = vec2<i32>(corner);
  return mix(
    mix(wetCell(slots, field, cell), wetCell(slots, field, cell + vec2<i32>(1, 0)), f.x),
    mix(wetCell(slots, field, cell + vec2<i32>(0, 1)), wetCell(slots, field, cell + vec2<i32>(1, 1)), f.x),
    f.y
  );
}

// Paint of some density over what is beneath it: a transparent film. Alpha in
// `paint` is pigment density, not coverage, and its colour is premultiplied
// by it.
fn glaze(under: vec4<f32>, paint: vec4<f32>) -> vec4<f32> {
  if (paint.a <= 0.00001) { return under; }
  let amount = 1.0 - exp(-paint.a);
  return mixPaint(under, vec4<f32>(paint.rgb / paint.a, 1.0), amount);
}

// A layer's pixel with whatever is wet over that document point glazed onto
// it: the pigment the paper has taken first, and what is still in the water
// over it.
fn glazeWet(
  under: vec4<f32>,
  slots: texture_2d<u32>,
  deposited: texture_2d<f32>,
  suspended: texture_2d<f32>,
  point: vec2<f32>
) -> vec4<f32> {
  return glaze(
    glaze(under, wetField(slots, deposited, point)),
    wetField(slots, suspended, point)
  );
}
