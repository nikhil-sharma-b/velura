/**
 * IEEE 754 binary16 codec. Tiles are stored as raw half-float bytes (D12), so
 * this is written by hand rather than relying on a runtime `Float16Array`,
 * which is not available everywhere the engine has to run.
 */

const encodeView = new DataView(new ArrayBuffer(4))

export function encodeFloat16(value: number): number {
  encodeView.setFloat32(0, value)
  const bits = encodeView.getUint32(0)
  const sign = (bits >>> 16) & 0x8000
  const exponent = (bits >>> 23) & 0xff
  const mantissa = bits & 0x7fffff
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x0200 : 0)
  // Rebias 127 -> 15, rounding to nearest even in the shifted mantissa.
  const shifted = exponent - 112
  if (shifted >= 0x1f) return sign | 0x7c00
  if (shifted <= 0) {
    // Subnormal or underflow: shift the implicit leading one back in.
    if (shifted < -10) return sign
    const subnormal = (mantissa | 0x800000) >>> (1 - shifted + 13)
    const remainder = (mantissa | 0x800000) & ((1 << (14 - shifted)) - 1)
    const half = 1 << (13 - shifted)
    const round =
      remainder > half || (remainder === half && (subnormal & 1) === 1) ? 1 : 0
    return sign | (subnormal + round)
  }
  const truncated = mantissa >>> 13
  const remainder = mantissa & 0x1fff
  const round =
    remainder > 0x1000 || (remainder === 0x1000 && (truncated & 1) === 1)
      ? 1
      : 0
  return (sign | (shifted << 10) | truncated) + round
}

export function decodeFloat16(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exponent = (bits >>> 10) & 0x1f
  const mantissa = bits & 0x3ff
  if (exponent === 0) return sign * mantissa * 2 ** -24
  if (exponent === 0x1f)
    return mantissa ? Number.NaN : sign * Number.POSITIVE_INFINITY
  return sign * (mantissa + 1024) * 2 ** (exponent - 25)
}
