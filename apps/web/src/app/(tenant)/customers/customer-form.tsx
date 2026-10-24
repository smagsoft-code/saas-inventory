'use client';
import { HelpTip } from '../../../components/ui/help-tip';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  CUSTOMER_STATUSES,
  CUSTOMER_TAX_ID_HINTS,
  CUSTOMER_TYPES,
  CUSTOMER_TYPE_LABELS,
  type Customer,
  type CustomerStatus,
  type CustomerType,
} from '../../../lib/types/sales';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const CUSTOMERS_PATH = '/api/v1/customers';

/** Identification format per `type` (owner redesign) — mirrors `IsTaxIdForType` server-side. */
const TAX_ID_PATTERNS: Record<CustomerType, RegExp> = {
  cedula: /^\d{10}$/,
  ruc: /^\d{13}$/,
  pasaporte: /^[A-Za-z0-9]+$/,
};

const TAX_ID_ERRORS: Record<CustomerType, string> = {
  cedula: 'La cédula debe tener exactamente 10 números.',
  ruc: 'El RUC debe tener exactamente 13 números.',
  pasaporte: 'El pasaporte debe contener solo números y letras.',
};

/**
 * Create / edit one customer. `POST /customers` (`CreateCustomerDto`) or `PATCH /customers/:id`
 * (`UpdateCustomerDto`) — both `sales.customers.manage`. Never sends `tenantId`. `taxId` is
 * required and format-checked against `type`, and unique per tenant → a 409 is surfaced in place.
 */
