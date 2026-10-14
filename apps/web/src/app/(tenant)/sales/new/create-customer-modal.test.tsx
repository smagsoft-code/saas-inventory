import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import { CreateCustomerModal } from './create-customer-modal';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

describe('CreateCustomerModal', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing when closed', () => {
    render(<CreateCustomerModal open={false} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a customer via the real CustomerForm, then hands it back and closes — no navigation', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(<CreateCustomerModal open onClose={onClose} onCreated={onCreated} />);

    mockedFetch.mockResolvedValueOnce({ id: 'new-1', displayName: 'Jane Doe' });
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-1', displayName: 'Jane Doe' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers', {
      method: 'POST',
      body: { type: 'cedula', firstName: 'Jane', lastName: 'Doe', taxId: '0102030405' },
    });
  });

  it('cancels back to the sale flow without creating anything', () => {
    const onClose = vi.fn();
    render(<CreateCustomerModal open onClose={onClose} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockedFetch).not.toHaveBeenCalled();
  });
});
