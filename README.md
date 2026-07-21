# Route Scout 🧭

> Find where each OpenAPI endpoint is used across your codebase.

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/MathieuLeTyrant.route-scout-vscode?label=VS%20Marketplace&color=blue)](https://marketplace.visualstudio.com/items?itemName=MathieuLeTyrant.route-scout-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/MathieuLeTyrant/route-scout-vscode?label=Open%20VSX&color=blue)](https://open-vsx.org/extension/MathieuLeTyrant/route-scout-vscode)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Route Scout answers one question fast: **"where is this endpoint consumed?"** Point it at your OpenAPI
specs and your source, and it maps every operation to its call sites — in CI, or right inside VSCode.

It's **spec-agnostic and framework-agnostic**. You configure three things:

1. **which specs** (globs),
2. **which sources** (globs),
3. **how a usage looks** (matchers) — the part that adapts Route Scout to your client, whether that's a
   generated client (`operationId` functions), react-query hooks (`use{OperationId}`), or raw
   `fetch()` calls keyed by URL.

## Packages

| Package                                        | What it is                                              |
| ---------------------------------------------- | ------------------------------------------------------- |
| [`@route-scout/core`](packages/core)           | The engine: spec parsing + usage matching. No coupling. |
| [`route-scout-cli`](packages/cli)              | CLI — reports, `--unused-only`, JSON/Markdown for CI.   |
| [`route-scout-vscode`](packages/vscode)        | VSCode extension — CodeLens, tree view, quick search.   |

## Quick start

**Route Scout is available on every store** — install the extension from wherever your editor pulls from:

- **VS Code Marketplace** → [Route Scout](https://marketplace.visualstudio.com/items?itemName=MathieuLeTyrant.route-scout-vscode) (or `code --install-extension MathieuLeTyrant.route-scout-vscode`)
- **Open VSX** (VSCodium, Cursor, Gitpod, Windsurf…) → [Route Scout](https://open-vsx.org/extension/MathieuLeTyrant/route-scout-vscode)
- **`.vsix`** from [GitHub Releases](https://github.com/mathieuletyrant/route-scout/releases) → *Extensions → Install from VSIX…*

Then open a spec file — a `⟶ N usages` lens appears above every operation, and Cmd/Ctrl+Click on an
operation jumps to its usages.

Prefer the terminal? The CLI ships on npm as
[`route-scout-cli`](https://www.npmjs.com/package/route-scout-cli) (the command it installs is
`route-scout`):

```bash
# zero config (auto-discovers specs + scans common sources)
npx route-scout-cli

# which endpoints are never called?
npx route-scout-cli --unused-only

# or install it once, then use the `route-scout` command:
npm i -g route-scout-cli
route-scout --unused-only
```

## How matching works

Each `usage` matcher has a `template` expanded per operation, with placeholders:

| Placeholder                                            | `getUserById`, `GET /users/{id}`                       |
| ------------------------------------------------------ | ------------------------------------------------------ |
| `{operationId}` / `{OperationId}`                      | `getUserById` / `GetUserById`                          |
| `{operationId:camel\|pascal\|kebab\|snake\|constant}`  | `getUserById` / `GetUserById` / `get-user-by-id` / `get_user_by_id` / `GET_USER_BY_ID` |
| `{method}` / `{METHOD}`                                | `get` / `GET`                                          |
| `{path}` / `{pathRegex}`                               | `/users/{id}` / `/users/[^/]+`                         |

- `symbol` matchers match a **whole identifier** (fast; the default).
- `regex` matchers match a **regular expression** per line (values auto-escaped; `{pathRegex}` raw).

Defaults target the common case:

```json
[
  { "kind": "symbol", "template": "{operationId}" },
  { "kind": "symbol", "template": "use{OperationId}" }
]
```

Imports are masked before matching (multi-line aware, `ignoreImports` — on by default), so bringing a
symbol into scope never counts as usage.

### What it does and doesn't do

Route Scout matches by convention, not by type resolution — it's fast, language-agnostic, and honest
about being a heuristic. `operationId`s are usually distinctive enough that collisions are rare; tune
the matchers to your codebase. When a name still collides with something unrelated (e.g. an Apollo
`const [getDevice] = useGetDeviceLazyQuery()`), enable **`importAware`** to only count identifiers that
were actually imported (optionally restricted to your generated-client modules via `importFrom`). It
does not follow re-exports or resolve dynamic URLs. Operations with no `operationId` can only be matched
by `regex`/`{path}` matchers.

## Example: Nx monorepo with Orval clients

A real-world `routescout.config.json` for a monorepo whose specs live under `packages/openapi-specs/`
and whose consumers are React apps (react-query hooks) plus server-to-server callers. The key is
**excluding the generated client code** so the generated definitions aren't counted as usage — the
default `{operationId}` / `use{OperationId}` matchers then cover both hooks and `.op(...)` calls:

```json
{
  "$schema": "https://raw.githubusercontent.com/mathieuletyrant/route-scout/refs/heads/main/schema.json",
  "specs": ["packages/openapi-specs/*-openapi.json"],
  "sources": ["apps/**/src/**/*.{ts,tsx}"],
  "exclude": [
    "**/node_modules/**",
    "**/dist/**",
    "**/dist_server/**",
    "**/dist_react/**",
    "**/out-tsc/**",
    "**/.nx/cache/**",
    "**/__generated__/**",
    "**/*-client/**",
    "**/*.schemas.ts",
    "**/*.msw.ts",
    "**/*.zod.ts"
  ],
  "usage": [
    { "kind": "symbol", "template": "{operationId}" },
    { "kind": "symbol", "template": "use{OperationId}" }
  ]
}
```

In the VSCode extension, drop this file at the repo root and set `"routeScout.configFile":
"routescout.config.json"` in `.vscode/settings.json`. The CLI auto-discovers it.

## Development

```bash
pnpm install
pnpm build        # builds core → cli → vscode (topological)
pnpm test         # vitest (core)
pnpm typecheck
pnpm lint
pnpm package:vscode   # produces packages/vscode/route-scout.vsix
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed [MIT](LICENSE).
