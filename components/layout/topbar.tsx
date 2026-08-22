"use client"

import { ActionButtons } from "@/features/topbar/components/action-buttons"
import Image from "next/image"

export function Topbar() {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between gap-4 border-b border-border/80 bg-topbar px-4 py-3 shadow-[0_1px_12px_rgb(0_0_0/0.14)]">
      <Image
        src="/velura-logo-pressure-stroke.png"
        alt="Velura Logo"
        className="rounded-sm shadow-sm"
        width={84}
        height={16}
        priority
      />

      <ActionButtons />
    </header>
  )
}
