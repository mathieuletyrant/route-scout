# Route Scout — VSCode extension

**Find where each OpenAPI endpoint is used, right inside your editor.**

- **CodeLens** on your spec files: every operation gets a `⟶ N usages` lens. Click it to jump to any
  call site.
- **Endpoints view** (activity bar): browse every spec → operation → usage, and spot unused endpoints
  at a glance.
- **Find Endpoint** command: fuzzy-search across all operations by method, path, spec, or
  `operationId`, then jump to a usage.

Route Scout is spec-agnostic and framework-agnostic — you tell it which specs, which sources, and how a
usage looks.

## Configuration

All settings live under `routeScout.*` and are per-workspace-folder.

| Setting                | What it does                                                                 |
| ---------------------- | ---------------------------------------------------------------------------- |
| `routeScout.specs`     | Globs selecting your OpenAPI spec files.                                      |
| `routeScout.sources`   | Globs selecting the source files scanned for usage.                          |
| `routeScout.exclude`   | Globs excluded from discovery.                                               |
| `routeScout.usage`     | **How an endpoint appears in code** — a list of matchers (see below).        |
| `routeScout.ignoreLines` | Regexes for lines to skip (defaults skip `import` lines).                   |
| `routeScout.configFile`  | Path to a JSON config file that replaces the settings above.               |
| `routeScout.rebuildOnSave` | Re-index when a spec/source file is saved (default `true`).              |

### Usage matchers

Each matcher's `template` is expanded per operation. Placeholders:
`{operationId}`, `{OperationId}`, `{operationId:camel|pascal|kebab|snake|constant}`, `{method}`,
`{METHOD}`, `{path}`, `{pathRegex}`.

```jsonc
"routeScout.usage": [
  // A function named after the operationId (openapi-generator, orval, …)
  { "kind": "symbol", "template": "{operationId}" },
  // A react-query / swr / vue-query hook
  { "kind": "symbol", "template": "use{OperationId}" },
  // Raw fetch() calls keyed by URL path
  { "kind": "regex", "template": "fetch\\(['\"]{pathRegex}['\"]" }
]
```

- **`symbol`** matches a whole identifier (fast, precise for generated clients).
- **`regex`** matches a regular expression against each line; values are auto-escaped, `{pathRegex}`
  turns `{param}` segments into `[^/]+`.

## Commands

- **Route Scout: Find Endpoint / Show Usage**
- **Route Scout: Rebuild Index**

The engine is [`@route-scout/core`](https://github.com/mathieuletyrant/route-scout/tree/main/packages/core);
there's also a [`route-scout` CLI](https://github.com/mathieuletyrant/route-scout/tree/main/packages/cli)
for CI and dead-endpoint reports.
