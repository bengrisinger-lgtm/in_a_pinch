import { quoteFetch } from './quoteApi';

export type Customer = {
  id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  billing_address: string | null;
  site_address: string | null;
  created_at: string;
};

export function listCustomers(q?: string) {
  const qs = q?.trim() ? `?q=${encodeURIComponent(q.trim())}` : '';
  return quoteFetch<{ customers: Customer[] }>(`/customers${qs}`);
}

export function createCustomer(input: {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  billing_address?: string;
  site_address?: string;
}) {
  return quoteFetch<{ customer: Customer }>('/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateCustomer(
  id: string,
  input: Partial<{
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    billing_address: string;
    site_address: string;
  }>
) {
  return quoteFetch<{ customer: Customer }>(`/customers/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function deleteCustomer(id: string) {
  return quoteFetch<{ success: boolean }>(`/customers/${id}`, { method: 'DELETE' });
}

export function mergeCustomers(keepId: string, mergeId: string) {
  return quoteFetch<{ customer: Customer }>('/customers/merge', {
    method: 'POST',
    body: JSON.stringify({ keep_id: keepId, merge_id: mergeId }),
  });
}
