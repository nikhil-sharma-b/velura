"use client";

import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { DEFAULT_PRESSURE_CURVE } from "@/components/ui/pressure-curve";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GeneralForm } from "@/features/topbar/components/forms/general";
import { InputForm } from "@/features/topbar/components/forms/input";
import { APP_SETTINGS_ITEMS } from "@/features/topbar/lib/constants";
import {
  generalFormSchema,
  GeneralFormValues,
} from "@/features/topbar/lib/schemas";
import { useIsMobile } from "@/hooks/use-mobile";
import { zodResolver } from "@hookform/resolvers/zod";
import { GearIcon } from "@phosphor-icons/react";
import { FormProvider, useForm } from "react-hook-form";
import { IconButton } from "@/features/studio/components/icon-button";

export function AppSettingsDialog() {
  const isMobile = useIsMobile();
  const form = useForm<GeneralFormValues>({
    defaultValues: {
      appearance: "system",
      toolbar: "left",
      fileFormat: "png",
      quality: "medium",
      dimensions: "original",
      pressure: DEFAULT_PRESSURE_CURVE,
    },
    resolver: zodResolver(generalFormSchema),
  });

  const onSubmit = (data: GeneralFormValues) => {
    console.log(data);
  };

  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <IconButton
          label="Settings"
          side="bottom"
          variant="ghost"
          className="h-11 rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <GearIcon className="size-6" />
        </IconButton>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="gap-0 p-0 md:min-w-150">
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
                className="data-active:border-transparent data-active:border-l-primary data-active:bg-transparent data-active:text-primary dark:data-active:border-transparent dark:data-active:border-l-primary dark:data-active:bg-transparent dark:data-active:text-primary"
                value={tab.toLowerCase()}
              >
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
          <ScrollArea className="h-91 w-full">
            <div className="size-full bg-background">
              <FormProvider {...form}>
                <form
                  id="app-settings-form"
                  onSubmit={form.handleSubmit(onSubmit)}
                >
                  <TabsContent value="general" className="p-3">
                    <GeneralForm />
                  </TabsContent>
                  <TabsContent value="input" className="p-3">
                    <InputForm />
                  </TabsContent>
                </form>
              </FormProvider>
            </div>
          </ScrollArea>
        </Tabs>
        <ResponsiveDialogFooter>
          <Button size="xs" type="submit" form="app-settings-form">
            Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
