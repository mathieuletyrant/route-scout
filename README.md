# Route Scout 🧭

> Find where each OpenAPI endpoint is used across your codebase.

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
| [`route-scout`](packages/cli)                  | CLI — reports, `--unused-only`, JSON/Markdown for CI.   |
| [`route-scout-vscode`](packages/vscode)        | VSCode extension — CodeLens, tree view, quick search.   |

## Quick start

```bash
# CLI, zero config (auto-discovers specs + scans common sources)
npx route-scout

# Which endpoints are never called?
npx route-scout --unused-only
```

Or install the **Route Scout** extension in VSCode and open a spec file — a `⟶ N usages` lens appears
above every operation.

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

### What it does and doesn't do

Route Scout matches by convention, not by type resolution — it's fast, language-agnostic, and honest
about being a heuristic. `operationId`s are usually distinctive enough that collisions are rare; tune
the matchers (and `ignoreLines`) to your codebase. It does not follow re-exports or resolve dynamic
URLs. Operations with no `operationId` can only be matched by `regex`/`{path}` matchers.

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
