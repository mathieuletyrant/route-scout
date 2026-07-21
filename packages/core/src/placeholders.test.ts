import { describe, expect, it } from 'vitest';

import { escapeRegExp, expandTemplate, pathToRegex, splitWords } from './placeholders.js';
import type { Operation } from './types.js';

const op = (overrides: Partial<Operation> = {}): Operation => ({
  specFile: 'api.json',
  method: 'get',
  path: '/users/{id}',
  specTitle: null,
  operationId: 'getUserById',
  summary: null,
  tags: [],
  ...overrides,
});

describe('splitWords', () => {
  it('splits camelCase, snake, kebab and acronyms', () => {
    expect(splitWords('getUserById')).toEqual(['get', 'User', 'By', 'Id']);
    expect(splitWords('get_user_by_id')).toEqual(['get', 'user', 'by', 'id']);
    expect(splitWords('HTTPServerURL')).toEqual(['HTTP', 'Server', 'URL']);
  });
});

describe('pathToRegex', () => {
  it('turns path params into wildcard segments and escapes literals', () => {
    expect(pathToRegex('/users/{id}')).toBe('/users/[^/]+');
    expect(pathToRegex('/a.b/{x}/{y}')).toBe('/a\\.b/[^/]+/[^/]+');
  });
});

describe('escapeRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegExp('a.b(c)')).toBe('a\\.b\\(c\\)');
  });
});

describe('expandTemplate', () => {
  it('expands operationId case variants (literal mode)', () => {
    expect(expandTemplate('{operationId}', op(), 'literal')).toBe('getUserById');
    expect(expandTemplate('use{OperationId}', op(), 'literal')).toBe('useGetUserById');
    expect(expandTemplate('{operationId:constant}', op(), 'literal')).toBe('GET_USER_BY_ID');
    expect(expandTemplate('{operationId:kebab}', op(), 'literal')).toBe('get-user-by-id');
  });

  it('preserves acronym casing in PascalCase (matches generated hooks)', () => {
    const o = op({ operationId: 'createMDMControl' });
    expect(expandTemplate('{OperationId}', o, 'literal')).toBe('CreateMDMControl');
    expect(expandTemplate('use{OperationId}', o, 'literal')).toBe('useCreateMDMControl');
  });

  it('expands method and path placeholders', () => {
    expect(expandTemplate('{METHOD} {path}', op(), 'literal')).toBe('GET /users/{id}');
  });

  it('regex mode escapes values but injects pathRegex raw', () => {
    expect(expandTemplate('fetch\\("{path}"', op(), 'regex')).toBe('fetch\\("/users/\\{id\\}"');
    expect(expandTemplate('{pathRegex}', op(), 'regex')).toBe('/users/[^/]+');
  });

  it('returns null when operationId is required but missing', () => {
    expect(expandTemplate('use{OperationId}', op({ operationId: null }), 'literal')).toBeNull();
  });

  it('returns null for unknown placeholders', () => {
    expect(expandTemplate('{nope}', op(), 'literal')).toBeNull();
  });
});
