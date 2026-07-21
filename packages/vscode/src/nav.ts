// Pure navigation/disambiguation logic — no `vscode` import, so it can be
// unit-tested. The extension wraps these with editor UI (quickpicks, jumps).

import type { EndpointUsage, Operation } from '@route-scout/core';

/** An endpoint together with the workspace-folder root its paths resolve against. */
export interface Scouted {
  root: string;
  endpoint: EndpointUsage;
}

/** Where an operationId is declared (a `@ApiOperation`/`operationId:` line). */
export interface DeclLoc {
  root: string;
  file: string;
  line: number;
}

// Matches `operationId: 'x'` / "operationId": "x" — in an OpenAPI spec
// (JSON/YAML) and in NestJS `@ApiOperation({ operationId: 'x' })` decorators.
export const OPERATION_ID_LINE = /operationId["']?\s*:\s*["']([\w.\-/]+)["']/;

export const toPosix = (p: string): string => p.split('\\').join('/');

// Tokens that appear in nearly every spec/controller path and so can't identify
// a channel (api/internal) or server — dropped before scoring.
const NOISE = new Set([
  'openapi',
  'swagger',
  'spec',
  'specs',
  'json',
  'yaml',
  'yml',
  'controller',
  'controllers',
  'ts',
  'tsx',
  'js',
  'jsx',
  'src',
  'app',
  'apps',
  'packages',
  'dist',
  'index',
]);

const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const meaningfulTokens = (s: string): Set<string> =>
  new Set(tokenize(s).filter((t) => !NOISE.has(t)));

/**
 * Identity tokens for an endpoint: the channel (api/internal) and server, read
 * from its spec file name and title, plus the leading path segment. These are
 * what tell an `orders-internal` endpoint apart from a `billing-api` one — the
 * URL path alone can't (both are `/invoices/{id}`).
 */
export function endpointIdentity(
  op: Pick<Operation, 'specFile' | 'specTitle' | 'path'>,
): Set<string> {
  const tokens = meaningfulTokens(op.specFile);
  if (op.specTitle) for (const t of meaningfulTokens(op.specTitle)) tokens.add(t);
  const segment = op.path.split('/').find(Boolean);
  if (segment) for (const t of tokenize(segment)) tokens.add(t);
  return tokens;
}

const declarationScore = (file: string, identity: Set<string>): number => {
  let score = 0;
  for (const t of meaningfulTokens(file)) if (identity.has(t)) score += 1;
  return score;
};

export interface DeclChoice {
  /** The single best-matching declaration, or `null` when the choice is ambiguous. */
  best: DeclLoc | null;
  /** All candidates, best-first — what to offer the user to pick from when ambiguous. */
  ranked: DeclLoc[];
  /** True when no single declaration clearly wins (caller should prompt). */
  ambiguous: boolean;
}

/**
 * Choose the declaration (controller) an endpoint maps to. Scores each candidate
 * by how many of the endpoint's identity tokens (channel + server) its file path
 * contains, and returns a single winner only when one strictly outscores the
 * rest. Otherwise `ambiguous` is set so the caller can ask the user, instead of
 * silently jumping to an arbitrary one.
 */
export function pickDeclaration(decls: DeclLoc[], identity: Set<string>): DeclChoice {
  if (decls.length <= 1) {
    return { best: decls[0] ?? null, ranked: decls, ambiguous: false };
  }
  const scored = decls
    .map((decl) => ({ decl, score: declarationScore(decl.file, identity) }))
    .sort((a, b) => b.score - a.score);
  const ranked = scored.map((s) => s.decl);
  const top = scored[0]!;
  const second = scored[1]!;
  const decisive = top.score > 0 && top.score > second.score;
  return { best: decisive ? top.decl : null, ranked, ambiguous: !decisive };
}

/**
 * The same operationId can exist on several endpoints (e.g. the `api` and
 * `internal` channels, across servers). Narrow candidates to the one a document
 * is really about: an exact spec-file match, else identity-token overlap between
 * the endpoint and the document's path. Falls back to all when nothing wins.
 */
export function disambiguate(
  docFsPath: string,
  folderRelPath: string | undefined,
  candidates: Scouted[],
): Scouted[] {
  if (candidates.length <= 1) return candidates;

  if (folderRelPath !== undefined) {
    const inSpec = candidates.filter((s) => s.endpoint.operation.specFile === folderRelPath);
    if (inSpec.length > 0) return inSpec;
  }

  const tokens = meaningfulTokens(docFsPath);
  const scored = candidates
    .map((s) => {
      const id = endpointIdentity(s.endpoint.operation);
      let score = 0;
      for (const t of id) if (tokens.has(t)) score += 1;
      return { s, score };
    })
    .sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const second = scored[1]!;
  if (top.score > 0 && top.score > second.score) return [top.s];
  return candidates;
}

/** Every `operationId` declared in a `definitions` file, with its 1-based line. */
export function declarationsIn(text: string): Array<{ id: string; line: number }> {
  const out: Array<{ id: string; line: number }> = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const id = OPERATION_ID_LINE.exec(line)?.[1];
    if (id) out.push({ id, line: i + 1 });
  });
  return out;
}
