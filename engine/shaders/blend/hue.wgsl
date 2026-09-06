#include "non-separable"

fn blendColour(backdrop: vec3<f32>, source: vec3<f32>) -> vec3<f32> {
  return setLuminosity(setSaturation(source, saturation(backdrop)), luminosity(backdrop));
}
