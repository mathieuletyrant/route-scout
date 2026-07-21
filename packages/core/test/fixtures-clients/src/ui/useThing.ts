// Alias import of a generated react-query hook from the ORDERS client.
// The module path (`__generated__/orders-client`) identifies the server.
import { useGetThing } from '~/__generated__/orders-client/things.js';

export function useThing() {
  return useGetThing();
}
