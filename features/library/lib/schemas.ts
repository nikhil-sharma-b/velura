import z from "zod"

import {
  MAX_CANVAS_SIZE,
  MAX_DOCUMENT_NAME_LENGTH,
  MIN_CANVAS_SIZE,
} from "@/convex/lib/documents"

export const emailFormSchema = z.object({
  email: z.email("Enter the email address you want the code sent to."),
})

export const codeFormSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{8}$/, "The code is the eight digits from the email."),
})

// The size bound lives in `convex/lib/documents.ts` because the mutation must
// enforce it regardless of what the form does; the form reuses it so the artist
// hears about an impossible canvas before a round trip.
const canvasAxis = z
  .number({ error: "Enter a size in pixels." })
  .int("Use whole pixels.")
  .min(MIN_CANVAS_SIZE, `At least ${MIN_CANVAS_SIZE} pixels.`)
  .max(MAX_CANVAS_SIZE, `At most ${MAX_CANVAS_SIZE} pixels.`)

export const newDocumentFormSchema = z.object({
  name: z.string().max(MAX_DOCUMENT_NAME_LENGTH).optional(),
  width: canvasAxis,
  height: canvasAxis,
})

export type EmailFormValues = z.infer<typeof emailFormSchema>
export type CodeFormValues = z.infer<typeof codeFormSchema>
export type NewDocumentFormValues = z.infer<typeof newDocumentFormSchema>
