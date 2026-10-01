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

// jsdom has no real Blob-URL registry — the image preview only needs a stable, harmless string.
if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

const CATEGORIES = [{ id: 'cat-1', name: 'Appliances' }];
const DEFS: AttributeDefinition[] = [
  { id: 'd1', code: 'color', name: 'Color', dataType: 'text', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
];
const EMPTY_SETS: CategoryAttributeFieldSets = { product: [], variant: [], options: {} };

const DEFAULT_VARIANTS = [{ id: 'variant-1', sku: 'BLND-1' }];
const DEFAULT_QR = {
  id: 'qr-1',
  code: 'ABCDEF123456',
  targetType: 'product_variant',
  targetId: 'variant-1',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

/** Route the mock: category-attributes GET returns one required product attribute; the new-id's
 * variants/images/qr-codes calls (OUI-007's post-create sequence) resolve realistically; anything
 * else echoes `{ id: 'new-id' }`. */
function routeFetch(impl?: (path: string, opts?: unknown) => unknown) {
  mockedFetch.mockImplementation(async (path: string, opts?: unknown) => {
    if (path === '/api/v1/categories/cat-1/attributes') {
      return [
        { attributeDefinitionId: 'd1', code: 'color', name: 'Color', dataType: 'text', isRequired: true, displayOrder: 0 },
      ];
    }
    if (impl) return impl(path, opts);
    if (path === '/api/v1/products/new-id/variants') return DEFAULT_VARIANTS;
    if (path === '/api/v1/qr-codes') return DEFAULT_QR;
    return { id: 'new-id' };
  });
}

function fillMinimalCreate() {
  fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Blender' } });
  fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'BLND-1' } });
  fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText(/precio base/i), { target: { value: '80' } });
  fireEvent.change(screen.getByLabelText(/precio mínimo/i), { target: { value: '60' } });
}

/** The `productId -> variants` POST call the code makes right after `POST /api/v1/products`
 * succeeds — the shared "wait for the create flow to fully settle" signal, since OUI-007 no longer
 * navigates away immediately. */
