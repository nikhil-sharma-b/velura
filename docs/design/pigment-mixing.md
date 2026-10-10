# Pigment mixing (live brushes 11)

## Model and provenance

Velura implements an equal-scattering, opaque Kubelka–Munk approximation independently in `engine/shaders/pigment.ts`. For each reflectance band, `K/S = (1-R)²/(2R)`; mixing combines K/S by concentration, and the inverse is evaluated as `R = 1/(1 + K/S + sqrt((K/S)² + 2K/S))` to avoid cancellation. The [Kubelka–Munk pigment study](https://www.jstage.jst.go.jp/article/photogrst1964/45/2/45_2_98/_article/-char/en) describes calculating pigment mixtures from absorption and scattering. [Smits's RGB-to-reflectance paper](https://doi.org/10.1080/10867651.1999.10487511) establishes why RGB-authored material needs a representative reflectance spectrum.

The eight synthetic pigments are white, black, cyan, magenta, yellow, red, green and blue. Removing the minimum RGB component gives white; minima of the remaining pairs give the secondaries, and the remainder gives the primaries. Black completes the concentration sum to one. Six broad bands run from violet to red. Their coefficients and the simple paired-band observer were authored for Velura; they are not copied spectra, colour matching functions, a downloaded lookup table or measured pigment data. Blue and yellow have overlapping green reflectance, which survives the subtractive mix.

An RGB colour does not identify a unique physical pigment. The reconstructed endpoint's error is carried as a residual in linear Display P3. Residuals mix by the same concentration share and are added back after decoding reflectance. Thus endpoints and identical paints retain their colour, and a wide-gamut input never passes through clipped sRGB. The reflectance decomposition bounds only its synthetic pigment component; residuals retain signed and extended working-space values. No clamp is applied to the resulting working colour. This approximation can yield signed channels; presentation retains its existing gamut clipping. It is an artistic model, not a prediction of named real-world paints, and repeatedly mixed RGB pixels do not retain physical pigment history.

The [Mixbox public licence](https://github.com/scrtwpns/mixbox/blob/master/LICENSE) is CC BY-NC 4.0, allowing noncommercial use; commercial use needs separate terms. No Mixbox code, coefficients, lookup texture or dependency is used here. This is a provenance decision for this implementation, not a general legal opinion or a patent clearance claim.

## Quantity and integration

Alpha remains a linear interpolation of paint quantity. The over paint's concentration share is `amount * over.alpha / mixed.alpha`, not merely `amount`. Either empty input bypasses the pigment model, so transparency only thins. Identical unpremultiplied colours and amounts zero or one also return the existing linear result exactly.

The shared `mixPaint` serves wet deposition, reservoir pickup, flow-zero blenders and smudge. It is always on, with no brush schema or editor choice. Masks continue to mix coverage in alpha; dry strokes and the eraser retain their existing rendering. The shader adds bounded arithmetic and six square roots, with no per-dab allocations, readbacks or bindings. Analytic evaluation avoids a LUT's storage, interpolation error and gamut bounds.

## Validation and golden changes

The existing engine-command seam checks that both wet and smudge strokes go through green, and that a wet brush mixing its own colour retains it. By explicit user agreement for this ticket, a small GPU probe also exercises the shipped mix with raw P3 colours, unequal opacity, empty paint, endpoints and symmetry. This is an additional seam beyond the original live-brush PRD's tests; it does not expose reservoir internals.

The wet-stroke and reservoir-stroke golden images are deliberately regenerated for subtractive mixing. New brush-pigment-transition and smudge-pigment-transition goldens pin the blue/yellow transition on Darwin and Linux. A changed colour is expected; stroke geometry and history behavior must continue to pass their existing specs. Benchmark results are recorded in `benchmark.md`.
