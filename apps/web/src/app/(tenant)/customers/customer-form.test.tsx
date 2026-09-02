import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { CustomerForm } from './customer-form';
import type { Customer } from '../../../lib/types/sales';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const CUSTOMER: Customer = {
  id: 'cust-1',
  type: 'business',
  displayName: 'Acme',
  taxId: 'T-1',
  email: 'a@b.com',
  phone: '555',
  address: { line1: 'Main 1' },
  status: 'active',
  createdAt: '',
  updatedAt: '',
};

describe('CustomerForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('POSTs exactly CreateCustomerDto and never a tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-1' });
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jane Doe' } });
    fireEvent.change(screen.getByLabelText(/tax id/i), { target: { value: 'X-9' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/customers/new-1'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers', {
      method: 'POST',
      body: { type: 'individual', displayName: 'Jane Doe', taxId: 'X-9' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('blocks an invalid email client-side', () => {
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^email/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));
    expect(screen.getByText(/valid email/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate tax id (409) in place', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'dup', undefined));
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jane' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));
    expect(await screen.findByText(/already uses that tax id/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('PATCHes only the changed fields on edit', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CUSTOMER, phone: '999' });
    render(<CustomerForm mode="edit" customer={CUSTOMER} />);
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(screen.getByText(/customer saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers/cust-1', { method: 'PATCH', body: { phone: '999' } });
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jane' } });
    const btn = screen.getByRole('button', { name: /create customer/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({ id: 'new-1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-1' });
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Jane' } });
    fireEvent.click(screen.getByRole('button', { name: /create customer/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
