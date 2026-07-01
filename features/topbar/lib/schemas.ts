import z from "zod"

export const pressureCurvePointSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})

export const generalFormSchema = z.object({
  toolbar: z.enum(["left", "right"]),
  appearance: z.enum(["light", "dark", "system"]),
  fileFormat: z.enum(["png", "jpg", "psd", "pdf"]),
  quality: z.enum(["low", "medium", "high"]),
  dimensions: z.enum(["original", "hi-res"]),
  pressure: z.array(pressureCurvePointSchema).min(2),
})

export type GeneralFormValues = z.infer<typeof generalFormSchema>
