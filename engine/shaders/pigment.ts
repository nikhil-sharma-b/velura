/**
 * Velura's synthetic six-band, equal-scattering Kubelka–Munk model.
 * Coefficients are authored here, not measured pigments or Mixbox data.
 * See docs/design/pigment-mixing.md for the approximation and provenance.
 */
export const pigmentShader = /* wgsl */ `
struct Reflectance {
  short: vec3<f32>, // violet, cyan, green
  long: vec3<f32>, // yellow, orange, red
}

// Decompose bounded linear P3 into white, secondary and primary pigment
// concentrations. Their sum is at most one; the remainder is black.
fn paintReflectance(rgb: vec3<f32>) -> Reflectance {
  let c = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));
  let white = min(c.r, min(c.g, c.b));
  let rest = c - white;
  let cyan = min(rest.g, rest.b);
  let magenta = min(rest.r, rest.b);
  let yellow = min(rest.r, rest.g);
  let red = rest.r - magenta - yellow;
  let green = rest.g - cyan - yellow;
  let blue = rest.b - cyan - magenta;
  let black = 1.0 - white - cyan - magenta - yellow - red - green - blue;
  var out: Reflectance;
  out.short = vec3<f32>(white + 0.02 * black)
    + cyan * vec3<f32>(0.80, 0.90, 0.90)
    + magenta * vec3<f32>(0.85, 0.25, 0.04)
    + yellow * vec3<f32>(0.02, 0.08, 0.70)
    + red * vec3<f32>(0.02, 0.02, 0.04)
    + green * vec3<f32>(0.02, 0.25, 0.90)
    + blue * vec3<f32>(0.80, 0.55, 0.40);
  out.long = vec3<f32>(white + 0.02 * black)
    + cyan * vec3<f32>(0.60, 0.04, 0.02)
    + magenta * vec3<f32>(0.04, 0.60, 0.90)
    + yellow * vec3<f32>(0.90, 0.90, 0.85)
    + red * vec3<f32>(0.15, 0.80, 0.90)
    + green * vec3<f32>(0.65, 0.08, 0.02)
    + blue * vec3<f32>(0.20, 0.02, 0.02);
  return out;
}

fn reflectanceRGB(r: Reflectance) -> vec3<f32> {
  return vec3<f32>(r.long.y + r.long.z, r.short.z + r.long.x,
    r.short.x + r.short.y) * 0.5;
}

fn absorption(r: vec3<f32>) -> vec3<f32> {
  let safe = max(r, vec3<f32>(0.0001));
  return (1.0 - safe) * (1.0 - safe) / (2.0 * safe);
}

fn mixReflectance(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> {
  let ks = mix(absorption(a), absorption(b), t);
  // Rationalised inverse: avoids cancellation for very absorbing paint.
  return 1.0 / (1.0 + ks + sqrt(ks * ks + 2.0 * ks));
}

// Alpha is paint quantity, never a pigment. Mix concentrations by the
// contributing alpha, then premultiply again. Empty paint only thins colour.
fn mixPaint(under: vec4<f32>, over: vec4<f32>, amount: f32) -> vec4<f32> {
  let linear = mix(under, over, amount);
  if (amount <= 0.0 || amount >= 1.0 || under.a <= 0.0 || over.a <= 0.0) {
    return linear;
  }
  let a = under.rgb / under.a;
  let b = over.rgb / over.a;
  if (all(abs(a - b) < vec3<f32>(0.00001))) { return linear; }
  let t = amount * over.a / linear.a;
  let ar = paintReflectance(a);
  let br = paintReflectance(b);
  var mixed: Reflectance;
  mixed.short = mixReflectance(ar.short, br.short, t);
  mixed.long = mixReflectance(ar.long, br.long, t);
  // An RGB colour does not uniquely describe a spectrum. Preserve the
  // reconstruction residual in working P3, including out-of-sRGB colours.
  // There is deliberately no clamp or sRGB conversion on the result.
  let residual = mix(a - reflectanceRGB(ar), b - reflectanceRGB(br), t);
  return vec4<f32>((reflectanceRGB(mixed) + residual) * linear.a, linear.a);
}
`
