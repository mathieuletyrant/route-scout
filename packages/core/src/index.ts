export type { BuildOptions, ProgressReporter } from './build.js';
export { buildIndex } from './build.js';
export type { ResolvedConfig, RouteScoutConfig, UsageMatcher } from './config.js';
export {
  DEFAULT_EXCLUDE,
  DEFAULT_IGNORE_LINES,
  DEFAULT_SOURCES,
  DEFAULT_SPECS,
  DEFAULT_USAGE,
  resolveConfig,
} from './config.js';
export { escapeRegExp, expandTemplate, pathToRegex, splitWords } from './placeholders.js';
export { loadOperations, loadSpec } from './specs.js';
export type {
  CallSite,
  EndpointUsage,
  HttpMethod,
  IndexResult,
  IndexStats,
  Operation,
} from './types.js';
export { HTTP_METHODS } from './types.js';

import type { RouteScoutConfig } from './config.js';

/** Identity helper for typed `routescout.config.{js,ts}` files. */
export function defineConfig(config: RouteScoutConfig): RouteScoutConfig {
  return config;
}
