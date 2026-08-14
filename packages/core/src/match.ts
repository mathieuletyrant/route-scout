/** `true` when `pattern` matches `str`: glob semantics if it contains `*`, else substring. */
export function patternMatches(pattern: string, str: string): boolean {
  if (!pattern.includes('*')) return str.includes(pattern);
  const re = new RegExp(
    pattern
      .split('*')
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*'),
  );
  return re.test(str);
}

/** `true` when any pattern matches — or when there is no pattern to satisfy. */
export function anyPatternMatches(patterns: string[] | null, str: string): boolean {
  return patterns === null || patterns.some((p) => patternMatches(p, str));
}

export const asArray = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
