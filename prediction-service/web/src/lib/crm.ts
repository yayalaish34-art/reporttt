import { api } from './api';

/** A CRM customer, shaped for the recipient lines of a report. */
export interface Customer {
  id: string;
  kind: 'company' | 'private';
  contactName: string;
  contactTitle: string;
  companyName: string;
  addressLine: string;
  city: string;
  phone: string;
  email: string;
  updatedAt: string;
}

export interface CrmContact {
  id: string;
  fullName: string;
  roleTitle: string;
  phone: string;
  email: string;
  isPrimary: boolean;
}

/** Search over the CRM itself. An unreachable CRM finds nothing rather than failing the form. */
export async function findCustomers(query: string, limit = 15): Promise<Customer[]> {
  return api<Customer[]>(`/crm/customers?q=${encodeURIComponent(query)}&limit=${limit}`).catch(() => []);
}

export async function freshCustomer(customerId: string): Promise<Customer | null> {
  return api<Customer>(`/crm/customers/${encodeURIComponent(customerId)}`).catch(() => null);
}

export async function customerContacts(customerId: string): Promise<CrmContact[]> {
  return api<CrmContact[]>(`/crm/customers/${encodeURIComponent(customerId)}/contacts`).catch(() => []);
}
