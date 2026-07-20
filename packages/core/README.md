# @route-scout/core

The engine behind [route-scout](https://github.com/mathieuletyrant/route-scout): given a set of
OpenAPI specs and a set of source globs, it maps every operation to the places it's used.

It's config-driven and language-agnostic — you tell it **which specs**, **which sources**, and **how a
usage looks** (the matchers). No AST, no framework coupling.

```ts
import { buildIndex } from '@route-scout/core';

const result = await buildIndex({
  root: process.cwd(),
  specs: ['api/**/*.openapi.json'],
  sources: ['src/**/*.{ts,tsx}'],
  usage: [
    { kind: 'symbol', template: '{operationId}' },
    { kind: 'symbol', template: 'use{OperationId}' },
  ],
});

for (const { operation, callSites } of result.endpoints) {
  console.log(operation.method, operation.path, '→', callSites.length);
}
```

## Matchers

A matcher describes one way an endpoint can appear in code. The `template` is expanded per operation.

| Placeholder                    | Example (`getUserById`, `GET /users/{id}`) |
| ------------------------------ | ------------------------------------------ |
| `{operationId}`                | `getUserById`                              |
| `{OperationId}`                | `GetUserById`                              |
| `{operationId:camel\|pascal\|kebab\|snake\|constant}` | `getUserById` / `GetUserById` / `get-user-by-id` / `get_user_by_id` / `GET_USER_BY_ID` |
| `{method}` / `{METHOD}`        | `get` / `GET`                              |
| `{path}`                       | `/users/{id}`                              |
| `{pathRegex}`                  | `/users/[^/]+` (regex matchers only)       |

- **`symbol`** — the expanded template is a single identifier; route-scout tokenizes each line and
  matches whole identifiers. Fast; the right default for generated clients.
- **`regex`** — the expanded template is a regular expression matched against each line. Values are
  regex-escaped automatically; `{pathRegex}` is injected raw.

`ignoreLines` (default: `import` / `export … from` lines) drops lines before matching, so imports don't
count as usage.

## API

- `buildIndex(config, options?) => Promise<IndexResult>`
- `resolveConfig(config, cwd?)`, `loadOperations`, `loadSpec`, `expandTemplate`, `defineConfig`
- Defaults: `DEFAULT_SPECS`, `DEFAULT_SOURCES`, `DEFAULT_EXCLUDE`, `DEFAULT_USAGE`, `DEFAULT_IGNORE_LINES`

See the [root README](../../README.md) for the CLI and VSCode extension.
