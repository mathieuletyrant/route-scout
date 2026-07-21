# CLAUDE.md

Guidance for working in this repo.

## What this is

**Route Scout** — find where each OpenAPI endpoint is used across a codebase. Open-source (MIT). Point
it at OpenAPI specs + source globs; it maps every operation to its call sites. Ships as a **CLI** and a
**VSCode extension**. The end goal is publishing the VSCode extension.

## Layout — pnpm workspace, 3 packages

- `packages/core` (`@route-scout/core`) — the engine. Pure, framework-agnostic, unit-tested (Vitest).
- `packages/cli` (`route-scout`) — CLI over core. Table / JSON / Markdown output, filters.
- `packages/vscode` (`route-scout-vscode`) — the extension. **Bundles core via esbuild** (self-contained
  `.vsix`).

## Core model (packages/core/src)

Config-driven, **no AST / no framework coupling**. `buildIndex(config)`:

1. `specs.ts` — parse OpenAPI specs (JSON/YAML) → `Operation[]` (method, path, `operationId`, `specTitle`
   from `info.title`, tags).
2. `patterns.ts` — compile **usage matchers** into a symbol map + regex list. A matcher `template` is
   expanded per operation via `placeholders.ts` (`{operationId}`, `{OperationId}`,
   `{operationId:camel|pascal|kebab|snake|constant}`, `{method}`, `{METHOD}`, `{path}`, `{pathRegex}`).
   - `kind: 'symbol'` → whole-identifier match (fast; default). `kind: 'regex'` → per-line regex.
3. `scan.ts` — scan source files. `maskImports()` blanks `import` / `export … from` / side-effect
   imports **multi-line aware, preserving line/column positions** (so imported symbols never count as
   usage). `scanContent()` matches against masked content but previews from the original.
   `importedSymbols()` + `importAware`/`importFrom` config: when on, a **symbol** hit only counts if the
   identifier was actually imported (optionally from a module whose path contains an `importFrom`
   substring) — kills collisions like Apollo `const [getDevice] = useGetDeviceLazyQuery()`.
4. `build.ts` — orchestrates, dedupes call sites per (file,line), returns `IndexResult`.
5. `naming.ts` — `serverName(op)`: `info.title` else filename with `-openapi`/`swagger` stripped.

Defaults: specs `**/openapi*` etc; sources common JS/TS; `ignoreImports: true`. Default matchers:
`{operationId}` + `use{OperationId}` (covers generated clients + react-query/swr hooks).

## VSCode extension (packages/vscode/src/extension.ts)

- **Bundles core** (esbuild, CJS). View lives in the **bottom panel** (viewsContainers.panel).
- CodeLens + Go-to-Definition are keyed on **`operationId: '…'` lines**, registered for JSON/YAML **and
  TS/JS** — so they work in OpenAPI specs *and* in NestJS `@ApiOperation({ operationId })` decorators.
  Cmd/Ctrl+Click on an operationId line → jump/peek its usages. Usages are **merged by operationId**
  across channels (an id can appear in both api + internal specs).
- Tree view grouping is **customizable and nestable** via `routeScout.groupBy` — an ordered array of
  dimensions (`server` | `tag` | `method`), e.g. `["server","tag"]` = server → tag → endpoints. Toggle
  it from the view title ("Group By…" presets). groupBy is display-only: changing it refreshes without a
  reindex (see `REINDEX_KEYS`).
- **Disambiguation**: an operationId can map to several endpoints (api + internal). `disambiguate()`
  narrows to the right one by exact spec-file match, else a leading path segment (`api`/`internal`)
  present as a token in the file path (matches `*.api.controller.ts`). CodeLens is **per-endpoint**
  (never merged) so counts match the tree; if still ambiguous it shows one lens per endpoint labelled by
  server. (Bug we fixed: merging by operationId made the lens show 2 where the endpoint had 1.)
- **Hover + reverse nav**: hovering a usage (a `use{Op}` hook, an operationId, a client call) in any
  source file shows the endpoint (method/path/summary/server + usage count) and an **"Open in spec"**
  command link (`routeScout.openSpec` reveals the operationId line). Backed by a `symbolNav` map
  (`operationId` + every symbol-matcher expansion → endpoints) rebuilt with the index. The
  **`routeScout.revealEndpoint`** command (right-click / palette) jumps code → spec for the symbol at
  the cursor, using the same `symbolNav`.
