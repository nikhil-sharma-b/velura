/** Short material cues for choosing a tool before making a mark. */
const descriptions: Record<string, string> = {
  "builtin:pencil": "Fine graphite · press to darken, tilt to shade",
  "builtin:charcoal": "Grainy shading · soft edges, layered tone",
  "builtin:ink": "Crisp ink · pressure controls line width",
  "builtin:round": "Soft paint · press for a fuller stroke",
  "builtin:airbrush": "Soft spray · overlapping passes build tone",
  "builtin:marker": "Chisel tip · broad strokes and narrow edges",
  "builtin:oil-round": "Wet paint · press to cover, ease off to blend",
  "builtin:oil-flat": "Wet bristles · broad strokes that turn with the hand",
  "builtin:blender": "No paint · softens and drags what is there",
  "builtin:dry-bristle": "Nearly dry · streaks colours into each other",
}

export function brushDescription(id: string): string {
  return descriptions[id] ?? "Your custom brush"
}
