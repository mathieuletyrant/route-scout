/**
 * A usage matcher describes *one way* an endpoint can appear in source code.
 *
 * The `template` is expanded once per operation by substituting placeholders
 * (see {@link ./placeholders.ts}) with that operation's fields:
 *
 * - `{operationId}`  — as written in the spec (e.g. `getUserById`)
 * - `{OperationId}`  — PascalCase (e.g. `GetUserById`)
 * - `{operationId:constant}` / `:kebab` / `:snake` / `:camel` — cased variants
 * - `{method}` / `{METHOD}` — lower/upper HTTP method
 * - `{path}`         — raw templated path, e.g. `/users/{id}`
 * - `{pathRegex}`    — the path as a regex, with `{param}` segments turned into
 *                      `[^/]+` (only meaningful for `regex` matchers)
 *
 * `kind`:
 * - `symbol` — after expansion the template is a single identifier (e.g.
 *   `useGetUserById`). route-scout tokenizes each source line and matches whole
 *   identifiers. Fast and the right default for generated API clients.
 * - `regex`  — after expansion the template is a regular expression matched
 *   against each source line. Use it for raw URL / fetch-style call sites.
 */
export interface UsageMatcher {
  kind: 'symbol' | 'regex';
  template: string;
  /** Extra RegExp flags for `regex` matchers (always case-sensitive line scan otherwise). */
  flags?: string;
}

/**
 * A generated API client. When `clients` is non-empty, a call site only counts
 * as a usage if it is **linked to one of these clients**, and it is attributed
 * to the endpoints of that client's `spec` — so an `operationId` shared by
 * several endpoints (api/internal, or across servers) is resolved to the right
 * one, and code that merely reuses the name (a controller method, a local
 * service) is ignored.
 *
 * A call is linked to a client when the matched symbol was imported from one of
 * its `module`s, or (for property-access calls) when the file imports from one.
 */
export interface ClientConfig {
  /**
   * Import-path substring(s) — or glob(s) with `*` — identifying the client's
   * module. Matched against the import specifier for bare/alias imports
   * (`~/__generated__/mdm-server-client/…`) and against the **resolved**
   * repo-relative path for relative imports (`../__generated__/client.js`).
   */
  module: string | string[];
  /** Spec-filename substring(s)/glob(s) this client talks to (e.g. `mdm-server-openapi.json`). */
  spec: string | string[];
}

/** User-facing configuration. All globs are evaluated relative to {@link root}. */
export interface RouteScoutConfig {
  /** Base directory. Defaults to `process.cwd()`. */
  root?: string;
  /** Globs selecting the OpenAPI spec files. */
  specs?: string[];
  /** Globs selecting the source files to scan for usage. */
  sources?: string[];
  /** Globs excluded from both spec and source discovery. */
  exclude?: string[];
  /** How endpoints appear in the source. */
  usage?: UsageMatcher[];
  /**
   * When true (default), `import` / `export … from` / side-effect-import
   * statements are masked before matching (multi-line aware), so a symbol that
   * only appears in an import never counts as usage.
   */
  ignoreImports?: boolean;
  /**
   * Extra escape hatch: source lines matching any of these regexes are skipped
   * entirely. Empty by default — imports are handled by {@link ignoreImports}.
   */
  ignoreLines?: string[];
  /**
   * Generated API clients. **When non-empty, only calls linked to a declared
   * client count as usages**, attributed per the client's `spec`. When empty
   * (default), every matcher hit counts (no client gating).
   */
  clients?: ClientConfig[];
}

/** Config with every field filled in. */
export interface ResolvedConfig extends Required<Omit<RouteScoutConfig, 'root'>> {
  root: string;
}

export const DEFAULT_SPECS = [
  '**/openapi*.{json,yaml,yml}',
  '**/*.openapi.{json,yaml,yml}',
  '**/swagger*.{json,yaml,yml}',
];

export const DEFAULT_SOURCES = ['**/*.{ts,tsx,js,jsx,mjs,cjs,vue,svelte}'];

export const DEFAULT_EXCLUDE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.git/**',
];

/**
 * Default matchers target the near-universal convention of generated API
 * clients: a function named after the `operationId`, plus a `use<Op>` hook
 * (react-query / swr / vue-query / …).
 */
export const DEFAULT_USAGE: UsageMatcher[] = [
  { kind: 'symbol', template: '{operationId}' },
  { kind: 'symbol', template: 'use{OperationId}' },
];

export const DEFAULT_IGNORE_LINES: string[] = [];

export function resolveConfig(
  config: RouteScoutConfig,
  cwd: string = process.cwd(),
): ResolvedConfig {
  const root = config.root ? resolveRoot(config.root, cwd) : cwd;
  return {
    root,
    specs: nonEmpty(config.specs) ?? DEFAULT_SPECS,
    sources: nonEmpty(config.sources) ?? DEFAULT_SOURCES,
    exclude: config.exclude ?? DEFAULT_EXCLUDE,
    usage: nonEmpty(config.usage) ?? DEFAULT_USAGE,
    ignoreImports: config.ignoreImports ?? true,
    ignoreLines: config.ignoreLines ?? DEFAULT_IGNORE_LINES,
    clients: config.clients ?? [],
  };
}

function nonEmpty<T>(value: T[] | undefined): T[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function resolveRoot(root: string, cwd: string): string {
  return root.startsWith('/') ? root : `${cwd}/${root}`;
}
