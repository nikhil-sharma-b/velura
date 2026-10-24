<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## No 120 Hz display

There is no 120 Hz or faster display to measure on, so anything that needs one cannot be done: D30's under-10 ms pen-to-pixel at 120 Hz, a 120 Hz baseline, "re-run on a 120 Hz display". Do not write tickets or stories for it, and do not leave it as a follow-up. In an issue, an acceptance criterion that needs a 120 Hz display is marked `- [-]` (dashed: not done and not to be done), never `- [x]`, and does not keep a ticket open. Benchmark results say what the display they were measured on can show and leave the 120 Hz figure at that.

## Git Branch Naming Convention

When creating feature or issue branches for milestones, follow the milestone/topic prefix convention:

- Format: `<milestone-or-topic>/<feature-name>` (kebab-case)
- Examples:
  - `brush-library/vector-brush-model-and-library`
  - `brush-library/svg-tips`
  - `smudge/smears-paint`
  - `studio/ux-polish`
