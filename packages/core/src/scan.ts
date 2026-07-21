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

const IMPORT_FROM = /(?:^|\n)[ \t]*import\s+([^;]*?)\bfrom\b\s*['"]([^'"\n]+)['"]/g;
const NAMESPACE = /\*\s*as\s+([A-Za-z_$][\w$]*)/;
const DEFAULT_IMPORT = /^([A-Za-z_$][\w$]*)\s*(?:,|$)/;
const NAMED_ALIAS = /\bas\s+([A-Za-z_$][\w$]*)/;
const LEADING_IDENT = /^([A-Za-z_$][\w$]*)/;

/** One `import … from '<module>'` statement: the local names it binds + the module specifier. */
export interface ParsedImport {
  module: string;
  idents: string[];
}

/**
 * Parse `import … from '<module>'` statements into their bound local identifiers
 * and module specifier (type-only specifiers skipped). Feeds client-linking:
 * the caller resolves each `module` and decides which identifiers/files are
 * bound to a generated client.
 */
export function parseImports(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  IMPORT_FROM.lastIndex = 0;
  for (let m = IMPORT_FROM.exec(content); m !== null; m = IMPORT_FROM.exec(content)) {
    const module = m[2] ?? '';
    const idents = new Set<string>();
    const body = (m[1] ?? '').replace(/^\s*type\s+/, '').trim();
    idents.add(NAMESPACE.exec(body)?.[1] ?? '');
    if (!body.startsWith('{') && !body.startsWith('*')) {
      idents.add(DEFAULT_IMPORT.exec(body)?.[1] ?? '');
    }
    const braces = /\{([^}]*)\}/.exec(body);
    if (braces?.[1]) {
      for (const raw of braces[1].split(',')) {
        const part = raw.trim();
        if (!part || /^type\s/.test(part)) continue;
        idents.add(NAMED_ALIAS.exec(part)?.[1] ?? LEADING_IDENT.exec(part)?.[1] ?? '');
      }
    }
    idents.delete('');
    imports.push({ module, idents: [...idents] });
  }
  return imports;
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
  keep?: (op: number, identifier: string | null) => boolean,
): Hit[] {
  const hits: Hit[] = [];
  const lines = content.split(/\r?\n/);
  const previewLines = previewContent.split(/\r?\n/);
  const hasSymbols = matchers.symbols.size > 0;
  const hasRegexes = matchers.regexes.length > 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (ignoreLines.some((re) => re.test(line))) continue;

    const lineNumber = i + 1;
    // Computed once per line (not per hit) and from the original (unmasked) text.
    const linePreview = preview(previewLines[i] ?? line);

    if (hasSymbols) {
      IDENTIFIER.lastIndex = 0;
      for (let token = IDENTIFIER.exec(line); token !== null; token = IDENTIFIER.exec(line)) {
        const refs = matchers.symbols.get(token[0]);
        if (!refs) continue;
        for (const ref of refs) {
          if (keep && !keep(ref.op, token[0])) continue;
          hits.push({
            op: ref.op,
            site: {
              file: relFile,
              line: lineNumber,
              column: token.index + 1,
              preview: linePreview,
              matcher: ref.template,
            },
          });
        }
      }
    }

    if (hasRegexes) {
      for (const matcher of matchers.regexes) {
        if (matcher.anchor && !line.includes(matcher.anchor)) continue;
        if (keep && !keep(matcher.op, null)) continue;
        matcher.regex.lastIndex = 0;
        for (let m = matcher.regex.exec(line); m !== null; m = matcher.regex.exec(line)) {
          hits.push({
            op: matcher.op,
            site: {
              file: relFile,
              line: lineNumber,
              column: m.index + 1,
              preview: linePreview,
              matcher: matcher.template,
            },
          });
          if (m[0].length === 0) matcher.regex.lastIndex += 1;
        }
      }
    }
  }

  return hits;
}
