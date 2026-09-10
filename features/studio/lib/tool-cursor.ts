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
