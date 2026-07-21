import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { glob } from 'tinyglobby';

import { type RouteScoutConfig, resolveConfig } from './config.js';
import { compileMatchers } from './patterns.js';
import { importedSymbols, maskImports, scanContent } from './scan.js';
import { loadOperations } from './specs.js';
import type { CallSite, EndpointUsage, IndexResult, Operation } from './types.js';

/** Progress callback, invoked as source files are scanned. */
export type ProgressReporter = (done: number, total: number) => void;

export interface BuildOptions {
  onProgress?: ProgressReporter;
  /** Max files read/scanned concurrently. Default 32. */
  concurrency?: number;
}

const toPosix = (p: string): string => p.split('\\').join('/');

/**
 * Discover specs and source files, then map every OpenAPI operation to its
 * usage sites. Pure with respect to the config: given the same tree it returns
 * the same result. All paths in the result are relative to `result.root`.
 */
export async function buildIndex(
  config: RouteScoutConfig,
  options: BuildOptions = {},
): Promise<IndexResult> {
  const resolved = resolveConfig(config);
  const { root } = resolved;

  const specFiles = (
    await glob(resolved.specs, { cwd: root, ignore: resolved.exclude, dot: false })
  ).map(toPosix);
  const operations = await loadOperations(root, specFiles);
  const matchers = compileMatchers(operations, resolved.usage);
  const ignoreLines = resolved.ignoreLines.map((pattern) => new RegExp(pattern));

  const sourceFiles = (
    await glob(resolved.sources, { cwd: root, ignore: resolved.exclude, dot: false })
  ).map(toPosix);

  const callSitesByOp = new Map<number, CallSite[]>();
  let done = 0;

  await mapLimit(sourceFiles, options.concurrency ?? 32, async (relFile) => {
    const content = await readFile(join(root, relFile), 'utf8');
    const matchContent = resolved.ignoreImports ? maskImports(content) : content;
    // Parse imports from the original content (before masking) to gate symbols.
    const allowed = resolved.importAware
      ? importedSymbols(content, resolved.importFrom)
      : undefined;
    for (const hit of scanContent(relFile, matchContent, matchers, ignoreLines, content, allowed)) {
      const list = callSitesByOp.get(hit.op) ?? [];
      list.push(hit.site);
      callSitesByOp.set(hit.op, list);
    }
    done += 1;
    options.onProgress?.(done, sourceFiles.length);
  });

  const endpoints = buildEndpoints(operations, callSitesByOp);

  const usedOperations = endpoints.filter((e) => e.callSites.length > 0).length;
  const totalCallSites = endpoints.reduce((sum, e) => sum + e.callSites.length, 0);

  return {
    root,
    endpoints,
    files: { specs: specFiles, sources: sourceFiles },
    stats: {
      specFiles: specFiles.length,
      operations: operations.length,
      sourceFiles: sourceFiles.length,
      usedOperations,
      unusedOperations: operations.length - usedOperations,
      totalCallSites,
    },
  };
}

function buildEndpoints(
  operations: Operation[],
  callSitesByOp: Map<number, CallSite[]>,
): EndpointUsage[] {
  const endpoints = operations.map((operation, index) => ({
    operation,
    callSites: dedupeSites(callSitesByOp.get(index) ?? []),
  }));

  endpoints.sort(
    (a, b) =>
      a.operation.specFile.localeCompare(b.operation.specFile) ||
      a.operation.path.localeCompare(b.operation.path) ||
      a.operation.method.localeCompare(b.operation.method),
  );
  return endpoints;
}

/** Collapse multiple hits on the same (file, line) into one call site (earliest column wins). */
function dedupeSites(sites: CallSite[]): CallSite[] {
  const byKey = new Map<string, CallSite>();
  for (const site of sites) {
    const key = `${site.file}:${site.line}`;
    const existing = byKey.get(key);
    if (!existing || site.column < existing.column) byKey.set(key, site);
  }
  return [...byKey.values()].sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

async function mapLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}
