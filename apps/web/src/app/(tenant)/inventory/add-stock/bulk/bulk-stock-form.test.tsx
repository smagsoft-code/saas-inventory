import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { BulkStockForm } from './bulk-stock-form';

vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const WAREHOUSES = [{ id: 'wh-1', name: 'Sucursal Central' }];
const LOCATIONS = [{ id: 'loc-1', warehouseId: 'wh-1', name: 'Bodega 1' }];

const GOOD_PREVIEW = {
  totalRows: 2,
  validRows: 2,
  invalidRows: 0,
  totalQuantity: 8,
  rows: [
    { rowNumber: 2, code: 'A-1', productName: 'Silla', quantity: 5, unitCost: 10, reason: 'Compra', errors: [] },
    { rowNumber: 3, code: 'B-1', productName: 'Mesa', quantity: 3, unitCost: 4, reason: 'Compra', errors: [] },
  ],
};
const BAD_PREVIEW = {
  ...GOOD_PREVIEW,
  validRows: 1,
  invalidRows: 1,
  rows: [GOOD_PREVIEW.rows[0], { rowNumber: 3, code: 'X', reason: '', errors: ['No existe un producto con este código.'] }],
};

function xlsx(): File {
  return new File([new Uint8Array([1])], 'carga.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function fill(date?: string): void {
  fireEvent.change(screen.getByLabelText(/sucursal/i), { target: { value: 'wh-1' } });
  fireEvent.change(screen.getByLabelText(/^almacén/i), { target: { value: 'loc-1' } });
  if (date) fireEvent.change(screen.getByLabelText(/fecha del movimiento/i), { target: { value: date } });
  fireEvent.change(screen.getByLabelText(/archivo de excel/i), { target: { files: [xlsx()] } });
}

function check(): void {
  fireEvent.click(screen.getByRole('button', { name: /revisar archivo/i }));
}

describe('BulkStockForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('does not call the API until sucursal, almacén and file are chosen', () => {
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    check();
    expect(screen.getByText('Elige una sucursal.')).toBeInTheDocument();
    expect(screen.getByText('Elige el archivo de Excel (.xlsx).')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('defaults the date to today and caps it at today (no future dates)', () => {
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    const input = screen.getByLabelText(/fecha del movimiento/i) as HTMLInputElement;
    expect(input.value).toBe(input.max);
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('previews as multipart (locationId + file + occurredOn) and marks error rows in red', async () => {
    mockedFetch.mockResolvedValueOnce(BAD_PREVIEW);
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fill();
    check();

    expect(await screen.findByText('No existe un producto con este código.')).toBeInTheDocument();
    const [url, opts] = mockedFetch.mock.calls[0]!;
    expect(url).toBe('/api/v1/inventory/receipts/bulk/preview');
    const body = (opts as { body: FormData }).body;
    expect(body.get('locationId')).toBe('loc-1');
    expect(body.get('file')).toBeInstanceOf(File);
    expect(body.get('occurredOn')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.get('tenantId')).toBeNull();
    expect(screen.getByText('No existe un producto con este código.').closest('tr')).toHaveClass('bg-red-50');
    // with errors there is no way to load anything
    expect(screen.queryByRole('button', { name: /^cargar \d/i })).not.toBeInTheDocument();
  });

  it('confirms in a modal, sends an Idempotency-Key, and shows the result', async () => {
    mockedFetch.mockResolvedValueOnce(GOOD_PREVIEW).mockResolvedValueOnce({ loadedRows: 2, totalQuantity: 8 });
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fill();
    check();
    fireEvent.click(await screen.findByRole('button', { name: /cargar 2 productos/i }));

    expect(screen.getByRole('dialog', { name: '¿Se cargarán 2 productos?' })).toBeInTheDocument();
    // today => no backdating warning
    expect(screen.queryByText(/cambiará el historial del Kardex/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /confirmar carga/i }));

    expect(await screen.findByRole('dialog', { name: 'Carga completada' })).toBeInTheDocument();
    const [url, opts] = mockedFetch.mock.calls[1]!;
    expect(url).toBe('/api/v1/inventory/receipts/bulk');
    const headers = (opts as { headers: Record<string, string> }).headers;
    expect(headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('warns in the confirm modal when the date is earlier than today', async () => {
    mockedFetch.mockResolvedValueOnce(GOOD_PREVIEW);
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fill('2020-10-05');
    check();
    fireEvent.click(await screen.findByRole('button', { name: /cargar 2 productos/i }));
    expect(screen.getByText('Esta carga se registrará con fecha 05/10/2020 y cambiará el historial del Kardex desde esa fecha.')).toBeInTheDocument();
  });

  it('reuses the same Idempotency-Key when the same payload is retried', async () => {
    mockedFetch
      .mockResolvedValueOnce(GOOD_PREVIEW)
      .mockRejectedValueOnce(new ApiError(503, 'INTERNAL', 'caído', undefined))
      .mockResolvedValueOnce(GOOD_PREVIEW)
      .mockResolvedValueOnce({ loadedRows: 2, totalQuantity: 8 });
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fill();
    check();
    fireEvent.click(await screen.findByRole('button', { name: /cargar 2 productos/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar carga/i }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledTimes(2));
    // the failed attempt drops the preview: review again (same payload), then confirm again
    await waitFor(() => expect(screen.queryByRole('button', { name: /cargar 2 productos/i })).not.toBeInTheDocument());
    check();
    fireEvent.click(await screen.findByRole('button', { name: /cargar 2 productos/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar carga/i }));
    await screen.findByRole('dialog', { name: 'Carga completada' });
    const keyOf = (i: number): string => (mockedFetch.mock.calls[i]![1] as { headers: Record<string, string> }).headers['Idempotency-Key']!;
    expect(keyOf(3)).toBe(keyOf(1));
  });

  it('a 422 from the server drops the preview and asks to review again', async () => {
    mockedFetch.mockResolvedValueOnce(GOOD_PREVIEW).mockRejectedValueOnce(new ApiError(422, 'UNPROCESSABLE', 'No se cargó nada: 1 fila con errores.', undefined));
    render(<BulkStockForm warehouses={WAREHOUSES} locations={LOCATIONS} />);
    fill();
    check();
    fireEvent.click(await screen.findByRole('button', { name: /cargar 2 productos/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar carga/i }));
    expect(await screen.findByText(/No se cargó nada: 1 fila con errores\. Vuelve a revisar el archivo\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cargar 2 productos/i })).not.toBeInTheDocument();
  });
});
