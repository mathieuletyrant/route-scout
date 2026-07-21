// Server-to-server: a RELATIVE import of the BILLING generated client factory.
// `../__generated__/client.js` only identifies the server once resolved to
// `src/providers/billing/__generated__/client`. The call is a property access
// on the client instance, attributed via the file's client import.
import { getBillingApi } from '../__generated__/client.js';

const api = getBillingApi();

export function loadThing(id: string) {
  return api.getThing({ id });
}
