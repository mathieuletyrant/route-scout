/** The HTTP methods route-scout recognizes in an OpenAPI document. */
export const HTTP_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A single OpenAPI operation, flattened out of the spec's `paths` tree. */
export interface Operation {
  /** Spec file the operation was read from, relative to the resolved root (posix separators). */
  specFile: string;
  /** Lowercase HTTP method. */
  method: HttpMethod;
  /** Templated path, e.g. `/users/{id}`. */
  path: string;
  /** `info.title` from the spec document, if any (used as the server display name). */
  specTitle: string | null;
  /** `operationId` from the spec, or `null` when the spec omits it. */
  operationId: string | null;
  /** `summary` from the spec, if any. */
  summary: string | null;
  /** `tags` from the spec (empty when none). */
  tags: string[];
}

/** One place in the source tree where an operation is used. */
export interface CallSite {
  /** File relative to the resolved root (posix separators). */
  file: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** The trimmed source line, for preview. */
  preview: string;
  /** The `template` of the matcher that produced this hit. */
  matcher: string;
}

/** An operation together with every call site that references it. */
export interface EndpointUsage {
  operation: Operation;
  callSites: CallSite[];
}

export interface IndexStats {
  specFiles: number;
  operations: number;
  sourceFiles: number;
  usedOperations: number;
  unusedOperations: number;
  totalCallSites: number;
}

/** The full result of {@link buildIndex}. */
export interface IndexResult {
  /** Absolute path every relative path in this result is resolved against. */
  root: string;
  endpoints: EndpointUsage[];
  stats: IndexStats;
}
