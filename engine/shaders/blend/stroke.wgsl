/** Applies a buffered paint or destination-out stroke to premultiplied pixels. */
fn applyStroke(
  painted: vec4<f32>,
  stroke: vec4<f32>,
  opacity: f32,
  erase: f32
) -> vec4<f32> {
  let inFlight = stroke * opacity;
  let paintedOver = inFlight + painted * (1.0 - inFlight.a);
  let erased = painted * (1.0 - inFlight.a);
  return mix(paintedOver, erased, erase);
}
