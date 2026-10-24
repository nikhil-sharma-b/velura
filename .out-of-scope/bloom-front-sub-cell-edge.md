# A bloom front that follows the stroke, not the cell grid

Velura's fluid brushes give a bloom's front the cells' edge: anti-aliased,
but stepped every two document pixels along a diagonal. Making the front
follow a smooth line between cells is out of scope.

## Why this is out of scope

The wet surface is simulated at half the document's resolution (D42). A laid
edge follows the brush because the dabs also draw where they laid paint into a
coverage texture at document resolution, and the glaze trims paint to it
(fluid brushes 42). A bloom carries paint _past_ where it was laid, where no
dab drew coverage, so only the cells say where paint is.

Rebuilding the front from the fields alone was tried in 42 and cannot work:
the fields do not record where in a cell the edge is. A front between cells
would need state of its own, kept as the simulation steps:

- coverage grown with the damp area as a bloom advances, which needs a
  coverage format WebGPU can write as storage (`r8unorm` cannot) or a pass of
  its own, and still stairs unless the growth is smooth; or
- a signed distance to the damp front kept per cell, as a distance-field font
  does, read by the glaze to put the front between cells.

Either adds memory and step cost to every wet tile, inside a 2 ms clock budget
that 64 wet tiles already nearly fill (fluid brushes 13). What it buys is small:
measured on a diagonal flooded stroke at radius 12, the front strays 0.48 px
RMS and 1.13 px at worst from a straight line, against 0.25 and 0.5 for a laid
edge. And a bloom's front is rarely a straight line: it is a ragged, organic
edge, where a two-pixel stair does not read.

The fluid edge spec guards the current front instead, so it cannot get worse
without a test failing.

## Prior requests

- [Fluid brushes 44: A bloom front follows the cell grid](../.scratch/fluid-brushes/issues/44-a-bloom-front-follows-the-cell-grid.md) (closed 2026-10-18)
