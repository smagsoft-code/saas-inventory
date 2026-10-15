import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { VariantForm } from './[id]/variant-form';
import { ProductImageQrPanel } from './product-image-qr-panel';
import { StagedImageProvider } from './staged-image';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: refreshMock, push: vi.fn() }),
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => 'blob:preview');
if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();

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

function renderEditScreen(): void {
  render(
    <StagedImageProvider>
      <VariantForm
        mode="edit"
        productId="p1"
        variant={VARIANT}
        variantFields={[]}
        optionsByDefinitionId={{}}
        canViewFloor
        canViewCost
        totalPhysicalStock={0}
      />
      <ProductImageQrPanel
        productId="p1"
        variantId="v1"
        apiPublicUrl="http://localhost:4000"
        canManageImage
        canManageQr={false}
        maxPrice={100}
      />
    </StagedImageProvider>,
  );
}

const png = () => new File(['x'], 'photo.png', { type: 'image/png' });

describe('Editing a product image (staged, saved with "Guardar cambios")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue({});
  });
  afterEach(() => cleanup());

  it('"Guardar cambios" starts disabled, and picking a new image enables it without touching the API', () => {
    renderEditScreen();
    const save = screen.getByRole('button', { name: 'Guardar cambios' });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [png()] } });

    expect(save).toBeEnabled();
    expect(screen.getByText(/Imagen nueva sin guardar/)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled(); // nothing is uploaded until the user saves
  });

  it('saving uploads only the image (no PATCH when no field changed) and clears the staged state', async () => {
    renderEditScreen();
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    const [path, opts] = mockedFetch.mock.calls[0]!;
    expect(path).toBe('/api/v1/products/p1/images');
    expect((opts as { method: string }).method).toBe('POST');
    expect((opts as { body: unknown }).body).toBeInstanceOf(FormData);
    await waitFor(() => expect(screen.queryByText(/Imagen nueva sin guardar/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
  });

  it('saving with other edits sends the PATCH and the image, in that order', async () => {
    renderEditScreen();
    fireEvent.change(screen.getByLabelText(/precio máximo/i), { target: { value: '120' } });
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch.mock.calls.map(([p]) => p)).toEqual(['/api/v1/products/p1/variants/v1', '/api/v1/products/p1/images']);
  });

  it('"Descartar" drops the staged image and disables the button again', () => {
    renderEditScreen();
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), { target: { files: [png()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.queryByText(/Imagen nueva sin guardar/)).not.toBeInTheDocument();
  });

  it('rejects an unsupported file without staging it', () => {
    renderEditScreen();
    fireEvent.change(screen.getByLabelText(/elegir imagen/i), {
      target: { files: [new File(['x'], 'doc.pdf', { type: 'application/pdf' })] },
    });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    expect(screen.getByText(/Solo se aceptan imágenes/)).toBeInTheDocument();
  });
});
