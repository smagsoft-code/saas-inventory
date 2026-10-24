import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditCustomerModal } from './edit-customer-modal';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
import { apiFetch } from '../../../../lib/api/client';

const customer = { id: 'c1', type: 'cedula', firstName: 'Ana', lastName: 'Pérez', displayName: 'Ana Pérez', taxId: '123', status: 'active' } as never;

describe('EditCustomerModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('opens the edit form with the loaded customer', () => {
    render(<EditCustomerModal open customerId="c1" customer={customer} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByDisplayValue('Ana') as HTMLInputElement).value).toBe('Ana');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('fetches the customer when the cart only knew its id', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(customer);
    render(<EditCustomerModal open customerId="c1" customer={null} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('Ana')).toBeTruthy());
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/customers/c1');
  });
});
