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

if (!URL.createObjectURL) {
  URL.createObjectURL = vi.fn(() => 'blob:mock-preview-url');
}
if (!URL.revokeObjectURL) {
  URL.revokeObjectURL = vi.fn();
}

const VARIANT = {
  id: 'v1',
  productId: 'p1',
  sku: 'CODE-1',
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

const CREATE_PROPS = {
  mode: 'create' as const,
  productId: 'p1',
  variantFields: [],
  optionsByDefinitionId: {},
  canViewFloor: true,
  canViewCost: true,
  totalPhysicalStock: null,
  apiPublicUrl: 'http://localhost:4000',
};

/** Routes the mock for create-mode tests: the SKU-suggestion report call returns no existing
 * SKUs (so the field just stays editable/empty) unless a test overrides it, and the post-create
 * QR call resolves realistically. */
function routeCreateFetch(impl?: (path: string, opts?: unknown) => unknown) {
  mockedFetch.mockImplementation(async (path: string, opts?: unknown) => {
    if (impl) return impl(path, opts);
    if (path === '/api/v1/reports/product-catalog') return { data: [] };
    if (path === '/api/v1/qr-codes') {
      return { id: 'qr-1', code: 'ABC123', targetType: 'product_variant', targetId: 'v-new', status: 'active', createdAt: '', updatedAt: '' };
    }
    return { id: 'v-new' };
  });
}

async function fillMinimalCreate() {
  fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText(/precio base/i), { target: { value: '90' } });
  fireEvent.change(screen.getByLabelText(/precio mínimo/i), { target: { value: '70' } });
}

async function waitForCreateToSettle() {
  await waitFor(() => expect(screen.getByRole('link', { name: /ver producto/i })).toBeInTheDocument());
}

