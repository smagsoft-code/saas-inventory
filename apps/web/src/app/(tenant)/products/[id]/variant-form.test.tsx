import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { VariantForm } from './variant-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: pushMock }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const VARIANT = {
  id: 'v1',
  productId: 'p1',
  sku: 'SKU-1',
  barcode: '',
  unit: 'unit',
  maxPrice: 100,
  basePrice: 80,
  minPrice: 60,
  status: 'active',
  isSerialized: false,
  isLotTracked: false,
  attributes: {},
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('VariantForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('create: POSTs the VariantFieldsDto shape, no tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'v-new' });
    render(
      <VariantForm mode="create" productId="p1" variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost />,
    );
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'SKU-2' } });
    fireEvent.change(screen.getByLabelText(/max price/i), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '90' } });
    fireEvent.change(screen.getByLabelText(/min price/i), { target: { value: '70' } });
    fireEvent.click(screen.getByRole('button', { name: /create variant/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/products/p1/variants/v-new'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants', {
      method: 'POST',
      body: { sku: 'SKU-2', maxPrice: 100, basePrice: 90, minPrice: 70, unit: 'unit', attributes: {} },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('create: blocks min > base client-side', () => {
    render(
      <VariantForm mode="create" productId="p1" variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost />,
    );
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/max price/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/min price/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /create variant/i }));
    expect(screen.getByText(/min ≤ base ≤ max/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('edit: SKU is read-only and PATCH sends only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(VARIANT);
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost />,
    );
    expect(screen.getByLabelText(/^sku/i)).toHaveAttribute('readonly');
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'discontinued' } });
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText(/variant saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants/v1', {
      method: 'PATCH',
      body: { status: 'discontinued' },
    });
  });

  it('edit: surfaces a 409 barcode conflict safely', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A variant with this barcode already exists.', undefined),
    );
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost />,
    );
    fireEvent.change(screen.getByLabelText(/barcode/i), { target: { value: 'DUP' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/barcode already exists/i)).toBeInTheDocument();
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'v-new' });
    render(
      <VariantForm mode="create" productId="p1" variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost />,
    );
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'SKU-9' } });
    fireEvent.change(screen.getByLabelText(/max price/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/min price/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /create variant/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
