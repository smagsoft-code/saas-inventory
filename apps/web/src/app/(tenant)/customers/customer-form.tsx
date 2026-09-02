'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  CUSTOMER_ADDRESS_FIELDS,
  CUSTOMER_ADDRESS_FIELD_LABELS,
  CUSTOMER_STATUSES,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type Customer,
  type CustomerAddressField,
  type CustomerStatus,
  type CustomerType,
} from '../../../lib/types/sales';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const CUSTOMERS_PATH = '/api/v1/customers';

/**
 * Create / edit one customer. `POST /customers` (`CreateCustomerDto`) or `PATCH /customers/:id`
 * (`UpdateCustomerDto`) — both `sales.customers.manage`. Never sends `tenantId`. `taxId` is unique
 * per tenant → a 409 is surfaced in place. A complete record (taxId + email + phone + address) is
 * what a sale needs at checkout (012-A) — the form nudges toward it but does not force it here.
 */
export function CustomerForm({
  mode,
  customer,
}: {
  mode: 'create' | 'edit';
  customer?: Customer;
}): React.JSX.Element {
  const router = useRouter();
  const initialAddress = (customer?.address ?? {}) as Record<string, unknown>;

  const [type, setType] = useState<CustomerType>((customer?.type as CustomerType) ?? 'individual');
  const [displayName, setDisplayName] = useState(customer?.displayName ?? '');
  const [taxId, setTaxId] = useState(customer?.taxId ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [notes, setNotes] = useState(customer?.notes ?? '');
  const [status, setStatus] = useState<CustomerStatus>((customer?.status as CustomerStatus) ?? 'active');
  const [address, setAddress] = useState<Record<CustomerAddressField, string>>(() => {
    const seed = {} as Record<CustomerAddressField, string>;
    for (const key of CUSTOMER_ADDRESS_FIELDS) {
      seed[key] = typeof initialAddress[key] === 'string' ? (initialAddress[key] as string) : '';
    }
    return seed;
  });

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return displayName.trim().length > 0;
    }
    const addressChanged = CUSTOMER_ADDRESS_FIELDS.some(
      (key) => address[key].trim() !== (typeof initialAddress[key] === 'string' ? initialAddress[key] : ''),
    );
    return (
      type !== customer?.type ||
      displayName !== (customer?.displayName ?? '') ||
      taxId !== (customer?.taxId ?? '') ||
      email !== (customer?.email ?? '') ||
      phone !== (customer?.phone ?? '') ||
      notes !== (customer?.notes ?? '') ||
      status !== customer?.status ||
      addressChanged
    );
  }, [mode, type, displayName, taxId, email, phone, notes, status, address, customer, initialAddress]);

  function nonEmptyAddress(): Record<string, string> | undefined {
    const entries = CUSTOMER_ADDRESS_FIELDS.map((key) => [key, address[key].trim()]).filter(([, v]) => v !== '');
    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (displayName.trim().length < 1 || displayName.trim().length > 200) {
      next['displayName'] = 'A name of 1–200 characters is required.';
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next['email'] = 'Enter a valid email address.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = { type, displayName: displayName.trim() };
        if (taxId.trim()) body['taxId'] = taxId.trim();
        if (email.trim()) body['email'] = email.trim();
        if (phone.trim()) body['phone'] = phone.trim();
        if (notes.trim()) body['notes'] = notes.trim();
        const addr = nonEmptyAddress();
        if (addr) body['address'] = addr;
        const created = await apiFetch<Customer>(CUSTOMERS_PATH, { method: 'POST', body });
        router.push(`/customers/${created.id}`);
        router.refresh();
        return;
      }

      const body: Record<string, unknown> = {};
      if (type !== customer?.type) body['type'] = type;
      if (displayName !== (customer?.displayName ?? '')) body['displayName'] = displayName.trim();
      if (taxId !== (customer?.taxId ?? '')) body['taxId'] = taxId.trim();
      if (email !== (customer?.email ?? '')) body['email'] = email.trim();
      if (phone !== (customer?.phone ?? '')) body['phone'] = phone.trim();
      if (notes !== (customer?.notes ?? '')) body['notes'] = notes.trim();
      if (status !== customer?.status) body['status'] = status;
      const addressChanged = CUSTOMER_ADDRESS_FIELDS.some(
        (key) => address[key].trim() !== (typeof initialAddress[key] === 'string' ? initialAddress[key] : ''),
      );
      if (addressChanged) body['address'] = nonEmptyAddress() ?? {};

      await apiFetch<Customer>(`${CUSTOMERS_PATH}/${customer!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setError('Another customer already uses that tax id.');
      } else if (isApiError(err) && err.status === 403) {
        setError('You no longer have permission to make this change.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" required>
          <Select value={type} onChange={(e) => { setType(e.target.value as CustomerType); setSuccess(false); }}>
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        {mode === 'edit' && (
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value as CustomerStatus); setSuccess(false); }}>
              {CUSTOMER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <Field label="Name" required {...(fieldError['displayName'] ? { error: fieldError['displayName'] } : {})}>
        <Input
          required
          maxLength={200}
          value={displayName}
          onChange={(e) => { setDisplayName(e.target.value); setSuccess(false); }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Tax id" hint="Unique within this company.">
          <Input maxLength={50} value={taxId} onChange={(e) => { setTaxId(e.target.value); setSuccess(false); }} />
        </Field>
        <Field label="Email" {...(fieldError['email'] ? { error: fieldError['email'] } : {})}>
          <Input type="email" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setSuccess(false); }} />
        </Field>
        <Field label="Phone">
          <Input maxLength={40} value={phone} onChange={(e) => { setPhone(e.target.value); setSuccess(false); }} />
        </Field>
      </div>

      <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
        <legend className="px-1 text-sm font-medium text-slate-700">Address</legend>
        {CUSTOMER_ADDRESS_FIELDS.map((key) => (
          <Field key={key} label={CUSTOMER_ADDRESS_FIELD_LABELS[key]}>
            <Input
              maxLength={200}
              value={address[key]}
              onChange={(e) => {
                setAddress((cur) => ({ ...cur, [key]: e.target.value }));
                setSuccess(false);
              }}
            />
          </Field>
        ))}
      </fieldset>

      <Field label="Notes">
        <Input maxLength={2000} value={notes} onChange={(e) => { setNotes(e.target.value); setSuccess(false); }} />
      </Field>

      <p className="text-xs text-slate-500">
        A sale needs the customer&apos;s tax id, email, phone and address — complete them here to
        avoid a checkout error.
      </p>

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Customer saved.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Create customer' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push('/customers')}>
          Back to customers
        </Button>
      </div>
    </form>
  );
}