describe('VariantForm — create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    routeCreateFetch();
  });
  afterEach(() => cleanup());

  it('POSTs the VariantFieldsDto shape, no tenantId, and never navigates away on its own', async () => {
    render(<VariantForm {...CREATE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CODE-2' } });
    await fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear variante/i }));

    await waitForCreateToSettle();
    const call = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products/p1/variants')!;
    const [, opts] = call;
    expect((opts as { method: string }).method).toBe('POST');
    expect((opts as { body: Record<string, unknown> }).body).toMatchObject({
      sku: 'CODE-2',
      maxPrice: 100,
      basePrice: 90,
      minPrice: 70,
      unit: 'unit',
      attributes: {},
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('blocks min > base client-side', () => {
    render(<VariantForm {...CREATE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CODE-1' } });
    fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/precio base/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/precio mínimo/i), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /crear variante/i }));
    expect(screen.getByText(/mínimo ≤ base ≤ máximo/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/products/p1/variants', expect.anything());
  });

  it('uppercases the código and código de barras as the user types', () => {
    render(<VariantForm {...CREATE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'abc-1' } });
    expect(screen.getByLabelText(/^código$/i)).toHaveValue('ABC-1');
    fireEvent.change(screen.getByLabelText(/código de barras/i), { target: { value: 'my-barcode' } });
    expect(screen.getByLabelText(/código de barras/i)).toHaveValue('MY-BARCODE');
  });

  it('suggests the next código from the product\'s own (fixed) category, with COD-<código> as the barcode', async () => {
    routeCreateFetch((path) => {
      if (path === '/api/v1/reports/product-catalog') return { data: [{ sku: 'CAR-001' }, { sku: 'CAR-002' }] };
      return { id: 'v-new' };
    });
    render(<VariantForm {...CREATE_PROPS} categoryId="cat-1" categoryName="Carpintería" />);
    await waitFor(() => expect(screen.getByLabelText(/^código$/i)).toHaveValue('CAR-003'));
    await waitFor(() => expect(screen.getByLabelText(/código de barras/i)).toHaveValue('COD-CAR-003'));
  });

  it('shows an image picker and, once created, the auto-generated QR with Precio máximo', async () => {
    render(<VariantForm {...CREATE_PROPS} />);
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [file] } });
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CODE-3' } });
    await fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear variante/i }));

    await waitForCreateToSettle();

    const imageCall = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/products/p1/images');
    expect(imageCall).toBeDefined();
    const [, imageOpts] = imageCall!;
    expect((imageOpts as { method: string }).method).toBe('POST');
    const formBody = (imageOpts as { body: FormData }).body;
    expect(formBody).toBeInstanceOf(FormData);
    expect(formBody.get('productVariantId')).toBe('v-new');

    const qrCall = mockedFetch.mock.calls.find(([p]) => p === '/api/v1/qr-codes')!;
    expect((qrCall[1] as { body: unknown }).body).toEqual({ targetType: 'product_variant', targetId: 'v-new' });

    await waitFor(() => expect(screen.getByAltText(/código qr/i)).toBeInTheDocument());
    expect(screen.getByText('Precio máximo: 100.00')).toBeInTheDocument();
  });

  it('never fires a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementation((path: string) => {
      if (path === '/api/v1/reports/product-catalog') return Promise.resolve({ data: [] });
      if (path === '/api/v1/products/p1/variants') return new Promise((r) => { resolve = r; });
      return Promise.resolve({ id: 'qr-1', code: 'X', targetType: 'product_variant', targetId: 'v-new', status: 'active', createdAt: '', updatedAt: '' });
    });
    render(<VariantForm {...CREATE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CODE-4' } });
    await fillMinimalCreate();
    const btn = screen.getByRole('button', { name: /crear variante/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/products/p1/variants')).toHaveLength(1);
    resolve({ id: 'v-new' });
    await waitForCreateToSettle();
  });

  it('never writes to browser storage', async () => {
    render(<VariantForm {...CREATE_PROPS} />);
    fireEvent.change(screen.getByLabelText(/^código$/i), { target: { value: 'CODE-9' } });
    await fillMinimalCreate();
    fireEvent.click(screen.getByRole('button', { name: /crear variante/i }));
    await waitForCreateToSettle();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('VariantForm — edit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('Código is read-only, and PATCH sends only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(VARIANT);
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    expect(screen.getByLabelText(/^código$/i)).toHaveAttribute('readonly');
    const save = screen.getByRole('button', { name: /guardar cambios/i });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'discontinued' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByText(/variante guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants/v1', {
      method: 'PATCH',
      body: { status: 'discontinued' },
    });
  });

  it('uppercases código de barras as the user types', () => {
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    fireEvent.change(screen.getByLabelText(/código de barras/i), { target: { value: 'lower-case' } });
    expect(screen.getByLabelText(/código de barras/i)).toHaveValue('LOWER-CASE');
  });

  it('offers "Agregar variante" and "Ver producto" (not "Volver al producto")', () => {
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    expect(screen.getByRole('link', { name: 'Agregar variante' })).toHaveAttribute('href', '/products/p1/variants/new');
    expect(screen.getByRole('link', { name: 'Ver producto' })).toHaveAttribute('href', '/products/p1');
    expect(screen.queryByText('Volver al producto')).not.toBeInTheDocument();
  });

  it('blocks deactivating (discontinued) a variant that still has physical stock', () => {
    render(
      <VariantForm
        mode="edit"
        productId="p1"
        variant={VARIANT}
        variantFields={[]}
        optionsByDefinitionId={{}}
        canViewFloor
        canViewCost
        totalPhysicalStock={12}
      />,
    );
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'discontinued' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    expect(screen.getByText(/no se puede desactivar.*12 unidad/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('allows deactivating once physical stock is exactly 0', async () => {
    mockedFetch.mockResolvedValueOnce({ ...VARIANT, status: 'discontinued' });
    render(
      <VariantForm
        mode="edit"
        productId="p1"
        variant={VARIANT}
        variantFields={[]}
        optionsByDefinitionId={{}}
        canViewFloor
        canViewCost
        totalPhysicalStock={0}
      />,
    );
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'discontinued' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/variante guardada/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/products/p1/variants/v1', {
      method: 'PATCH',
      body: { status: 'discontinued' },
    });
  });

  it('never blocks re-activating (active) a variant, regardless of its stock', async () => {
    const discontinuedVariant = { ...VARIANT, status: 'discontinued' };
    mockedFetch.mockResolvedValueOnce({ ...discontinuedVariant, status: 'active' });
    render(
      <VariantForm
        mode="edit"
        productId="p1"
        variant={discontinuedVariant}
        variantFields={[]}
        optionsByDefinitionId={{}}
        canViewFloor
        canViewCost
        totalPhysicalStock={40}
      />,
    );
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'active' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/variante guardada/i)).toBeInTheDocument());
  });

  it('does not block deactivating when stock could not be verified, and says so', () => {
    render(
      <VariantForm
        mode="edit"
        productId="p1"
        variant={VARIANT}
        variantFields={[]}
        optionsByDefinitionId={{}}
        canViewFloor
        canViewCost
        totalPhysicalStock={null}
      />,
    );
    expect(screen.getByText(/no se pudo verificar el stock/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'discontinued' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    expect(screen.queryByText(/no se puede desactivar/i)).not.toBeInTheDocument();
  });

  it('surfaces a 409 barcode conflict safely (the general error alert, not a field block)', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'A variant with this barcode already exists.', undefined),
    );
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    fireEvent.change(screen.getByLabelText(/código de barras/i), { target: { value: 'DUP' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    expect(await screen.findByText(/barcode already exists/i)).toBeInTheDocument();
  });

  it('surfaces the backend\'s 409 stock-guard message too, the same way (defense in depth if client state was stale)', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'Cannot deactivate: this variant still has 3 unit(s) of physical stock.', undefined),
    );
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'discontinued' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    expect(await screen.findByText(/still has 3 unit\(s\)/i)).toBeInTheDocument();
  });

  it('never writes to browser storage', async () => {
    mockedFetch.mockResolvedValueOnce({ ...VARIANT, unit: 'box' });
    render(
      <VariantForm mode="edit" productId="p1" variant={VARIANT} variantFields={[]} optionsByDefinitionId={{}} canViewFloor canViewCost totalPhysicalStock={0} />,
    );
    fireEvent.change(screen.getByLabelText(/unidad/i), { target: { value: 'box' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));
    await waitFor(() => expect(screen.getByText(/variante guardada/i)).toBeInTheDocument());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
