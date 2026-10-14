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
  type: 'ruc',
  firstName: 'Acme',
  lastName: 'Corp',
  displayName: 'Acme Corp',
  taxId: '1790012345001',
  email: 'a@b.com',
  phone: '555',
  address: 'Main 1',
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
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/customers/new-1'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers', {
      method: 'POST',
      body: { type: 'cedula', firstName: 'Jane', lastName: 'Doe', taxId: '0102030405' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('blocks an invalid identification format client-side before any request', () => {
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));
    expect(screen.getByText(/10 números/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('blocks an invalid email client-side', () => {
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.change(screen.getByLabelText(/^correo$/i), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));
    expect(screen.getByText(/correo electrónico válido/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate identification (409) in place', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'dup', undefined));
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));
    expect(await screen.findByText(/ya usa esa identificación/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('PATCHes only the changed fields on edit', async () => {
    mockedFetch.mockResolvedValueOnce({ ...CUSTOMER, phone: '999' });
    render(<CustomerForm mode="edit" customer={CUSTOMER} />);
    fireEvent.change(screen.getByLabelText(/teléfono/i), { target: { value: '999' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/cliente guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/customers/cust-1', { method: 'PATCH', body: { phone: '999' } });
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    const btn = screen.getByRole('button', { name: /crear cliente/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({ id: 'new-1' });
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
  });

  it('calls onCreated instead of navigating when provided (embedded in the sale-flow modal)', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-1', displayName: 'Jane Doe' });
    const onCreated = vi.fn();
    render(<CustomerForm mode="create" onCreated={onCreated} />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ id: 'new-1', displayName: 'Jane Doe' }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('uses onCancel instead of navigating to /customers when provided', () => {
    const onCancel = vi.fn();
    render(<CustomerForm mode="create" onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: /^cancelar$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'new-1' });
    render(<CustomerForm mode="create" />);
    fireEvent.change(screen.getByLabelText(/^nombres$/i), { target: { value: 'Jane' } });
    fireEvent.change(screen.getByLabelText(/^apellidos$/i), { target: { value: 'Doe' } });
    fireEvent.change(screen.getByLabelText(/^cédula$/i), { target: { value: '0102030405' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cliente/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
