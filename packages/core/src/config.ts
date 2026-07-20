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
  };
}

function nonEmpty<T>(value: T[] | undefined): T[] | undefined {
  return value && value.length > 0 ? value : undefined;
}

function resolveRoot(root: string, cwd: string): string {
  return root.startsWith('/') ? root : `${cwd}/${root}`;
}
