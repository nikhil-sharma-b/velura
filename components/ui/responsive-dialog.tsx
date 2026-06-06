"use client"

import * as React from "react"

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerOverlay,
  DrawerPortal,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { useIsMobile } from "@/hooks/use-mobile"

const ResponsiveDialogContext = React.createContext(false)

function useResponsiveDialog() {
  return React.useContext(ResponsiveDialogContext)
}

// Pairs a mobile (drawer) and desktop (dialog) component, picking between them
// based on the viewport decision resolved once by the nearest ResponsiveDialog.
function createResponsiveComponent<
  M extends React.ElementType,
  D extends React.ElementType,
>(MobileComponent: M, DesktopComponent: D) {
  return function ResponsiveComponent(
    props: React.ComponentProps<M> & React.ComponentProps<D>
  ) {
    const Component = useResponsiveDialog() ? MobileComponent : DesktopComponent
    return <Component {...props} />
  }
}

function ResponsiveDialog(
  props: React.ComponentProps<typeof Dialog> &
    React.ComponentProps<typeof Drawer>
) {
  const isMobile = useIsMobile()
  const Root = isMobile ? Drawer : Dialog

  return (
    <ResponsiveDialogContext.Provider value={isMobile}>
      <Root {...props} />
    </ResponsiveDialogContext.Provider>
  )
}

const ResponsiveDialogTrigger = createResponsiveComponent(
  DrawerTrigger,
  DialogTrigger
)
const ResponsiveDialogPortal = createResponsiveComponent(
  DrawerPortal,
  DialogPortal
)
const ResponsiveDialogClose = createResponsiveComponent(
  DrawerClose,
  DialogClose
)
const ResponsiveDialogOverlay = createResponsiveComponent(
  DrawerOverlay,
  DialogOverlay
)
const ResponsiveDialogContent = createResponsiveComponent(
  DrawerContent,
  DialogContent
)
const ResponsiveDialogHeader = createResponsiveComponent(
  DrawerHeader,
  DialogHeader
)
const ResponsiveDialogFooter = createResponsiveComponent(
  DrawerFooter,
  DialogFooter
)
const ResponsiveDialogTitle = createResponsiveComponent(
  DrawerTitle,
  DialogTitle
)
const ResponsiveDialogDescription = createResponsiveComponent(
  DrawerDescription,
  DialogDescription
)

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogOverlay,
  ResponsiveDialogPortal,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
}
