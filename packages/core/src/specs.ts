import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { HTTP_METHODS, type HttpMethod, type Operation } from './types.js';

const METHOD_SET = new Set<string>(HTTP_METHODS);

interface RawOperation {
  operationId?: unknown;
  summary?: unknown;
  tags?: unknown;
}

interface RawSpec {
  paths?: Record<string, Record<string, RawOperation> | undefined>;
}

function parseDocument(file: string, content: string): RawSpec {
  const isJson = /\.json$/i.test(file);
  const doc: unknown = isJson ? JSON.parse(content) : parseYaml(content);
  return (doc && typeof doc === 'object' ? doc : {}) as RawSpec;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : [];
}

/** Read one spec file and flatten its `paths` into operations. `relFile` is used verbatim in output. */
export async function loadSpec(root: string, relFile: string): Promise<Operation[]> {
  const content = await readFile(join(root, relFile), 'utf8');
  const spec = parseDocument(relFile, content);
  const operations: Operation[] = [];

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    if (!methods || typeof methods !== 'object') continue;
    for (const [rawMethod, op] of Object.entries(methods)) {
      const method = rawMethod.toLowerCase();
      if (!METHOD_SET.has(method)) continue;
      operations.push({
        specFile: relFile,
        method: method as HttpMethod,
        path,
        operationId: asString(op?.operationId),
        summary: asString(op?.summary),
        tags: asTags(op?.tags),
      });
    }
  }
  return operations;
}

/** Read every spec file (relative to `root`) and concatenate their operations. */
export async function loadOperations(root: string, relFiles: string[]): Promise<Operation[]> {
  const perFile = await Promise.all(relFiles.map((file) => loadSpecSafe(root, file)));
  return perFile.flat();
}

async function loadSpecSafe(root: string, relFile: string): Promise<Operation[]> {
  try {
    return await loadSpec(root, relFile);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`route-scout: failed to parse spec "${relFile}": ${reason}`);
  }
}
