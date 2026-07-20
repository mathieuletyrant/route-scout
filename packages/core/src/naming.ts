import type { Operation } from './types.js';

/**
 * Human-friendly server name for an operation: the spec's `info.title` when
 * present, otherwise the spec filename with the extension and any
 * `openapi`/`swagger` marker stripped (e.g. `tickets-server-openapi.json` →
 * `tickets-server`).
 */
export function serverName(operation: Pick<Operation, 'specTitle' | 'specFile'>): string {
  if (operation.specTitle) return operation.specTitle;
  const base = operation.specFile.split('/').pop() ?? operation.specFile;
  const stripped = base
    .replace(/\.(json|ya?ml)$/i, '')
    .replace(/[.\-_]?(openapi|swagger)$/i, '')
    .replace(/^(openapi|swagger)[.\-_]?/i, '');
  return stripped || base;
}
