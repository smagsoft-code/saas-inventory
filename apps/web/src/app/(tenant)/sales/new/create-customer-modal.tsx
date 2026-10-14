'use client';

import { Modal } from '../../../../components/ui/modal';
import type { Customer } from '../../../../lib/types/sales';
import { CustomerForm } from '../../customers/customer-form';

/**
 * "Crear nuevo cliente" without leaving the sale — wraps the existing `CustomerForm` (same
 * `POST /customers`, `sales.customers.manage`, validation) in a `Modal` instead of letting it
 * navigate to `/customers/:id`. `onCreated` hands the new customer straight back to the sale
 * flow, which selects it on the cart (`PATCH /cart { customerId }`) without touching products,
 * quantities, prices, or the chosen location.
 */
export function CreateCustomerModal({
  open,
  onClose,
  onCreated,
  initialTaxId,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (customer: Customer) => void;
  /** Prefills the identification field — the cart modal's customer search hands over the typed
   * text when nothing matched, instead of making the owner retype it. */
  initialTaxId?: string;
}): React.JSX.Element {
  return (
    <Modal open={open} onClose={onClose} title="Crear nuevo cliente" size="lg">
      <CustomerForm
        mode="create"
        {...(initialTaxId ? { initialTaxId } : {})}
        onCreated={(customer) => {
          onCreated(customer);
          onClose();
        }}
        onCancel={onClose}
      />
    </Modal>
  );
}
