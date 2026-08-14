import type { UsageMatcher } from './config.js';
import { asArray } from './match.js';
import { expandTemplate } from './placeholders.js';
import type { Operation } from './types.js';

/** A reference back to the operation (by index) and the matcher that produced a hit. */
export interface MatchRef {
  op: number;
  template: string;
  /** Index into {@link CompiledMatchers.scopes}; `-1` when the matcher applies everywhere. */
  scope: number;
}

export interface RegexMatcher extends MatchRef {
  regex: RegExp;
  /** A literal substring that must be present for the regex to match; used as a fast pre-filter. */
  anchor: string | null;
}

/** One file-scoped matcher: the files it applies to, and its per-operation regexes. */
export interface MatcherScope {
  files: string[];
  regexes: RegexMatcher[];
}

export interface CompiledMatchers {
  /** identifier -> operations/matchers that expand to exactly that identifier. */
  symbols: Map<string, MatchRef[]>;
  /** one entry per (operation, unscoped regex matcher). */
  regexes: RegexMatcher[];
  /**
   * File-scoped matchers, grouped so a scan resolves them **once per file**
   * (one pattern test per scope) instead of once per file per operation.
   */
  scopes: MatcherScope[];
}

/**
 * Derive a literal substring guaranteed to appear in every match of `pattern`,
 * usable as a cheap `String.includes` pre-filter. Returns `null` when no sound
 * anchor can be extracted (the regex must then always be run).
 */
function deriveAnchor(pattern: string): string | null {
  // Alternation means no single substring is guaranteed across all branches.
  if (pattern.includes('|')) return null;

  let best = '';
  let current = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i]!;
    const next = pattern[i + 1];
    const isQuantified = next === '?' || next === '*' || next === '{';
    if (/[A-Za-z0-9_/-]/.test(char) && !isQuantified) {
      current += char;
      if (current.length > best.length) best = current;
    } else {
      current = '';
    }
  }
  return best.length >= 4 ? best : null;
}

export function compileMatchers(operations: Operation[], usage: UsageMatcher[]): CompiledMatchers {
  const symbols = new Map<string, MatchRef[]>();
  const regexes: RegexMatcher[] = [];

  // One scope per file-scoped matcher, allocated once (not once per operation).
  const scopes: MatcherScope[] = [];
  const scopeOf = usage.map((matcher) => {
    if (!matcher.files) return -1;
    return scopes.push({ files: asArray(matcher.files), regexes: [] }) - 1;
  });

  operations.forEach((operation, op) => {
    usage.forEach((matcher, index) => {
      const scope = scopeOf[index] ?? -1;
      if (matcher.kind === 'symbol') {
        const symbol = expandTemplate(matcher.template, operation, 'literal');
        if (!symbol) return;
        const refs = symbols.get(symbol) ?? [];
        refs.push({ op, template: matcher.template, scope });
        symbols.set(symbol, refs);
      } else {
        const body = expandTemplate(matcher.template, operation, 'regex');
        if (!body) return;
        const flags = dedupeFlags(`g${matcher.flags ?? ''}`);
        const compiled: RegexMatcher = {
          op,
          template: matcher.template,
          scope,
          regex: new RegExp(body, flags),
          anchor: deriveAnchor(body),
        };
        if (scope < 0) regexes.push(compiled);
        else scopes[scope]!.regexes.push(compiled);
      }
    });
  });

  return { symbols, regexes, scopes };
}

function dedupeFlags(flags: string): string {
  return [...new Set(flags.split(''))].join('');
}
