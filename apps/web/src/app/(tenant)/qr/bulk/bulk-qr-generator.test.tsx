import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { BulkQrGenerator } from './bulk-qr-generator';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const VARIANTS = [
  { productId: 'p1', productName: 'Refrigeradora LG', variantId: 'v1', sku: 'REF-001' },
  { productId: 'p1', productName: 'Refrigeradora LG', variantId: 'v2', sku: 'REF-002' },
  { productId: 'p2', productName: 'Cocina Mabe', variantId: 'v3', sku: 'COC-001' },
];

describe('BulkQrGenerator', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows the initial pending-variant list with a checkbox, product name and SKU per row', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    expect(screen.getAllByText('Refrigeradora LG')).toHaveLength(2);
    expect(screen.getByText('REF-001')).toBeInTheDocument();
    expect(screen.getByText('REF-002')).toBeInTheDocument();
    expect(screen.getByText('Cocina Mabe')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  });

  it('shows an explanatory empty state, not a bare empty table, when nothing is pending', () => {
    render(<BulkQrGenerator initialVariants={[]} />);
    expect(screen.getByText('No existen variantes pendientes de generación')).toBeInTheDocument();
    expect(screen.getByText(/todas las variantes disponibles ya tienen/i)).toBeInTheDocument();
  });

  it('selects individually and shows a live count', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    expect(screen.getByText('0 seleccionadas')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/seleccionar refrigeradora lg — ref-001/i));
    expect(screen.getByText('1 seleccionada')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/seleccionar cocina mabe/i));
    expect(screen.getByText('2 seleccionadas')).toBeInTheDocument();
  });

  it('"Seleccionar todos" selects every loaded row, and toggles to "Deseleccionar todos"', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByRole('button', { name: 'Seleccionar todos' }));
    expect(screen.getByText('3 seleccionadas')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /ref-001/i })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Deseleccionar todos' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Deseleccionar todos' }));
    expect(screen.getByText('0 seleccionadas')).toBeInTheDocument();
  });

  it('disables the generate button until at least one variant is selected, and reflects the count', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    expect(screen.getByRole('button', { name: 'Generar QR' })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    expect(screen.getByRole('button', { name: 'Generar 1 QR' })).toBeEnabled();
  });

  it('requires an explicit confirmation step before generating — never calls the API on the first click', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    fireEvent.click(screen.getByRole('button', { name: 'Generar 1 QR' }));

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Confirmar generación' })).toBeInTheDocument();
    expect(screen.getByText(/está a punto de generar 1 código qr/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeInTheDocument();
  });

  it('"Cancelar" on the confirm step returns to selection without calling the API', () => {
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    fireEvent.click(screen.getByRole('button', { name: 'Generar 1 QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar 1 QR' })).toBeInTheDocument();
  });

  it('submits exactly { variantIds } in one POST /qr-codes/bulk call — never one call per variant', async () => {
    mockedFetch
      .mockResolvedValueOnce({ results: [], summary: { created: 2, skipped: 0, errors: 0 } }) // bulk create
      .mockResolvedValueOnce({ data: [VARIANTS[2]] }); // refetch after generation
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    fireEvent.click(screen.getByLabelText(/ref-002/i));
    fireEvent.click(screen.getByRole('button', { name: 'Generar 2 QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes/bulk', {
        method: 'POST',
        body: { variantIds: ['v1', 'v2'] },
      }),
    );
    expect(mockedFetch.mock.calls.filter((c) => c[0] === '/api/v1/qr-codes/bulk')).toHaveLength(1);
  });

  it('shows the generated/skipped/error summary after a successful bulk call, without hiding partial errors', async () => {
    mockedFetch
      .mockResolvedValueOnce({
        results: [
          { variantId: 'v1', status: 'created', qrCode: { id: 'qr1', code: 'abc' } },
          { variantId: 'v2', status: 'skipped', reason: 'This variant already has an active QR code.' },
        ],
        summary: { created: 1, skipped: 1, errors: 0 },
      })
      .mockResolvedValueOnce({ data: [] });
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    fireEvent.click(screen.getByLabelText(/ref-002/i));
    fireEvent.click(screen.getByRole('button', { name: 'Generar 2 QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    const report = await screen.findByRole('dialog', { name: 'Generación completada' });
    expect(report).toBeInTheDocument();
    // the report names each row (Producto — código), created ones included
    expect(screen.getAllByText('Refrigeradora LG — REF-001').length).toBeGreaterThan(0);
    expect(screen.getByText('Generado')).toBeInTheDocument();
    expect(await screen.findByText(/1 código qr generado/i)).toBeInTheDocument();
    expect(screen.getByText(/1 omitido/i)).toBeInTheDocument();
    expect(screen.getByText('This variant already has an active QR code.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar más' })).toBeInTheDocument();
  });

  it('shows an error and returns to the selection step (selection preserved) when the bulk call fails', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'no', undefined));
    render(<BulkQrGenerator initialVariants={VARIANTS} />);
    fireEvent.click(screen.getByLabelText(/ref-001/i));
    fireEvent.click(screen.getByRole('button', { name: 'Generar 1 QR' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar 1 QR' })).toBeInTheDocument();
  });

  it('re-fetches the pending list (debounced) as the search box changes', async () => {
    vi.useFakeTimers();
    try {
      mockedFetch.mockResolvedValueOnce({ data: [VARIANTS[2]] });
      render(<BulkQrGenerator initialVariants={VARIANTS} />);
      fireEvent.change(screen.getByLabelText('Buscar producto, código o categoría'), { target: { value: 'Cocina' } });
      expect(mockedFetch).not.toHaveBeenCalled();

      // advanceTimersByTimeAsync also flushes the microtask queue in between — required here since
      // fetchVariants awaits the (fake-timer-frozen otherwise) mocked apiFetch promise.
      await vi.advanceTimersByTimeAsync(350);

      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes/pending-variants', { query: { page: 1, pageSize: 100, q: 'Cocina' } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters by category: re-fetches with categoryId and shows each row\'s category', async () => {
    vi.useFakeTimers();
    try {
      mockedFetch.mockResolvedValueOnce({ data: [{ ...VARIANTS[2]!, categoryName: 'Cocinas' }], meta: { total: 1 } });
      render(<BulkQrGenerator initialVariants={VARIANTS} categories={[{ id: 'cat-1', name: 'Cocinas' }]} />);
      fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'cat-1' } });
      await vi.advanceTimersByTimeAsync(350);

      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes/pending-variants', { query: { page: 1, pageSize: 100, categoryId: 'cat-1' } });
      expect(screen.getAllByText('Cocinas').length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pages through more than 100 pending variants instead of silently hiding the rest', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [VARIANTS[2]], meta: { total: 150 } });
    render(<BulkQrGenerator initialVariants={VARIANTS} initialTotal={150} />);
    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/qr-codes/pending-variants', { query: { page: 2, pageSize: 100 } }),
    );
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
  });
});
