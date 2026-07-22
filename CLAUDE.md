# CLAUDE.md

Guidance for working in this repo.

## What this is

**Route Scout** — find where each OpenAPI endpoint is used across a codebase. Open-source (MIT). Point
it at OpenAPI specs + source globs; it maps every operation to its call sites. Ships as a **CLI** and a
**VSCode extension**. The end goal is publishing the VSCode extension.

## Layout — pnpm workspace, 3 packages

- `packages/core` (`@route-scout/core`) — the engine. Pure, framework-agnostic, unit-tested (Vitest).
- `packages/cli` (`route-scout`) — CLI over core. Table / JSON / Markdown output, filters. **Bundles core
  via esbuild** (`esbuild.mjs`, ESM output) so the published npm package is self-contained (zero runtime
  deps); core is a devDependency only.
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
   usage). `scanContent()` matches against masked content but previews from the original, and takes an
   optional `keep(op, identifier)` predicate (client gating, below). `parseImports()` returns each
   import's `{ module, idents }` for that gating.
4. `clients.ts` — **the client model.** `clients: [{ module, spec }]`. `normalizeImport()` turns an import
   specifier into something matchable: **relative** specifiers are resolved to a repo-relative path
   (`../__generated__/client.js` → `apps/…/providers/companyServer/__generated__/client`), bare/alias
   kept as-is (`~/__generated__/mdm-server-client/…`). `resolveClients()` maps each client's `spec` to
   concrete spec files; `clientSpecsForModule()` returns the spec(s) a normalized module belongs to.
