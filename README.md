# Next.js template

This is a Next.js template with shadcn/ui.

## Development checks

Use Bun 1.4.2 (pinned in `.bun-version` and `package.json`) and install
dependencies with `bun install --frozen-lockfile`. Commit `bun.lock` when
dependencies change. `bunfig.toml` makes package scripts use the Bun runtime.

- `bun run dev` starts the development server.
- `bun run typecheck` runs the native TypeScript 7 compiler.
- `bun run lint` runs Oxlint; `bun run lint:fix` applies available fixes.
- `bun run format` formats TypeScript and TSX files with Oxfmt.
- `bun run format:check` checks formatting without writing files.
- `bun run build` builds the app and runs TypeScript checking.
- `bun run start` serves the production build.

Next.js 16.3.4 uses the TypeScript CLI for build-time checking, supporting
TypeScript 7 without the legacy compiler API. The removed `baseUrl` option is
unnecessary because the `@/*` path mapping already uses relative paths.

`.oxfmtrc.json` preserves the previous formatting options and Tailwind class
sorting, including `cn` and `cva`. `.oxlintrc.json` migrates the Next.js,
React, accessibility, and TypeScript lint rules to built-in Oxlint plugins.
The old JSX usage rules are unnecessary with the JSX transform and Oxlint's
unused-variable handling. React deprecation checks and React Compiler
`config`/`gating` checks have no equivalent enabled in this configuration.

## Adding components

To add components to your app, run the following command:

```bash
bunx --bun shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```

## Canvas walking skeleton

Opening `/` mounts the full-viewport studio canvas. `engine/index.ts` is the
framework-free public facade: attach a canvas with `createEngine(canvas)`, issue
serializable `initialize` and `resize` commands, subscribe to immutable snapshots,
and call `dispose()` when detaching. Snapshots report lifecycle and backing-store
size; unchanged state does not notify subscribers. React uses `useSyncExternalStore`.
The host observes layout and checks display density without updating React each frame.

Missing WebGPU or an unavailable adapter shows browser guidance; request/configuration
errors and device loss show a separate retryable failure. Retry recreates the device;
restoring document content from the tile cache belongs to subsequent tickets.

## Tiles and colour

Pixels live in sparse 256x256 `rgba16float` tiles, premultiplied, in linear light
(`engine/doc/`). A tile is allocated only when something is written into it; an
absent tile reads as fully transparent. `engine/doc/scene.ts` holds the hardcoded
shape shown until drawing exists.

The working space is linear Display P3, so a wide-gamut display can show colours
sRGB cannot reach. A single present pass (`engine/shaders/display-transform.ts`)
composites the layer over the backdrop in linear light, converts working-space
primaries to the output space, and applies the transfer function. That is the only
place colour is encoded; export and previews must reuse it, or they will diverge
from the canvas. The swap chain is configured for Display P3 when the display
reports a P3 gamut and the swap chain accepts it, and falls back to sRGB with a
real primary conversion otherwise. `getSnapshot().outputColorSpace` reports which.

Oxlint restricts `engine/**` to engine-local imports and prohibits imports from
`app/`, `features/`, `components/`, `hooks/`, and `lib/`, including relative paths.
New framework-free package dependencies must be explicitly allowed in the engine
override in `.oxlintrc.json`. Framework packages must remain outside the engine.

### Tests

`bun run test` runs both suites: Bun unit tests for contracts that need no GPU,
then the Playwright browser suite.

```sh
bunx playwright install chromium
bun run test
# Focused feedback loops:
bun run test:unit
bun run test:browser tests/browser/engine.spec.ts
```

Unit tests in `tests/unit/` cover tile coordinate math, dirty-region bounds,
sparse tile allocation, half-float storage, and the display-transform colour
math. These are the contracts the Worker migration, atlas eviction, and compute
brushes all leave untouched; everything needing a `GPUDevice` is tested through
the engine facade instead.

Playwright uses headless Chromium with SwiftShader (software WebGPU); a missing
adapter fails the GPU tests rather than silently skipping them. These flags are
only for the test browser. The Next server uses `http://localhost:3000` (reusing
an existing local development server). A separate Vite server on port 3101 serves
`tests/harness/`, where tests drive the same facade without React. The harness is
outside the Next route tree and is not part of the production app.

`readPixels()` returns actual rendered RGBA8 bytes with GPU row padding removed
and BGRA normalized to RGBA. It is an explicit asynchronous readback, never part
of the interactive render path. Pixel tests use literal expected colors, including
non-aligned row widths, and report the colour space they were encoded in, so the
golden-image test asserts against the display transform for whichever gamut the
swap chain actually presented. Host tests cover viewport and density changes,
unavailable WebGPU, startup failures, retry, and device loss.

GitHub Actions installs the pinned Bun version and Chromium, then runs lint,
formatting, typechecking, both test suites, and a production build. Failed browser
runs retain Playwright traces in the `browser-test-results` artifact. Software GPU
tests check correctness; hardware performance still needs a separate benchmark.

## Backend, accounts and the document library

`convex/` holds the backend: the schema, email one-time-code auth, and the
document functions. The studio at `/` still needs no account and no backend —
the Convex client is mounted only under the `app/(cloud)/` route group, which
serves `/signin`, `/library`, and `/d/<documentId>`.

```sh
bunx convex dev          # writes .env.local, generates convex/_generated, deploys
bunx @convex-dev/auth    # one-off: sets the deployment's JWT signing keys
```

Sending codes needs a Resend key on the deployment, and the address codes are
sent from:

```sh
bunx convex env set AUTH_RESEND_KEY re_...
bunx convex env set AUTH_EMAIL_FROM "Velura <hello@your-domain>"
```

Signing in mails an eight-digit code that expires in fifteen minutes; there is
no password anywhere in the flow, and signing out invalidates the server session
along with the locally held tokens, so a shared machine keeps nothing.

Documents carry an owner, a name and a pixel size up to the engine's 8192-pixel
texture limit (`convex/lib/documents.ts`, shared by the create form and the
mutation that enforces it). The `users` row carries `plan`, `storageBytes` and
`docCount` from this first migration; nothing reads or writes them yet (D40). Opening a
document mounts an empty canvas — pixels are not persisted until the tile store
lands.

Access control lives in `convex/documents.ts`: every read and write resolves the
row through one ownership check, and a document belonging to someone else is
reported as missing rather than as forbidden. `tests/unit/convex-documents.test.ts`
runs those functions against `convex-test` (the Convex harness) under the Bun
runner, covering schema validity, the library operations, and the access-control
boundary from a second account and from a signed-out caller. Because Bun has no `import.meta.glob`, that file lists the backend
modules explicitly.
