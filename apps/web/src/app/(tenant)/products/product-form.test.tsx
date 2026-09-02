import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import type { AttributeDefinition } from '../../../lib/types/catalog';
import type { CategoryAttributeFieldSets } from '../../../lib/catalog/product-attributes';
import { ProductForm } from './product-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: pushMock }),
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const CATEGORIES = [{ id: 'cat-1', name: 'Appliances' }];
const DEFS: AttributeDefinition[] = [
  { id: 'd1', code: 'color', name: 'Color', dataType: 'text', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
];
const EMPTY_SETS: CategoryAttributeFieldSets = { product: [], variant: [], options: {} };

/** Route the mock: category-attributes GET returns one required product attribute; mutations echo. */
function routeFetch(impl?: (path: string, opts?: unknown) => unknown) {
  mockedFetch.mockImplementation(async (path: string, opts?: unknown) => {
    if (path === '/api/v1/categories/cat-1/attributes') {
      return [
        { attributeDefinitionId: 'd1', code: 'color', name: 'Color', dataType: 'text', isRequired: true, displayOrder: 0 },
      ];
    }
    if (impl) return impl(path, opts);
    return { id: 'new-id' };
  });
}

function fillMinimalCreate() {
  fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Blender' } });
  fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'BLND-1' } });
  fireEvent.change(screen.getByLabelText(/max price/i), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText(/min price/i), { target: { value: '60' } });
}

describe('ProductForm — create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    routeFetch();
  });
  afterEach(() => cleanup());

  it('POSTs the real DTO shape with the mandatory defaultVariant and no tenantId', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/products/new-id'));
    const [path, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(path).toBe('/api/v1/products');
    const body = (opts as { method: string; body: Record<string, unknown> });
    expect(body.method).toBe('POST');
    expect(body.body).toMatchObject({
      name: 'Blender',
      attributes: {},
      defaultVariant: { sku: 'BLND-1', maxPrice: 100, basePrice: 80, minPrice: 60, attributes: {} },
    });
    expect(body.body).not.toHaveProperty('categoryId');
    expect(JSON.stringify(opts)).not.toMatch(/tenantId/i);
  });

  it('blocks a price tier where min > base client-side', () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^sku/i), { target: { value: 'X1' } });
    fireEvent.change(screen.getByLabelText(/max price/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/base price/i), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/min price/i), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    expect(screen.getByText(/min ≤ base ≤ max/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/products', expect.anything());
  });

  it('loads category-driven attributes and enforces a required one before POST', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'cat-1' } });
    // dynamic field appears
    expect(await screen.findByLabelText(/^color/i)).toBeInTheDocument();

    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    expect(await screen.findByText(/color is required/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/products', expect.anything());

    fireEvent.change(screen.getByLabelText(/^color/i), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect((opts as { body: Record<string, unknown> }).body).toMatchObject({
      categoryId: 'cat-1',
      attributes: { color: 'red' },
    });
  });

  it('prunes attribute values that no longer belong when the category is cleared', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'cat-1' } });
    fireEvent.change(await screen.findByLabelText(/^color/i), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByLabelText(/^color/i)).not.toBeInTheDocument());

    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    const [, opts] = mockedFetch.mock.calls.at(-1)!;
    expect((opts as { body: Record<string, unknown> }).body.attributes).toEqual({});
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    routeFetch((path) => {
      if (path === '/api/v1/products') return new Promise((r) => { resolve = r; });
      return { id: 'x' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    const btn = screen.getByRole('button', { name: /create product/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/products')).toHaveLength(1);
    resolve({ id: 'x' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it('surfaces a 409 SKU conflict safely', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/products') {
        throw new ApiError(409, 'CONFLICT', 'A variant with this SKU or barcode already exists.', undefined);
      }
      return { id: 'x' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    expect(await screen.findByText(/sku or barcode already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('never writes to browser storage', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /create product/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('ProductForm — edit', () => {
  const PRODUCT = {
    id: 'p1',
    name: 'Blender',
    description: '',
    status: 'draft',
    attributes: {},
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    routeFetch();
  });
  afterEach(() => cleanup());

  it('keeps Save disabled until a change, then PATCHes only changed fields', async () => {
    render(<ProductForm mode="edit" product={PRODUCT} categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    const save = screen.getByRole('button', { name: /save changes/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'active' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/product saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1', { method: 'PATCH', body: { status: 'active' } });
  });

  it('surfaces a 403 in place without redirecting', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/products/p1') throw new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined);
      return {};
    });
    render(<ProductForm mode="edit" product={PRODUCT} categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Blender Pro' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/no longer have permission/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });
});
