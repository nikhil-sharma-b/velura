// Wet paint as the layer shows it (D42). The wet surface is sparse: a wet
// tile holds a slot in the field textures, at half the document's
// resolution, and `slots` names each tile's. The screen and settle both call
// `glazeWet`, which is the whole of the rule that nothing changes at the
// moment paint dries. Needs the pigment mix included before it.

// Cells along one side of a wet tile, slots along one side of a field, and
// document pixels along one side of a cell.
const WET_CELLS: i32 = 128;
const WET_FIELD_COLUMNS: i32 = 8;
const WET_CELL_SIZE: i32 = 2;

// Density too faint to show.
const NO_PAINT: f32 = 0.00001;

// Where a tile's slot starts, in cells of a field, or -1 for a tile with no
// slot or none at all.
fn slotCorner(slots: texture_2d<u32>, tile: vec2<i32>) -> vec2<i32> {
  if (any(tile < vec2<i32>(0)) || any(tile >= vec2<i32>(textureDimensions(slots)))) {
    return vec2<i32>(-1);
  }
  let slot = i32(textureLoad(slots, tile, 0).r) - 1;
  if (slot < 0) { return vec2<i32>(-1); }
  return vec2<i32>(slot % WET_FIELD_COLUMNS, slot / WET_FIELD_COLUMNS) * WET_CELLS;
}

// One cell of a wet field, by its document-wide cell coordinate. A cell in a
// tile with no slot is dry paper.
fn wetCell(slots: texture_2d<u32>, field: texture_2d<f32>, cell: vec2<i32>) -> vec4<f32> {
  let tile = select(cell / WET_CELLS, vec2<i32>(-1), cell < vec2<i32>(0));
  let corner = slotCorner(slots, tile);
  if (corner.x < 0) { return vec4<f32>(0.0); }
  return textureLoad(field, corner + cell - tile * WET_CELLS, 0);
}

// Where the dabs laid paint in a cell's four pixels (fluid brushes 42), from
// none to all: left and right of its top row, then of its bottom one. The
// coverage holds a texel a cell, beside the fields.
fn cellCoverage(slots: texture_2d<u32>, coverage: texture_2d<f32>, cell: vec2<i32>) -> vec4<f32> {
  let tile = select(cell / WET_CELLS, vec2<i32>(-1), cell < vec2<i32>(0));
  let corner = slotCorner(slots, tile);
  if (corner.x < 0) { return vec4<f32>(0.0); }
  return textureLoad(coverage, corner + cell - tile * WET_CELLS, 0);
}

// Where the dabs laid paint at a document pixel.
fn coverageAt(slots: texture_2d<u32>, coverage: texture_2d<f32>, pixel: vec2<i32>) -> f32 {
  let four = cellCoverage(slots, coverage, select(pixel / WET_CELL_SIZE, vec2<i32>(-1), pixel < vec2<i32>(0)));
  let at = pixel & vec2<i32>(1);
  return four[at.y * 2 + at.x];
}

// How much of a cell the dabs laid paint in: the mean of its pixels'
// coverage. A dab lays paint in the cells whose middle it covers, so paint in
// a cell under half laid has been carried there, by a bloom or a run.
fn cellLaid(slots: texture_2d<u32>, coverage: texture_2d<f32>, cell: vec2<i32>) -> f32 {
  return dot(cellCoverage(slots, coverage, cell), vec4<f32>(0.25));
}