5. `build.ts` — orchestrates; dedupes call sites per (file,line); returns `IndexResult` (incl. `files`).
   **Client gating** (only when `clients` non-empty): per file, link imports to clients, then keep a hit
   iff it's client-linked — a **symbol** hit counts only if that identifier was **imported from a client**
   (→ that client's spec); a **property-access/regex** hit (`.op(`) counts for the client(s) the file
   imports from. So an `operationId` shared by several endpoints is attributed to the right one, and
   look-alike code (a controller method / local service named like an operationId) is ignored. Empty
   `clients` = every matcher hit counts (legacy behavior).
6. `naming.ts` — `serverName(op)`: `info.title` else filename with `-openapi`/`swagger` stripped.

Defaults: specs `**/openapi*` etc; sources common JS/TS; `ignoreImports: true`; `clients: []`. Default
matchers: `{operationId}` + `use{OperationId}` (covers generated clients + react-query/swr hooks). Note:
`importAware`/`importFrom` were **removed** — the `clients` model supersedes them.

## VSCode extension (packages/vscode/src)

Split into focused modules (esbuild bundles from `extension.ts`, `.js` specifiers resolve to `.ts`):
`extension.ts` (activation + command wiring only), `store.ts` (the index: shared state +
`ensureIndex`/`invalidate`/`byOperationId` + view singletons via `initViewState`), `providers.ts`
(CodeLens / Definition / Hover), `tree.ts` (the Endpoints view), `commands.ts` (all command handlers),
`config.ts` (`readConfig` + `ScoutConfig`), `nav.ts` (pure disambiguation logic, unit-tested), `log.ts`
(the "Route Scout" output channel). Commands reference each other by **string id**, so there are no
import cycles.

- **Bundles core** (esbuild, CJS). View lives in the **bottom panel** (viewsContainers.panel).
- **Logging**: `log.ts` owns a single `LogOutputChannel` ("Route Scout", `{ log: true }` — leveled +
  timestamped, filterable via *Developer: Set Log Level*). `store` logs the indexing lifecycle (per-folder
  counts, resolved specs/sources globs, and a **source-files-by-dir breakdown** to help trim big scans —
  full file lists at `trace`); `commands.goToEndpoint` logs the **routing decision** (candidates, identity
  tokens, chosen declaration or "ambiguous, prompting"). `Route Scout: Show Logs` (`routeScout.showLogs`)
  reveals the channel. The file lists come from `IndexResult.files` (`{ specs, sources }`) which `buildIndex`
  now returns.
- CodeLens + Go-to-Definition are keyed on **`operationId: '…'` lines**, registered for JSON/YAML **and
  TS/JS** — so they work in OpenAPI specs *and* in NestJS `@ApiOperation({ operationId })` decorators.
  Cmd/Ctrl+Click on an operationId line → jump/peek its usages. Usages are **merged by operationId**
  across channels (an id can appear in both api + internal specs).
- Tree view grouping is **customizable and nestable** via `routeScout.groupBy` — an ordered array of
  dimensions (`server` | `tag` | `method`), e.g. `["server","tag"]` = server → tag → endpoints. Toggle
  it from the view title ("Group By…" presets). groupBy is display-only: changing it refreshes without a
  reindex (see `REINDEX_KEYS`).
- **Disambiguation** lives in `nav.ts` (pure, no `vscode`, unit-tested in `nav.test.ts` against a
  sourcehub-like fixture: 2 servers × api/internal all exposing one operationId). An operationId can map
  to several endpoints (api + internal, across servers). `disambiguate()` narrows to the right one by
  exact spec-file match, else **identity-token overlap** with the document's path. The key idea:
  `endpointIdentity(op)` derives channel + server tokens from the **spec file name + title** (e.g.
  `orders-internal-openapi.json` → `{orders, internal}`) — not the URL path, which is identical across
  channels (`/invoices/{id}`). CodeLens is **per-endpoint** (never merged) so counts match the tree; if
  still ambiguous it shows one lens per endpoint labelled by server. (Bug we fixed: merging by
  operationId made the lens show 2 where the endpoint had 1.)
- **Shared-usage labelling** (`ambiguous()` in `providers.ts`): a same-operationId collision is flagged
  `(shared)` (CodeLens) / shown once ("N usages shared across M endpoints … not attributable
  individually", hover) **only when it can't be attributed**. Without `clients`, any collision is
  ambiguous. With `clients`, usages are attributed by spec, so only a **duplicate operationId within one
  spec** stays ambiguous (e.g. `createMDMControl` on both `POST /api/...` and `POST /internal/...` in
  `mdm-server-openapi.json` — the generated client exposes one symbol, so a call site can't say which).
- **Hover + reverse nav**: hovering a usage (a `use{Op}` hook, an operationId, a client call) in any
  source file shows the endpoint (method/path/summary/server + usage count) and an **"Open in spec"**
  command link (`routeScout.openSpec` reveals the operationId line). Backed by a `symbolNav` map
  (`operationId` + every symbol-matcher expansion → endpoints) rebuilt with the index. The
  **`routeScout.revealEndpoint`** command (right-click / palette) jumps code → spec for the symbol at
  the cursor, using the same `symbolNav`. It jumps to the **declaration** (a `routeScout.definitions`
  file, e.g. `**/*.controller.ts` — scanned into `declarationNav`) if configured, else the spec;
  `definitions` is an extension-only nav setting (a cast `ScoutConfig` field, not in core). When an
  operationId exists on several channels/servers, the endpoint quickpick picks the endpoint, then
  `pickDeclaration()` routes to the right controller by scoring each declaration file against the chosen
  endpoint's identity tokens (channel + server). If no single declaration clearly wins it returns
  `{ ambiguous: true }` and the extension **prompts with a quickpick of the candidate files** rather than
  silently jumping to an arbitrary one (the bug: a `.api`/`.internal` pair on the same URL path used to
  land on whichever came first).
- **`Route Scout: Initialize Config`** (`routeScout.initConfig`) scaffolds a `routescout.config.json`
  (detects specs, excludes generated dirs) and offers to set it as `configFile`.
- Settings: `routeScout.specs`, `.sources`, `.exclude`, `.usage`, `.ignoreImports`, `.ignoreLines`,
  `.clients`, `.definitions`, `.configFile`, `.rebuildOnSave`, `.groupBy`. `routeScout.configFile`
  (JSON only, = core config, so no `groupBy` there) replaces the individual scanning settings.

## Commands

```bash
pnpm install
pnpm build            # core (tsc) → cli (esbuild bundle) → vscode (esbuild bundle)
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
Same version = no-op.

The **CLI (`route-scout-cli`) ships to npm on its own cadence** via a separate `publish-npm` job in the
same workflow, using **OIDC Trusted Publishing** (no stored token — the job has `id-token: write` and
pnpm exchanges a minted OIDC token for short-lived publish auth). Bump `packages/cli/package.json` version
and push; it publishes only when that version isn't already on the registry. Decoupled from the extension
release — either can ship independently.

**First publish is manual** (npm requires the package to exist before a trusted publisher can be
configured on npmjs.com). One-time setup (published under the `mathieuletyrant` account, unscoped — no
org needed):
1. From repo root: `pnpm build`, then `pnpm --filter route-scout-cli publish` in a real terminal
   (interactive 2FA/OTP — use pnpm, not `npm publish`, so `workspace:*` devDeps get rewritten).
2. On npmjs.com → the package's **Trusted Publisher** settings, add GitHub Actions: org
   `mathieuletyrant`, repo `route-scout`, workflow filename `release.yml`, allowed action `npm publish`.
   After that, every version bump publishes from CI with no token. `schema.json` (config JSON Schema) is served from
`raw.githubusercontent.com/…/refs/heads/main/schema.json` (use the `refs/heads/main` form).

## Publishing status / decisions

- **CLI published to npm** as `route-scout-cli` (self-contained esbuild bundle; the `bin` command stays
  `route-scout`). The unscoped name `route-scout` was already taken on npm by an unrelated package, hence
  the `-cli` suffix. Core stays private (`@route-scout/core`, `"private": true`) — bundled into the CLI,
  never published on its own.
- Extension `publisher: "MathieuLeTyrant"`. VS Marketplace needs an Azure DevOps PAT (`VSCE_PAT`) — the
  user hit repeated Azure DevOps signup blockers, so the GitHub-Release `.vsix` path is the working
  fallback; Open VSX (GitHub login, no Azure) is the recommended real-store alternative.

## Primary real-world consumer: sourcehub

The tool originated from getprimo/sourcehub PR #8827 (Nx monorepo, Orval clients). Working config lives
at `/Users/mathieu/Primo/sourcehub/routescout.config.json` (+ `.vscode/settings.json` points to it). Key
points for that repo:

- specs `packages/openapi-specs/*-openapi.json`; sources `apps/**/src/**/*.{ts,tsx}`.
- **Uses the `clients` model** (the whole reason it was built). Generated clients:
  cockpit/procurement UIs import hooks from `~/__generated__/<server>-client/…` (alias — the path names the
  server); server-to-server providers import a factory from `providers/<server>/__generated__/client.js`
  (relative — only the *resolved* path names the server, hence `normalizeImport`) then call
  `api.op(...)`. So each client maps to its `*-openapi.json` spec; declare one `clients` entry per
  (client dir → spec). This attributes shared operationIds correctly (e.g. `getDeviceFilterCatalog`:
  Company=1, MDM=1) and ignores controller methods / local services named like an operationId — **no more
  giant `sources` blocklist needed**, just exclude generated-client dirs so the client's own definitions
  aren't counted.
- Matchers: `{operationId}` + `use{OperationId}` (imported hooks/fns) + a `\.{operationId}\(` regex for the
  server-to-server factory `.op(...)` property calls.
