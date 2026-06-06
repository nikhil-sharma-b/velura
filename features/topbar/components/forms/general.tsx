import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Controller, useFormContext } from "react-hook-form"

export function GeneralForm() {
  const form = useFormContext()

  return (
    <FieldGroup className="gap-3">
      <FieldSet>
        <FieldLegend>Interface</FieldLegend>
        <Controller
          name="toolbar"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              data-invalid={fieldState.invalid}
              className="flex-row justify-between"
            >
              <FieldLabel htmlFor="toolbar">Toolbar</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="toolbar">
                  <SelectValue placeholder="Position" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="left">Left</SelectItem>
                    <SelectItem value="right">Right</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="appearance"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              data-invalid={fieldState.invalid}
              className="flex-row justify-between"
            >
              <FieldLabel htmlFor="appearance">Appearance</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="appearance">
                  <SelectValue placeholder="Theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Quick export settings</FieldLegend>
        <Controller
          name="fileFormat"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              data-invalid={fieldState.invalid}
              className="flex-row justify-between"
            >
              <FieldLabel htmlFor="file-format">File format</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="file-format">
                  <SelectValue placeholder="File format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="jpg">JPG</SelectItem>
                    <SelectItem value="psd">PSD</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Timelapse settings</FieldLegend>
        <Controller
          name="quality"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              data-invalid={fieldState.invalid}
              className="flex-row justify-between"
            >
              <FieldLabel htmlFor="quality">Quality</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="quality">
                  <SelectValue placeholder="quality" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
        <Controller
          name="dimensions"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              data-invalid={fieldState.invalid}
              className="flex-row justify-between"
            >
              <FieldLabel htmlFor="dimensions">Dimensions</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="dimensions">
                  <SelectValue placeholder="dimensions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="original">
                      Original (upto 1920x1080)
                    </SelectItem>
                    <SelectItem value="hi-res">
                      Hi-res (upto 2048x2048)
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldSet>
    </FieldGroup>
  )
}