// How much a cell holds paint, from its density: all but the faintest paint
// counts in full.
fn holdsPaint(density: f32) -> f32 {
  return 1.0 - exp(-density * 50.0);
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
  coverage: texture_2d<f32>,
  paper: texture_2d<f32>,
  selection: texture_2d<f32>,
  point: vec2<f32>
) -> vec4<f32> {
  if (selectedOut(selection, vec2<i32>(floor(point)))) { return under; }
  let height = paperHeight(paper, vec2<i32>(floor(point)));
  let grain = 1.0 + PAPER_GRAIN * (1.0 - 2.0 * height);
  // Filtered between cells in how much of each cell shows, not in its
  // density (fluid brushes 30): the glaze saturates, so half a dense cell's
  // density is nearly as dark as all of it, and a filter in density would
  // leave the edge of a wash a hard step on the cell grid. The colour is still
  // filtered in density, so each film is mixed onto the pixel once.
  //
  // Where the paint's edge is, though, is the brush's (fluid brushes 42): the
  // cells cannot say where in a cell the edge of paint lies, so the dabs keep
  // where they laid paint at the document's resolution, and the film is
  // trimmed to that. Paint a bloom or a run has carried past where it was
  // laid keeps the cells' edge (fluid brushes 44).
  let cellPoint = point / f32(WET_CELL_SIZE) - 0.5;
  let corner = floor(cellPoint);
  let f = cellPoint - corner;
  let cell = vec2<i32>(corner);
  let cells = array<vec2<i32>, 4>(cell, cell + vec2<i32>(1, 0), cell + vec2<i32>(0, 1), cell + vec2<i32>(1, 1));
  let deposited4 = array<vec4<f32>, 4>(
    wetCell(slots, deposited, cells[0]) * grain,
    wetCell(slots, deposited, cells[1]) * grain,
    wetCell(slots, deposited, cells[2]) * grain,
    wetCell(slots, deposited, cells[3]) * grain
  );
  let suspended4 = array<vec4<f32>, 4>(
    wetCell(slots, suspended, cells[0]),
    wetCell(slots, suspended, cells[1]),
    wetCell(slots, suspended, cells[2]),
    wetCell(slots, suspended, cells[3])
  );
  let weights = vec4<f32>((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  let density = vec4<f32>(
    deposited4[0].a + suspended4[0].a,
    deposited4[1].a + suspended4[1].a,
    deposited4[2].a + suspended4[2].a,
    deposited4[3].a + suspended4[3].a
  );
  let held = density > vec4<f32>(NO_PAINT);
  if (!any(held)) { return under; }
  let holds = vec4<f32>(holdsPaint(density.x), holdsPaint(density.y), holdsPaint(density.z), holdsPaint(density.w));
  let here = coverageAt(slots, coverage, vec2<i32>(floor(point)));
  // Well inside laid paint, where the pixel was laid whole and every cell
  // about it holds paint, the cells about it are counted as they hold paint
  // whether laid or not, and paint shows at least as the cells do: what was
  // laid where is not read.
  if (here >= 1.0 && all(holds > vec4<f32>(0.99))) {
    let inside = 1.0 / dot(weights, holds);
    return film(
      film(under, filteredFilm(deposited4, weights, inside, 0.0)),
      filteredFilm(suspended4, weights, inside, 0.0)
    );
  }
  let laidCells = vec4<f32>(
    cellLaid(slots, coverage, cells[0]),
    cellLaid(slots, coverage, cells[1]),
    cellLaid(slots, coverage, cells[2]),
    cellLaid(slots, coverage, cells[3])
  );
  // The filter is spread over the cells as they hold paint, and over every
  // cell paint was laid in whole. Bare paper past the brush's edge, and the
  // faint cells at its rim, count for little, so paint shows as fully up to
  // the edge as inside it; bare paper inside, where paint was laid and has
  // gone, is filtered across as it always was.
  let whole = smoothstep(vec4<f32>(0.75), vec4<f32>(1.0), laidCells);
  let counted = dot(weights, max(holds, whole));
  if (counted <= NO_PAINT) { return under; }
  let within = here / counted;
  // Paint carried past where it was laid shows as the cells do.
  let beyond = select(0.0, 1.0, any(held & (laidCells < vec4<f32>(0.5))));
  return film(
    film(under, filteredFilm(deposited4, weights, within, beyond)),
    filteredFilm(suspended4, weights, within, beyond)
  );
}

// A field's paint between four cells, as a film: in rgb its colour, filtered
// in density, and in alpha how much of it shows, filtered between what each
// cell shows. That is the larger of what they show times `within`, and,
// where `beyond` says paint has been carried past where it was laid, what
// they show as it is.
fn filteredFilm(cells: array<vec4<f32>, 4>, weights: vec4<f32>, within: f32, beyond: f32) -> vec4<f32> {
  let paint = cells[0] * weights.x + cells[1] * weights.y + cells[2] * weights.z + cells[3] * weights.w;
  if (paint.a <= NO_PAINT) { return vec4<f32>(0.0); }
  let shows = dot(weights, 1.0 - exp(-vec4<f32>(cells[0].a, cells[1].a, cells[2].a, cells[3].a)));
  let amount = max(min(1.0, shows * within), shows * beyond);
  return vec4<f32>(paint.rgb / paint.a, amount);
}

// A film over what is beneath it: its colour in rgb, and in alpha how much of
// it shows.
fn film(under: vec4<f32>, paint: vec4<f32>) -> vec4<f32> {
  if (paint.a <= 0.0) { return under; }
  return mixPaint(under, vec4<f32>(paint.rgb, 1.0), paint.a);
}
