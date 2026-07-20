import { describe, expect, it } from 'vitest';

import { serverName } from './naming.js';

describe('serverName', () => {
  it('prefers the spec title', () => {
    expect(serverName({ specTitle: 'Tickets API', specFile: 'tickets-server-openapi.json' })).toBe(
      'Tickets API',
    );
  });

  it('derives a name from the filename when there is no title', () => {
    expect(
      serverName({ specTitle: null, specFile: 'packages/specs/tickets-server-openapi.json' }),
    ).toBe('tickets-server');
    expect(serverName({ specTitle: null, specFile: 'petstore.openapi.json' })).toBe('petstore');
    expect(serverName({ specTitle: null, specFile: 'swagger.yaml' })).toBe('swagger.yaml');
  });
});
