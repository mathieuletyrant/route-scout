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

// `import … from '…'` / `export … from '…'` (incl. multi-line), and side-effect
// `import '…'`. `[^;]` spans newlines but stops at a statement boundary so a
// from-less line can't swallow the next statement.
const IMPORT_PATTERNS = [
  /(^|\n)([ \t]*(?:import|export)\b[^;]*?\bfrom\b[ \t]*['"][^'"\n]*['"][ \t]*;?)/g,
  /(^|\n)([ \t]*import[ \t]+['"][^'"\n]*['"][ \t]*;?)/g,
];

const blankNonNewline = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * Blank out import / re-export statements while preserving line and column
 * positions, so identifiers that only appear in an import don't count as usage.
 */
export function maskImports(content: string): string {
  let masked = content;
  for (const pattern of IMPORT_PATTERNS) {
    masked = masked.replace(
      pattern,
      (_match, lead: string, body: string) => lead + blankNonNewline(body),
    );
  }
  return masked;
}

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
  previewContent: string = content,
): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  const previewLines = previewContent.split(/\r?\n/);
  const hasSymbols = matchers.symbols.size > 0;
  const hasRegexes = matchers.regexes.length > 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNumber = i + 1;
    const previewLine = previewLines[i] ?? line;

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
              preview: preview(previewLine),
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
              preview: preview(previewLine),
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
