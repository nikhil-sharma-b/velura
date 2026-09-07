"use client"

/**
 * Whether the app is reading pen tilt, said as a pen.
 *
 * The setting is about the angle of the artist's stylus, so the control is a
 * stylus at an angle: upright when tilt is ignored, laid over when it is
 * read. A filled-in button labelled "Tilt" cannot say which of those is true —
 * filled reads as "on", as "selected", and as "hovered" equally — and the word
 * alone names the subject rather than the state.
 *
 * The pen pivots about its nib against a line of paper, because that is what a
 * pen resting on a page does; turning it about its middle would read as a
 * needle swinging. The state is also written out, so nothing rests on the
 * picture being understood.
 */

const UPRIGHT = 0
/** Far enough over to read as a lean at 28px, short of falling flat. */
const LAID_OVER = -34

export function TiltToggle({
  enabled,
  onChange,
}: {
  enabled: boolean
  onChange(enabled: boolean): void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center gap-3 rounded-lg border border-studio-edge px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary aria-checked:border-primary/50 aria-checked:bg-primary/5"
    >
      <Stylus enabled={enabled} />
      <span className="min-w-0">
        <span className="block text-xs text-foreground">Pen tilt</span>
        <span className="block text-[11px] leading-tight text-muted-foreground">
          {enabled
            ? "Shading follows how far you lean"
            : "Every stroke draws upright"}
        </span>
      </span>
    </button>
  )
}

function Stylus({ enabled }: { enabled: boolean }) {
  return (
    <svg
      viewBox="0 0 28 28"
      className="size-7 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      {/* The paper the pen leans on: without it the rotation has nothing to
        be an angle against. */}
      <line
        x1={4}
        y1={24.5}
        x2={24}
        y2={24.5}
        className="stroke-studio-edge"
        strokeWidth={1}
        strokeLinecap="round"
      />
      <g
        // The rotation is a CSS transform rather than the SVG `transform`
        // attribute, because only the property animates: set as an attribute
        // the pen would jump between the two angles instead of leaning over,
        // and the lean is the whole point of the control.
        style={{
          transformOrigin: "14px 24px",
          transform: `rotate(${enabled ? LAID_OVER : UPRIGHT}deg)`,
        }}
        className={`transition-transform duration-200 ease-out motion-reduce:transition-none ${
          enabled ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {/* Barrel, tapering into the nib that meets the paper. */}
        <path
          d="M14 24 L11 18 L11 6 Q14 3 17 6 L17 18 Z"
          fill="currentColor"
          fillOpacity={enabled ? 0.18 : 0.1}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinejoin="round"
        />
        {/* The grip band, which is what makes it read as a stylus rather than
          as an arrow at this size. */}
        <line
          x1={11}
          y1={14}
          x2={17}
          y2={14}
          stroke="currentColor"
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      </g>
    </svg>
  )
}
