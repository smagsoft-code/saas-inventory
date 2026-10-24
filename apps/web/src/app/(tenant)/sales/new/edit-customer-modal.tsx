'use client';

import { useEffect, useState } from 'react';
import { Alert } from '../../../../components/ui/alert';
import { Modal } from '../../../../components/ui/modal';
import { Spinner } from '../../../../components/ui/spinner';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage } from '../../../../lib/api/errors';
import type { Customer } from '../../../../lib/types/sales';
import { CustomerForm } from '../../customers/customer-form';

/**
 * "Editar cliente" from the sale itself — the existing `CustomerForm` in edit mode (same
 * `PATCH /customers/:id`, same validation) inside a `Modal`. The customer may not be loaded yet
 * (a cart restored from an earlier session only knows the id), so it is fetched on open.
 * `onSaved` hands the updated record back so the sale refreshes the name and the missing-data check.
 */
export function EditCustomerModal({
  open,
  customerId,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  customerId: string;
  customer: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}): React.JSX.Element {
  const [loaded, setLoaded] = useState<Customer | null>(customer);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (customer && customer.id === customerId) {
      setLoaded(customer);
      return;
    }
    let cancelled = false;
    setLoaded(null);
    setError(null);
    apiFetch<Customer>(`/api/v1/customers/${customerId}`)
      .then((found) => {
        if (!cancelled) setLoaded(found);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(httpErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [open, customerId, customer]);

  return (
    <Modal open={open} onClose={onClose} title="Editar cliente" size="lg">
      {error && <Alert tone="error">{error}</Alert>}
      {!error && !loaded && <Spinner />}
      {loaded && (
        <CustomerForm
          mode="edit"
          customer={loaded}
          onSaved={(updated) => {
            onSaved(updated);
            onClose();
          }}
          onCancel={onClose}
        />
      )}
    </Modal>
  );
}
