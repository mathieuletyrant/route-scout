import type { UsageMatcher } from './config.js';
import { expandTemplate } from './placeholders.js';
import type { Operation } from './types.js';

/** A reference back to the operation (by index) and the matcher that produced a hit. */
export interface MatchRef {
  op: number;
  template: string;
}

export interface RegexMatcher extends MatchRef {
  regex: RegExp;
  /** A literal substring that must be present for the regex to match; used as a fast pre-filter. */
  anchor: string | null;
}

export interface CompiledMatchers {
  /** identifier -> operations/matchers that expand to exactly that identifier. */
  symbols: Map<string, MatchRef[]>;
  /** one entry per (operation, regex matcher). */
  regexes: RegexMatcher[];
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

  operations.forEach((operation, op) => {
    for (const matcher of usage) {
      if (matcher.kind === 'symbol') {
        const symbol = expandTemplate(matcher.template, operation, 'literal');
        if (!symbol) continue;
        const refs = symbols.get(symbol) ?? [];
        refs.push({ op, template: matcher.template });
        symbols.set(symbol, refs);
      } else {
        const body = expandTemplate(matcher.template, operation, 'regex');
        if (!body) continue;
        const flags = dedupeFlags(`g${matcher.flags ?? ''}`);
        regexes.push({
          op,
          template: matcher.template,
          regex: new RegExp(body, flags),
          anchor: deriveAnchor(body),
        });
      }
    }
  });

  return { symbols, regexes };
}

function dedupeFlags(flags: string): string {
  return [...new Set(flags.split(''))].join('');
}
