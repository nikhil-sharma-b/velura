/**
 * The cursor is drawn rather than imported: a data URI keeps the geometry and
 * the hotspot in one place. It is stroked twice — dark under light — so the
 * ring reads on a white canvas and on the dark matting alike.
 *
 * One dot serves every tool: it marks where the mark starts, and leaves how
 * wide it lands to the stroke itself.
 */
function dotRing(diameter: number): string {
  const size = diameter + 4
  const centre = size / 2
  const radius = diameter / 2
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none"><circle cx="${centre}" cy="${centre}" r="${radius}" stroke="#18181b" stroke-width="2.5" stroke-opacity="0.5"/><circle cx="${centre}" cy="${centre}" r="${radius}" stroke="#fff" stroke-width="1"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${centre} ${centre}, crosshair`
}

/** The CSS `cursor` value for painting on the canvas. */
export const TOOL_CURSOR = dotRing(5)

/**
 * What the canvas wears while Alt is held. The eyedropper is a modifier and
 * not a tool, so this is the only place it can announce itself: the artist
 * holding the key sees the pen become a dropper before they commit to a click.
 * The hotspot is the tip, which is the pixel that gets read.
 */
const dropper = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 18l1-4 8-8 3 3-8 8-4 1z" fill="#fff" stroke="#18181b" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 3l5 5-2 2-5-5 2-2z" fill="#18181b" stroke="#fff" stroke-width="1.25" stroke-linejoin="round"/></svg>`

export const SAMPLING_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(dropper)}") 2 18, crosshair`

const INK = "#18181b"

/** An SVG cursor of `body`, `size` square, with its hotspot at `x`, `y`. */
function svgCursor(body: string, size: number, x: number, y: number) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none" stroke-linejoin="round" stroke-linecap="round">${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${x} ${y}, crosshair`
}

/**
 * A line in ink edged with white, as Inkscape draws its cursors: strong on
 * the light paper most work is on, and still outlined over dark ink.
 */
const haloed = (d: string, width = 1.25) =>
  `<path d="${d}" stroke="#fff" stroke-width="${width + 2}"/><path d="${d}" stroke="${INK}" stroke-width="${width}"/>`

const ARROW = "M3 2v15l4-4 3 6 2.5-1.2-3-5.8H15z"

/** A thin cross, its centre the hotspot, with a badge of what it draws. */
function crossWith(badge: string) {
  return svgCursor(
    `${haloed("M8 1v5M8 10v5M1 8h5M10 8h5")}<g transform="translate(13 13)">${badge}</g>`,
    24,
    8,
    8
  )
}

/** A small filled outline for a badge: ink with a light edge. */
const badgeShape = (d: string) =>
  `<path d="${d}" fill="#fff" stroke="${INK}" stroke-width="1.25"/>`

/**
 * Each vector tool's own cursor, so the hand on the canvas says which tool
 * it holds, as Inkscape's do: arrows for picking, the nib for the pen, a
 * cross badged with its shape for each shape tool. Each hotspot is where
 * the tool acts.
 */
export const VECTOR_CURSORS = {
  objectSelect: svgCursor(
    `<path d="${ARROW}" fill="${INK}" stroke="#fff" stroke-width="1.25"/>`,
    20,
    3,
    2
  ),
  node: svgCursor(
    `<path d="${ARROW}" fill="#fff" stroke="${INK}" stroke-width="1.25"/><rect x="13.5" y="13.5" width="5" height="5" fill="${INK}" stroke="#fff" stroke-width="1"/>`,
    20,
    3,
    2
  ),
  // A fountain-pen nib held from below, as Figma's: the tip up to the left
  // where an arrow's would be, where the anchor lands. Ink edged white like
  // the arrows, its slit and breather hole cut through. The nib is drawn
  // tip down at the origin; scaled, turned and moved, its tip lands on 2, 2.
  pen: svgCursor(
    `<g transform="translate(9.69 9.69) rotate(135) scale(1.45)"><path d="M0 7.5L-3.6 0.5V-2.5L-1.8-6.5H1.8L3.6-2.5V0.5Z" fill="${INK}" stroke="#fff" stroke-width="0.9"/><path d="M0 6.6V0" stroke="#fff" stroke-width="0.7"/><circle cx="0" cy="-1" r="0.85" fill="#fff"/></g>`,
    20,
    2,
    2
  ),
  // A dot where the stroke starts, in ink edged white: bolder than paint's
  // light ring, so a path being drawn is told from paint being laid.
  pressure: svgCursor(
    `<circle cx="6" cy="6" r="3" stroke="#fff" stroke-width="3.5"/><circle cx="6" cy="6" r="3" stroke="${INK}" stroke-width="1.5"/>`,
    12,
    6,
    6
  ),
  rectangle: crossWith(badgeShape("M0.5 0.5h8v6h-8z")),
  ellipse: crossWith(
    `<ellipse cx="4.5" cy="3.5" rx="4" ry="3" fill="#fff" stroke="${INK}" stroke-width="1.25"/>`
  ),
  line: crossWith(haloed("M0.5 7.5l8-7", 1.25)),
  polygon: crossWith(badgeShape("M4.5 0.5l4 3-1.5 4.5h-5L0.5 3.5z")),
} as const
