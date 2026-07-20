# Contributing

Thanks for helping improve Route Scout!

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

The repo is a pnpm workspace with three packages:

- `packages/core` — `@route-scout/core`, the engine. Pure, unit-tested with Vitest. **No editor or
  framework coupling** belongs here.
- `packages/cli` — the `route-scout` CLI. Thin layer over core.
- `packages/vscode` — the VSCode extension. Bundles core with esbuild (self-contained `.vsix`).

## Before opening a PR

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

CI runs all of the above plus packages the extension.

## Adding a usage matcher placeholder

Placeholders live in `packages/core/src/placeholders.ts`. Add the case, cover it in
`placeholders.test.ts`, and document it in the READMEs and the extension's `package.json`
configuration schema.

## Releasing

- Bump versions in the affected `package.json`s.
- `@route-scout/core` and `route-scout` publish to npm.
- The extension is packaged with `pnpm package:vscode` and published with
  `vsce publish` / `ovsx publish` (see the VSCode package README).
