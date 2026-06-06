"use client"

import { ActionButtons } from "@/features/topbar/components/action-buttons"
import Image from "next/image"

export function Topbar() {
  return (
    <div className="sticky flex items-center justify-between gap-4 border-b p-4">
      <Image
        src="/velura.png"
        alt="Velura Logo"
        className="rounded"
        width={84}
        height={16}
      />

      <ActionButtons />
    </div>
  )
}
