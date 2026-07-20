import type { CompiledMatchers } from './patterns.js';
import type { CallSite } from './types.js';

/** A call site plus the index of the operation it belongs to. */
export interface Hit {
  op: number;
  site: CallSite;
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const MAX_PREVIEW = 200;

const preview = (line: string): string => {
  const trimmed = line.trim();
  return trimmed.length > MAX_PREVIEW ? `${trimmed.slice(0, MAX_PREVIEW)}…` : trimmed;
};

/**
 * Scan a single file's content and yield every matcher hit.
 *
 * `symbol` matchers are resolved by tokenizing each line into identifiers and
 * looking them up — O(tokens). `regex` matchers run per compiled entry, gated
 * by a literal-substring pre-filter when one could be derived.
 */
export function scanContent(
  relFile: string,
  content: string,
  matchers: CompiledMatchers,
  ignoreLines: RegExp[] = [],
): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  const hasSymbols = matchers.symbols.size > 0;
  const hasRegexes = matchers.regexes.length > 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNumber = i + 1;

    if (ignoreLines.some((re) => re.test(line))) continue;

    if (hasSymbols) {
      IDENTIFIER.lastIndex = 0;
      for (let token = IDENTIFIER.exec(line); token !== null; token = IDENTIFIER.exec(line)) {
        const refs = matchers.symbols.get(token[0]);
        if (!refs) continue;
        for (const ref of refs) {
          hits.push({
            op: ref.op,
            site: {
              file: relFile,
              line: lineNumber,
              column: token.index + 1,
              preview: preview(line),
              matcher: ref.template,
            },
          });
        }
      }
    }

    if (hasRegexes) {
      for (const matcher of matchers.regexes) {
        if (matcher.anchor && !line.includes(matcher.anchor)) continue;
        matcher.regex.lastIndex = 0;
        for (
          let match = matcher.regex.exec(line);
          match !== null;
          match = matcher.regex.exec(line)
        ) {
          hits.push({
            op: matcher.op,
            site: {
              file: relFile,
              line: lineNumber,
              column: match.index + 1,
              preview: preview(line),
              matcher: matcher.template,
            },
          });
          if (match[0].length === 0) matcher.regex.lastIndex += 1;
        }
      }
    }
  }

  return hits;
}
