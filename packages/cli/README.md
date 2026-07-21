# route-scout (CLI)

Find where each OpenAPI endpoint is used across your codebase.

Published on npm as [`@route-scout/cli`](https://www.npmjs.com/package/@route-scout/cli) (the command is
`route-scout`):

```bash
npx @route-scout/cli --specs 'api/**/*.openapi.json' --sources 'src/**/*.{ts,tsx}'
# or install it: npm i -g @route-scout/cli   →  route-scout --help
```

Or build from this repo:

```bash
pnpm install && pnpm build
node packages/cli/dist/cli.js --specs 'api/**/*.openapi.json' --sources 'src/**/*.{ts,tsx}'
# or, from the workspace: pnpm --filter @route-scout/cli exec route-scout …
```

## Examples

```bash
# Zero-config: auto-discovers openapi specs + scans common source files.
route-scout

# Which endpoints are never called? (dead-endpoint hunt)
route-scout --unused-only

# Where is one spec consumed, as Markdown?
route-scout --spec petstore --format md --out usage.md

# Custom "usage": raw fetch() call sites keyed by path.
route-scout --usage-regex "fetch\\(['\"]{path}['\"]"
```

## Config file

Drop a `routescout.config.json` (or `.js`/`.mjs`) at the repo root:

```jsonc
{
  "specs": ["api/**/*.openapi.json"],
  "sources": ["apps/**/src/**/*.{ts,tsx}"],
  "exclude": ["**/*.generated.ts"],
  "usage": [
    { "kind": "symbol", "template": "{operationId}" },
    { "kind": "symbol", "template": "use{OperationId}" }
  ]
}
```

`.js`/`.mjs` configs can use `defineConfig` from `@route-scout/core` for types. CLI flags override the
file. Run `route-scout --help` for the full flag list and placeholder reference.
