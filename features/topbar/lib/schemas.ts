import z from "zod"

export const generalFormSchema = z.object({
  toolbar: z.enum(["left", "right"]),
  appearance: z.enum(["light", "dark", "system"]),
  fileFormat: z.enum(["png", "jpg", "psd", "pdf"]),
  quality: z.enum(["low", "medium", "high"]),
  dimensions: z.enum(["original", "hi-res"]),
})

export type GeneralFormValues = z.infer<typeof generalFormSchema>
