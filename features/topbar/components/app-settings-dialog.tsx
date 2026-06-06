"use client"

import { Button } from "@/components/ui/button"
import { DialogTitle } from "@/components/ui/dialog"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { GeneralForm } from "@/features/topbar/components/forms/general"
import { APP_SETTINGS_ITEMS } from "@/features/topbar/lib/constants"
import {
  generalFormSchema,
  GeneralFormValues,
} from "@/features/topbar/lib/schemas"
import { useIsMobile } from "@/hooks/use-mobile"
import { zodResolver } from "@hookform/resolvers/zod"
import { GearIcon } from "@phosphor-icons/react"
import { FormProvider, useForm } from "react-hook-form"

export function AppSettingsDialog() {
  const isMobile = useIsMobile()
  const form = useForm<GeneralFormValues>({
    defaultValues: {
      appearance: "system",
      toolbar: "left",
      fileFormat: "png",
      quality: "medium",
      dimensions: "original",
    },
    resolver: zodResolver(generalFormSchema),
  })

  const onSubmit = (data: GeneralFormValues) => {
    console.log(data)
  }

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <Button variant="ghost" className="h-11 rounded-full p-2">
          <GearIcon className="size-6" />
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="gap-0 p-0 md:min-w-125">
        <ResponsiveDialogHeader>
          <DialogTitle>App settings</DialogTitle>
        </ResponsiveDialogHeader>
        <hr className="bg-border" />
        <Tabs
          defaultValue="general"
          orientation={isMobile ? "horizontal" : "vertical"}
          className="h-full"
        >
          <TabsList className="bg-transparent p-0 py-4 max-md:gap-4 max-md:pt-6">
            {APP_SETTINGS_ITEMS.map((tab) => (
              <TabsTrigger
                key={tab}
                className="data-active:border-transparent data-active:border-l-foreground data-active:bg-transparent dark:data-active:border-transparent dark:data-active:border-l-foreground dark:data-active:bg-transparent"
                value={tab.toLowerCase()}
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="size-full bg-background">
            <TabsContent value="general" className="p-3">
              <FormProvider {...form}>
                <form
                  id="app-settings-form"
                  className="flex flex-col gap-3"
                  onSubmit={form.handleSubmit(onSubmit)}
                >
                  <GeneralForm />
                </form>
              </FormProvider>
            </TabsContent>
          </div>
        </Tabs>
        <ResponsiveDialogFooter>
          <Button
            variant="outline"
            size="xs"
            type="submit"
            form="app-settings-form"
          >
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
