"use client"

import Image from "next/image"
import { ActionButtons } from "./action-buttons"

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
