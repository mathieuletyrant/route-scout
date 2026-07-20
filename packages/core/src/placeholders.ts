import type { Operation } from './types.js';

/** Escape a string so it matches literally inside a RegExp. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Turn a templated path into a regex body, treating `{param}` as `[^/]+`. */
export function pathToRegex(path: string): string {
  return path
    .split(/\{[^}]+\}/)
    .map(escapeRegExp)
    .join('[^/]+');
}

/** Split an identifier into words across camelCase / snake / kebab / space boundaries. */
export function splitWords(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

const cap = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
const pascal = (words: string[]): string => words.map(cap).join('');
const camel = (words: string[]): string =>
  words.map((word, i) => (i === 0 ? word.toLowerCase() : cap(word))).join('');

type Resolved = { value: string; regexReady?: boolean };

function resolvePlaceholder(key: string, op: Operation): Resolved | null {
  switch (key) {
    case 'method':
      return { value: op.method };
    case 'METHOD':
      return { value: op.method.toUpperCase() };
    case 'Method':
      return { value: cap(op.method) };
    case 'path':
      return { value: op.path };
    case 'pathRegex':
      return { value: pathToRegex(op.path), regexReady: true };
  }

  const [base, transform] = key.split(':');
  if (base === 'operationId' || base === 'OperationId') {
    if (!op.operationId) return null;
    const words = splitWords(op.operationId);
    const kind = transform ?? (base === 'OperationId' ? 'pascal' : 'raw');
    switch (kind) {
      case 'raw':
        return { value: op.operationId };
      case 'camel':
        return { value: camel(words) };
      case 'pascal':
        return { value: pascal(words) };
      case 'kebab':
        return { value: words.map((w) => w.toLowerCase()).join('-') };
      case 'snake':
        return { value: words.map((w) => w.toLowerCase()).join('_') };
      case 'constant':
        return { value: words.map((w) => w.toUpperCase()).join('_') };
      default:
        return null;
    }
  }
  return null;
}

/**
 * Expand a matcher template against one operation.
 *
 * @param mode `literal` inserts placeholder values verbatim (for `symbol`
 *   matchers). `regex` regex-escapes each value, except `{pathRegex}` which is
 *   injected as a ready-made regex body.
 * @returns the expanded string, or `null` if the template needs a field the
 *   operation doesn't have (e.g. `{operationId}` on a spec op with no id) or
 *   references an unknown placeholder.
 */
export function expandTemplate(
  template: string,
  op: Operation,
  mode: 'literal' | 'regex',
): string | null {
  let unresolved = false;
  const expanded = template.replace(/\{([^}]+)\}/g, (_match, rawKey: string) => {
    const resolved = resolvePlaceholder(rawKey.trim(), op);
    if (!resolved) {
      unresolved = true;
      return '';
    }
    if (mode === 'literal') return resolved.value;
    return resolved.regexReady ? resolved.value : escapeRegExp(resolved.value);
  });
  return unresolved ? null : expanded;
}
