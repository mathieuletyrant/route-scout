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

Releases are automated from `main` (`.github/workflows/release.yml`):

1. Bump `version` in `packages/vscode/package.json`.
2. Commit and push to `main`.

The workflow detects the new version (no matching `v<version>` tag yet), runs the full build, packages
the extension, tags the commit `v<version>` and creates a **GitHub Release with the `.vsix` attached** —
this needs no tokens, so it works out of the box. Ordinary commits that don't change the version are
no-ops.

Store publishing is layered on top and opt-in via repository secrets:

- `VSCE_PAT` → also publish to the VS Marketplace.
- `OVSX_TOKEN` → also publish to [Open VSX](https://open-vsx.org).

Without either secret, releases still ship via GitHub Releases; users install the `.vsix` by hand
(Extensions → `···` → *Install from VSIX…*).