- **`Route Scout: Initialize Config`** (`routeScout.initConfig`) scaffolds a `routescout.config.json`
  (detects specs, excludes generated dirs) and offers to set it as `configFile`.
- Settings: `routeScout.specs`, `.sources`, `.exclude`, `.usage`, `.ignoreImports`, `.ignoreLines`,
  `.importAware`, `.importFrom`, `.configFile`, `.rebuildOnSave`, `.groupBy`. `routeScout.configFile`
  (JSON only, = core config, so no `groupBy` there) replaces the individual scanning settings.

## Commands

```bash
pnpm install
pnpm build            # core → cli (tsc project refs) → vscode (esbuild)
pnpm test             # vitest (core)
pnpm typecheck
pnpm check            # biome (lint + format check)
pnpm format           # biome --write
pnpm package:vscode   # → packages/vscode/route-scout.vsix
node packages/cli/dist/cli.js --root <dir>   # run the CLI
```

Bundled-extension smoke test (runs the real `.vsix` against a stubbed `vscode` API — high value, it once
caught a real bundling bug): `scratchpad/vscode-smoke.mjs`.

## Toolchain gotchas (important)

- **TypeScript 7** (`typescript@^7`). `typescript-eslint` does **not** support TS 7 (crashes) → we use
  **Biome** for lint+format instead of eslint/prettier. Don't reintroduce eslint.
- **esbuild** bundling: `esbuild.mjs` shims `import.meta.url` (`define` + `banner`) — a bundled ESM dep
  used `createRequire(import.meta.url)`, which is `undefined` in CJS output and crashes at load. Keep the
  shim.
- Build wiring: core is a **composite** project; cli references it (`tsc -b`). cli typechecks via
  `tsconfig.typecheck.json` (paths → core src, no rootDir, to dodge TS6059). vscode typechecks with
  `module: Bundler`, `noEmit`, `verbatimModuleSyntax: false` (it's a CommonJS package).
- pnpm `allowBuilds`: only `esbuild: true` (needs its postinstall). The `.bin/esbuild` shim breaks after
  esbuild swaps in its native binary — that's why the extension builds via the **esbuild JS API**
  (`esbuild.mjs`), not the CLI.

## Releasing (automated from main)

Push to `main` with a bumped `packages/vscode/package.json` version → `.github/workflows/release.yml`
builds, packages, tags `v<version>`, and creates a **GitHub Release with the `.vsix`** — **no token
needed**. Store publishing is opt-in via secrets: `VSCE_PAT` (VS Marketplace), `OVSX_TOKEN` (Open VSX).
Same version = no-op. `schema.json` (config JSON Schema) is served from
`raw.githubusercontent.com/…/refs/heads/main/schema.json` (use the `refs/heads/main` form).

## Publishing status / decisions

- **Not published to npm** (deliberate). Only the extension is published.
- Extension `publisher: "MathieuLeTyrant"`. VS Marketplace needs an Azure DevOps PAT (`VSCE_PAT`) — the
  user hit repeated Azure DevOps signup blockers, so the GitHub-Release `.vsix` path is the working
  fallback; Open VSX (GitHub login, no Azure) is the recommended real-store alternative.

## Primary real-world consumer: sourcehub

The tool originated from getprimo/sourcehub PR #8827 (Nx monorepo, Orval clients). Working config lives
at `/Users/mathieu/Primo/sourcehub/routescout.config.json` (+ `.vscode/settings.json` points to it). Key
points for that repo:

- specs `packages/openapi-specs/*-openapi.json`; sources `apps/**/src/**/*.{ts,tsx}`.
- **Exclude the definition side**: generated clients (`__generated__`, `*-client`, `*.schemas/msw/zod.ts`)
  **and `**/*.controller.ts`** — the NestJS controller method is named after the operationId, so it would
  be counted as a false usage otherwise.
- Default matchers cover both cockpit-ui/procurement-ui react-query hooks (`use{Op}`) and server-to-server
  axios factory `.op(...)` calls (the `{operationId}` token matches the property access).