async function waitForCreateToSettle() {
  await waitFor(() => expect(screen.getByRole('link', { name: /ver producto/i })).toBeInTheDocument());
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
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));

    await waitForCreateToSettle();
    const call = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products')!;
    const [path, opts] = call;
    expect(path).toBe('/api/v1/products');
    const body = opts as { method: string; body: Record<string, unknown> };
    expect(body.method).toBe('POST');
    expect(body.body).toMatchObject({
      name: 'Blender',
      attributes: {},
      defaultVariant: { sku: 'BLND-1', maxPrice: 100, basePrice: 80, minPrice: 60, attributes: {} },
    });
    expect(body.body).not.toHaveProperty('categoryId');
    expect(JSON.stringify(opts)).not.toMatch(/tenantId/i);
    // OUI-007: never navigates away on its own — the caller sees the image + QR panel first.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('blocks a price tier where min > base client-side', () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'X1' } });
    fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/precio base/i), { target: { value: '40' } });
    fireEvent.change(screen.getByLabelText(/precio mínimo/i), { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    expect(screen.getByText(/mínimo ≤ base ≤ máximo/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/products', expect.anything());
  });

  it('loads category-driven attributes and enforces a required one before POST', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: 'cat-1' } });
    // dynamic field appears
    expect(await screen.findByLabelText(/^color/i)).toBeInTheDocument();

    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    expect(await screen.findByText(/color es obligatorio/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/products', expect.anything());

    fireEvent.change(screen.getByLabelText(/^color/i), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();
    const [, opts] = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products')!;
    expect((opts as { body: Record<string, unknown> }).body).toMatchObject({
      categoryId: 'cat-1',
      attributes: { color: 'red' },
    });
  });

  it('prunes attribute values that no longer belong when the category is cleared', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: 'cat-1' } });
    fireEvent.change(await screen.findByLabelText(/^color/i), { target: { value: 'red' } });
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByLabelText(/^color/i)).not.toBeInTheDocument());

    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();
    const [, opts] = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products')!;
    expect((opts as { body: Record<string, unknown> }).body.attributes).toEqual({});
  });

  it('suggests SKU-001 for a category with no existing SKUs, and COD-<sku> as the barcode', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/reports/product-catalog') return { data: [] };
      return { id: 'new-id' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: 'cat-1' } });

    await waitFor(() => expect(screen.getByLabelText(/^código$/i)).toHaveValue('APP-001'));
    await waitFor(() => expect(screen.getByLabelText(/código de barras/i)).toHaveValue('COD-APP-001'));
    expect(screen.getByText(/sugerido a partir de la categoría/i)).toBeInTheDocument();
  });

  it('suggests the next sequential number after the highest existing SKU in that category', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/reports/product-catalog') {
        return { data: [{ sku: 'APP-001' }, { sku: 'APP-003' }, { sku: 'OTHER-999' }] };
      }
      return { id: 'new-id' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: 'cat-1' } });

    await waitFor(() => expect(screen.getByLabelText(/^código$/i)).toHaveValue('APP-004'));
    await waitFor(() => expect(screen.getByLabelText(/código de barras/i)).toHaveValue('COD-APP-004'));
  });

  it('stops suggesting once the user edits the SKU by hand, and decouples the barcode once edited too', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/reports/product-catalog') return { data: [] };
      return { id: 'new-id' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/categoría/i), { target: { value: 'cat-1' } });
    await waitFor(() => expect(screen.getByLabelText(/^código$/i)).toHaveValue('APP-001'));

    // Editing the SKU by hand still updates the barcode (still auto-following) until IT is edited too.
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CUSTOM-9' } });
    expect(screen.getByLabelText(/código de barras/i)).toHaveValue('COD-CUSTOM-9');
    expect(screen.queryByText(/sugerido a partir de la categoría/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/código de barras/i), { target: { value: 'MY-OWN-BARCODE' } });
    // Changing the SKU again no longer touches a barcode the user has already taken over.
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CUSTOM-10' } });
    expect(screen.getByLabelText(/código de barras/i)).toHaveValue('MY-OWN-BARCODE');
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    routeFetch((path) => {
      if (path === '/api/v1/products') return new Promise((r) => { resolve = r; });
      if (path === '/api/v1/products/x/variants') return DEFAULT_VARIANTS;
      if (path === '/api/v1/qr-codes') return DEFAULT_QR;
      return { id: 'x' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    const btn = screen.getByRole('button', { name: /crear producto/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/products')).toHaveLength(1);
    resolve({ id: 'x' });
    await waitFor(() => expect(screen.getByRole('link', { name: /ver producto/i })).toBeInTheDocument());
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
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    expect(await screen.findByText(/sku or barcode already exists/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: /ver producto/i })).not.toBeInTheDocument();
  });

  it('never writes to browser storage', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('rejects an image that is not jpeg/png/webp, client-side, before any upload', () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    const file = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [file] } });
    expect(screen.getByText(/solo se aceptan imágenes/i)).toBeInTheDocument();
  });

  it('rejects an image over 5 MB, client-side', () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [big] } });
    expect(screen.getByText(/supera el límite de 5 mb/i)).toBeInTheDocument();
  });

  it('uploads the chosen image and auto-generates a QR after the product is created', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [file] } });
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));

    await waitForCreateToSettle();

    const imageCall = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products/new-id/images');
    expect(imageCall).toBeDefined();
    const [, imageOpts] = imageCall!;
    expect((imageOpts as { method: string }).method).toBe('POST');
    expect((imageOpts as { body: unknown }).body).toBeInstanceOf(FormData);

    const qrCall = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/qr-codes')!;
    expect((qrCall[1] as { body: unknown }).body).toEqual({ targetType: 'product_variant', targetId: 'variant-1' });

    // The QR panel renders once generation succeeds.
    await waitFor(() => expect(screen.getByAltText(/código qr/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /imprimir/i })).toBeInTheDocument();
  });

  it('shows Precio máximo (this variant\'s maxPrice) alongside the auto-generated QR, ready to print', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '199.9' } });
    fireEvent.change(screen.getByLabelText(/precio base/i), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText(/precio mínimo/i), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));

    await waitFor(() => expect(screen.getByAltText(/código qr/i)).toBeInTheDocument());
    expect(screen.getByText('Precio máximo: 199.90')).toBeInTheDocument();
  });

  it('still shows the product as created, with a warning, when QR generation fails', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/products/new-id/variants') return DEFAULT_VARIANTS;
      if (path === '/api/v1/qr-codes') throw new ApiError(500, 'INTERNAL', 'boom', undefined);
      return { id: 'new-id' };
    });
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));

    await waitForCreateToSettle();
    expect(await screen.findByText(/no se pudo generar el código qr/i)).toBeInTheDocument();
  });

  it('disables the form fields once the product has been created', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();
    expect(screen.getByLabelText(/^nombre/i)).toBeDisabled();
    expect(screen.queryByRole('button', { name: /crear producto/i })).not.toBeInTheDocument();
  });

  it('offers "Agregar stock" (preselecting the new variant) once created, only when canAddStock is granted', async () => {
    render(
      <ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} canAddStock />,
    );
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();

    const link = screen.getByRole('link', { name: /agregar stock/i });
    expect(link).toHaveAttribute(
      'href',
      `/inventory/add-stock?productVariantId=${DEFAULT_VARIANTS[0]!.id}&sku=${encodeURIComponent(DEFAULT_VARIANTS[0]!.sku)}`,
    );
  });

  it('never shows "Agregar stock" without canAddStock, even though the product was created', async () => {
    render(<ProductForm mode="create" categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear producto/i }));
    await waitForCreateToSettle();
    expect(screen.queryByRole('link', { name: /agregar stock/i })).not.toBeInTheDocument();
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
    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'active' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(screen.getByText(/producto guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1', { method: 'PATCH', body: { status: 'active' } });
  });

  it('surfaces a 403 in place without redirecting', async () => {
    routeFetch((path) => {
      if (path === '/api/v1/products/p1') throw new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined);
      return {};
    });
    render(<ProductForm mode="edit" product={PRODUCT} categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Blender Pro' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    expect(await screen.findByText(/ya no tienes permiso/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('has no image/QR panel in edit mode', () => {
    render(<ProductForm mode="edit" product={PRODUCT} categories={CATEGORIES} definitions={DEFS} initialFieldSets={EMPTY_SETS} />);
    expect(screen.queryByLabelText(/elegir imagen/i)).not.toBeInTheDocument();
  });
});
