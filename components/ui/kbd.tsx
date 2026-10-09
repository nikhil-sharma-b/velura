import {
  ArrowDownIcon,
  ArrowFatUpIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CommandIcon,
  OptionIcon,
} from "@phosphor-icons/react/ssr"
import type { Icon, IconWeight } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

// A keycap. Karla has no ⌘ ⇧ ⌥ or arrows, so a borrowed glyph sat at its own
// size beside the letters; the system face draws them all as one set, the way
// the OS shows shortcuts in its own menus.
function Kbd({ className, children, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-0.5 rounded-none border border-border bg-muted/70 px-1 font-[system-ui,-apple-system,sans-serif] text-[11px] leading-none font-medium tracking-[0.04em] text-foreground/85 tabular-nums select-none in-data-[slot=tooltip-content]:border-white/30 in-data-[slot=tooltip-content]:bg-white/15 in-data-[slot=tooltip-content]:text-tooltip-foreground [&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    >
      {typeof children === "string" ? glyphs(children) : children}
    </kbd>
  )
}

// Fonts draw ⇧ and the arrows as hairline outlines and ⌘ a size down, so
// beside a capital they look thin and out of step. Each is drawn as an icon at
// one bold stroke instead; the character stays, hidden, as the key's text.
// Each icon fills its 256-unit box by a different amount, so one size drew
// ⇧ big and ⌥ small. Each box is sized from the icon's measured extent (its
// height; an arrow's long side) so the drawn mark is a capital's height,
// 0.7em of the key's face. ⌥ is wide and short, so it stops a little under.
const ICONS: Record<
  string,
  { Glyph: Icon; extent: number; weight?: IconWeight }
> = {
  "⌘": { Glyph: CommandIcon, extent: 184 },
  // Outlined, ⇧ is a hollow arrow whose stroke falls under a pixel at this
  // size and smears; filled, it has no thin stroke to lose.
  "⇧": { Glyph: ArrowFatUpIcon, extent: 208, weight: "fill" },
  "⌥": { Glyph: OptionIcon, extent: 160 },
  "←": { Glyph: ArrowLeftIcon, extent: 200 },
  "→": { Glyph: ArrowRightIcon, extent: 200 },
  "↑": { Glyph: ArrowUpIcon, extent: 200 },
  "↓": { Glyph: ArrowDownIcon, extent: 200 },
}
const SYMBOLS = /([⌘⇧⌥←→↑↓])/

function glyphs(text: string) {
  return text
    .split(SYMBOLS)
    .filter(Boolean)
    .map((part, i) => {
      const icon = ICONS[part]
      if (!icon) return part
      const { Glyph, extent, weight = "bold" } = icon
      const size = `${(0.7 * 256) / extent}em`
      return (
        <span key={i} className="inline-flex">
          <Glyph
            aria-hidden
            weight={weight}
            style={{ width: size, height: size }}
          />
          <span className="sr-only">{part}</span>
        </span>
      )
    })
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
