"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon } from "@phosphor-icons/react"
import { useMutation } from "convex/react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import { Spinner } from "@/components/ui/spinner"
import { api } from "@/convex/_generated/api"
import {
  DEFAULT_PRESET,
  DOCUMENT_PRESETS,
  MAX_CANVAS_SIZE,
} from "@/convex/lib/documents"
import {
  type NewDocumentFormValues,
  newDocumentFormSchema,
} from "@/features/library/lib/schemas"

export function NewDocumentDialog() {
  const [open, setOpen] = useState(false)
  const createDocument = useMutation(api.documents.create)
  const router = useRouter()

  const form = useForm<NewDocumentFormValues>({
    defaultValues: {
      name: "",
      width: DEFAULT_PRESET.width,
      height: DEFAULT_PRESET.height,
    },
    resolver: zodResolver(newDocumentFormSchema),
  })

  const onSubmit = async ({ name, width, height }: NewDocumentFormValues) => {
    try {
      const documentId = await createDocument({ name, width, height })
      setOpen(false)
      form.reset()
      router.push(`/d/${documentId}`)
    } catch {
      toast.error("Could not create that document.")
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={setOpen}>
      <ResponsiveDialogTrigger asChild>
        <Button>
          <PlusIcon />
          New document
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <DialogTitle>New document</DialogTitle>
        </ResponsiveDialogHeader>
        <form
          id="new-document-form"
          className="flex flex-col gap-4 p-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="document-name">Name</Label>
            <Input
              id="document-name"
              placeholder="Untitled"
              {...form.register("name")}
            />
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm">Presets</legend>
            <div className="flex flex-wrap gap-2">
              {DOCUMENT_PRESETS.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    form.setValue("width", preset.width, {
                      shouldValidate: true,
                    })
                    form.setValue("height", preset.height, {
                      shouldValidate: true,
                    })
                  }}
                >
                  {preset.label}
                  <span className="font-mono text-xs text-muted-foreground">
                    {preset.width}×{preset.height}
                  </span>
                </Button>
              ))}
            </div>
          </fieldset>

          <div className="flex gap-4">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="document-width">Width</Label>
              <Input
                id="document-width"
                type="number"
                inputMode="numeric"
                max={MAX_CANVAS_SIZE}
                aria-invalid={form.formState.errors.width !== undefined}
                {...form.register("width", { valueAsNumber: true })}
              />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="document-height">Height</Label>
              <Input
                id="document-height"
                type="number"
                inputMode="numeric"
                max={MAX_CANVAS_SIZE}
                aria-invalid={form.formState.errors.height !== undefined}
                {...form.register("height", { valueAsNumber: true })}
              />
            </div>
          </div>
          {(form.formState.errors.width ?? form.formState.errors.height) ? (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.width?.message ??
                form.formState.errors.height?.message}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Up to {MAX_CANVAS_SIZE} pixels on a side.
            </p>
          )}
        </form>
        <ResponsiveDialogFooter>
          <Button
            type="submit"
            form="new-document-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? <Spinner /> : null}
            Create
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
