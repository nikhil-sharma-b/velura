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
