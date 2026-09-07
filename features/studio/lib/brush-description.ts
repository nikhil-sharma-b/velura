/** Short material cues for choosing a tool before making a mark. */
const descriptions: Record<string, string> = {
  "builtin:pencil": "Fine graphite · press to darken, tilt to shade",
  "builtin:charcoal": "Grainy shading · soft edges, layered tone",
  "builtin:ink": "Crisp ink · pressure controls line width",
  "builtin:round": "Soft paint · press for a fuller stroke",
  "builtin:airbrush": "Soft spray · overlapping passes build tone",
  "builtin:marker": "Chisel tip · broad strokes and narrow edges",
}

export function brushDescription(id: string): string {
  return descriptions[id] ?? "Your custom brush"
}
