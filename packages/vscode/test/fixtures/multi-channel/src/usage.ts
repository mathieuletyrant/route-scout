import { getInvoice } from '../generated/orders-client';
import { useGetInvoice } from '../generated/orders-hooks';

// A generated-client call and a react-query hook, both keyed on the operationId
// `getInvoice` — which exists on four endpoints (orders/billing × api/internal).
export async function loadInvoice(id: string) {
  return getInvoice(id);
}

export function InvoicePanel(id: string) {
  return useGetInvoice(id);
}
