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

The engine clears an opaque display-encoded charcoal surface on startup and resize.
This is only the canvas host, not the future linear-light document compositor.
Missing WebGPU or an unavailable adapter shows browser guidance; request/configuration
errors and device loss show a separate retryable failure. Retry recreates the device;
restoring document content from the tile cache belongs to subsequent tickets.

Oxlint restricts `engine/**` to engine-local imports and prohibits imports from
`app/`, `features/`, `components/`, `hooks/`, and `lib/`, including relative paths.
New framework-free package dependencies must be explicitly allowed in the engine
override in `.oxlintrc.json`. Framework packages must remain outside the engine.

### Browser tests

```sh
bunx playwright install chromium
bun run test
# Focused feedback loop:
bun run test:browser tests/browser/engine.spec.ts
```

Playwright uses headless Chromium with SwiftShader (software WebGPU); a missing
adapter fails the GPU tests rather than silently skipping them. These flags are
only for the test browser. The Next server uses `http://localhost:3000` (reusing
an existing local development server). A separate Vite server on port 3101 serves
`tests/harness/`, where tests drive the same facade without React. The harness is
outside the Next route tree and is not part of the production app.

`readPixels()` returns actual rendered RGBA8 bytes with GPU row padding removed
and BGRA normalized to RGBA. It is an explicit asynchronous readback, never part
of the interactive render path. Pixel tests use literal expected colors, including
non-aligned row widths. Host tests cover viewport and density changes, unavailable
WebGPU, startup failures, retry, and device loss. Future pure-contract unit tests
can use Bun's test runner when the corresponding math/storage modules arrive.

GitHub Actions installs the pinned Bun version and Chromium, then runs lint,
formatting, typechecking, the browser suite, and a production build. Failed browser
runs retain Playwright traces in the `browser-test-results` artifact. Software GPU
tests check correctness; hardware performance still needs a separate benchmark.