export function CustomerForm({
  mode,
  customer,
  onCreated,
  onSaved,
  onCancel,
  initialTaxId,
}: {
  mode: 'create' | 'edit';
  customer?: Customer;
  /** When set (the sale-flow "Crear nuevo cliente" modal), a successful create calls this
   * instead of navigating to `/customers/:id` — the caller stays on its own page/modal and
   * decides what to do with the new customer (e.g. select it on the cart). Has no effect in
   * `edit` mode. */
  onCreated?: (customer: Customer) => void;
  /** Edit mode: called with the updated customer after a successful save (e.g. a modal closing itself). */
  onSaved?: (customer: Customer) => void;
  /** Overrides the "Volver a clientes" button when embedded outside `/customers/*` (e.g. the
   * sale-flow modal, which should just close instead of navigating away). */
  onCancel?: () => void;
  /** Prefills the identification field in `create` mode — the sale-flow search bar's "no
   * coincide, presiona Enter para crear" shortcut hands over whatever the owner already typed so
   * they don't retype it. No effect in `edit` mode (`customer.taxId` wins there). */
  initialTaxId?: string;
}): React.JSX.Element {
  const router = useRouter();

  const [type, setType] = useState<CustomerType>((customer?.type as CustomerType) ?? 'cedula');
  const [firstName, setFirstName] = useState(customer?.firstName ?? '');
  const [lastName, setLastName] = useState(customer?.lastName ?? '');
  const [taxId, setTaxId] = useState(customer?.taxId ?? initialTaxId ?? '');
  const [email, setEmail] = useState(customer?.email ?? '');
  const [phone, setPhone] = useState(customer?.phone ?? '');
  const [address, setAddress] = useState(customer?.address ?? '');
  const [status, setStatus] = useState<CustomerStatus>(
    (customer?.status as CustomerStatus) ?? 'active',
  );

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return firstName.trim().length > 0 || lastName.trim().length > 0 || taxId.trim().length > 0;
    }
    return (
      type !== customer?.type ||
      firstName !== (customer?.firstName ?? '') ||
      lastName !== (customer?.lastName ?? '') ||
      taxId !== (customer?.taxId ?? '') ||
      email !== (customer?.email ?? '') ||
      phone !== (customer?.phone ?? '') ||
      address !== (customer?.address ?? '') ||
      status !== customer?.status
    );
  }, [mode, type, firstName, lastName, taxId, email, phone, address, status, customer]);

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (firstName.trim().length < 1 || firstName.trim().length > 120) {
      next['firstName'] = 'Se requiere un nombre de 1–120 caracteres.';
    }
    if (lastName.trim().length < 1 || lastName.trim().length > 120) {
      next['lastName'] = 'Se requiere un apellido de 1–120 caracteres.';
    }
    if (!TAX_ID_PATTERNS[type].test(taxId.trim())) {
      next['taxId'] = TAX_ID_ERRORS[type];
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next['email'] = 'Ingresa un correo electrónico válido.';
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
        const body: Record<string, unknown> = {
          type,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          taxId: taxId.trim(),
        };
        if (email.trim()) body['email'] = email.trim();
        if (phone.trim()) body['phone'] = phone.trim();
        if (address.trim()) body['address'] = address.trim();
        const created = await apiFetch<Customer>(CUSTOMERS_PATH, { method: 'POST', body });
        if (onCreated) {
          onCreated(created);
          return;
        }
        router.push(`/customers/${created.id}`);
        router.refresh();
        return;
      }

      const body: Record<string, unknown> = {};
      if (type !== customer?.type) body['type'] = type;
      if (firstName !== (customer?.firstName ?? '')) body['firstName'] = firstName.trim();
      if (lastName !== (customer?.lastName ?? '')) body['lastName'] = lastName.trim();
      if (taxId !== (customer?.taxId ?? '')) body['taxId'] = taxId.trim();
      if (email !== (customer?.email ?? '')) body['email'] = email.trim();
      if (phone !== (customer?.phone ?? '')) body['phone'] = phone.trim();
      if (address !== (customer?.address ?? '')) body['address'] = address.trim();
      if (status !== customer?.status) body['status'] = status;

      const saved = await apiFetch<Customer>(`${CUSTOMERS_PATH}/${customer!.id}`, {
        method: 'PATCH',
        body,
      });
      setSuccess(true);
      onSaved?.(saved);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 409) {
        setError('Otro cliente ya usa esa identificación.');
      } else if (isApiError(err) && err.status === 403) {
        setError('Ya no tienes permiso para hacer este cambio.');
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
        <Field label="Tipo" required>
          <Select
            value={type}
            onChange={(e) => {
              setType(e.target.value as CustomerType);
              setSuccess(false);
            }}
          >
            {CUSTOMER_TYPES.map((t) => (
              <option key={t} value={t}>
                {CUSTOMER_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={CUSTOMER_TYPE_LABELS[type]}
          required
          help={CUSTOMER_TAX_ID_HINTS[type]}
          {...(fieldError['taxId'] ? { error: fieldError['taxId'] } : {})}
        >
          <Input
            required
            maxLength={50}
            value={taxId}
            onChange={(e) => {
              setTaxId(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>
      </div>

      {mode === 'edit' && (
        <Field label="Estado" className="sm:max-w-xs">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as CustomerStatus);
              setSuccess(false);
            }}
          >
            {CUSTOMER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === 'active' ? 'Activo' : 'Inactivo'}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nombres"
          required
          {...(fieldError['firstName'] ? { error: fieldError['firstName'] } : {})}
        >
          <Input
            required
            maxLength={120}
            value={firstName}
            onChange={(e) => {
              setFirstName(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>
        <Field
          label="Apellidos"
          required
          {...(fieldError['lastName'] ? { error: fieldError['lastName'] } : {})}
        >
          <Input
            required
            maxLength={120}
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Correo" {...(fieldError['email'] ? { error: fieldError['email'] } : {})}>
          <Input
            type="email"
            maxLength={254}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>
        <Field label="Teléfono">
          <Input
            maxLength={40}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>
      </div>

      <Field label="Dirección">
        <Input
          maxLength={400}
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        Datos necesarios para vender
        <HelpTip>
          Una venta necesita correo, teléfono y dirección del cliente — complétalos aquí para evitar
          un error al cerrar la venta.
        </HelpTip>
      </p>

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Cliente guardado.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Crear cliente' : 'Guardar cambios'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={onCancel ?? (() => router.push('/customers'))}
        >
          {onCancel ? 'Cancelar' : 'Volver a clientes'}
        </Button>
      </div>
    </form>
  );
}
