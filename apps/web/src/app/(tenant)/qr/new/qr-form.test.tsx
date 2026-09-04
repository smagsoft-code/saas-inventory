import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { QrForm } from './qr-form';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const products = [{ id: 'p1', name: 'Fridge' }];
const locations = [{ id: 'l1', name: 'Main floor' }];

function renderForm() {
  return render(<QrForm products={products} locations={locations} />);
}

describe('QrForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('defaults to product_variant and loads variants for the chosen product', async () => {
    mockedFetch.mockResolvedValueOnce([{ id: 'v1', sku: 'FRIDGE-A' }]);
    renderForm();
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'p1' } });
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants'),
    );
    await screen.findByRole('option', { name: 'FRIDGE-A' });
  });

  it('submits exactly { targetType, targetId } for a variant target — no tenantId', async () => {
    mockedFetch
      .mockResolvedValueOnce([{ id: 'v1', sku: 'FRIDGE-A' }]) // variant load
      .mockResolvedValueOnce({ id: 'q1', targetType: 'product_variant' }); // create
    renderForm();
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'p1' } });
    await screen.findByRole('option', { name: 'FRIDGE-A' });
    fireEvent.change(screen.getByLabelText('Variant'), { target: { value: 'v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/qr?targetType=product_variant'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/qr-codes', {
      method: 'POST',
      body: { targetType: 'product_variant', targetId: 'v1' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenant_?id/i);
  });

  it('switches to a location target and submits the location id', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'q2', targetType: 'location' });
    renderForm();
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'location' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes', {
        method: 'POST',
        body: { targetType: 'location', targetId: 'l1' },
      }),
    );
  });

  it('includes expiresAt as an ISO date-time only when a date is entered', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'q3', targetType: 'location' });
    renderForm();
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'location' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'l1' } });
    fireEvent.change(screen.getByLabelText('Expires on'), { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    const [, options] = mockedFetch.mock.calls.at(-1)!;
    expect((options as { body: { expiresAt: string } }).body.expiresAt).toBe('2026-12-31T23:59:59.999Z');
  });

  it('blocks submit until a target is chosen', () => {
    renderForm();
    expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled();
  });

  it('shows a safe error on 403 and does not navigate', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    renderForm();
    fireEvent.change(screen.getByLabelText('Target type'), { target: { value: 'location' } });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'l1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/not authorized/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
