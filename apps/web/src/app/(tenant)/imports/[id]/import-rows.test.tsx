import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../../lib/api/client';
import type { ImportJobRow } from '../../../../lib/types/imports';
import type { Paginated } from '../../../../lib/types/pagination';
import { ImportRows } from './import-rows';

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

function page(rows: ImportJobRow[], meta: Partial<Paginated<ImportJobRow>['meta']> = {}): Paginated<ImportJobRow> {
  return { data: rows, meta: { page: 1, pageSize: 25, total: rows.length, totalPages: 1, ...meta } };
}

const ROWS: ImportJobRow[] = [
  {
    rowNumber: 2,
    status: 'invalid',
    rawData: { SKU: 'A-1', Nombre: 'Widget', Precio: 10 },
    errors: [{ field: 'minPrice', code: 'PRICE_ORDER', message: 'min price is above base price' }],
    warnings: [],
  },
  {
    rowNumber: 3,
    status: 'valid',
    matchAction: 'create',
    rawData: { SKU: 'A-2', Nombre: 'Gadget' },
    errors: [],
    warnings: [{ field: 'category', code: 'AUTO_CREATE', message: 'category will be created' }],
  },
];

describe('ImportRows', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('loads the first page and renders row number, status and findings as plain text', async () => {
    mockedFetch.mockResolvedValueOnce(page(ROWS));
    render(<ImportRows jobId="job-1" />);

    await waitFor(() =>
      expect(screen.getByText(/min price is above base price/, { exact: false })).toBeInTheDocument(),
    );
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/imports/job-1/rows', { query: { page: 1, pageSize: 25 } });
    expect(screen.getByText(/category will be created/, { exact: false })).toBeInTheDocument();
    // no HTML injection surface
    expect(document.querySelector('[data-testid]')).toBeNull();
  });

  it('names the field, the Excel column and the received value so the user can fix the cell', async () => {
    mockedFetch.mockResolvedValueOnce(
      page([
        {
          rowNumber: 5,
          status: 'invalid',
          rawData: { CATEG: 'Televisores', Cant: 'abc' },
          errors: [
            { field: 'category', code: 'CATEGORY_NOT_FOUND', message: 'La categoría "Televisores" no existe.' },
            { field: 'quantity', code: 'QUANTITY_INVALID', message: 'La cantidad debe ser un número.' },
          ],
          warnings: [],
        },
      ]),
    );
    render(<ImportRows jobId="job-1" columnMapping={{ CATEG: 'category', Cant: 'quantity' }} />);

    expect(await screen.findByText('Categoría')).toBeInTheDocument();
    expect(screen.getByText(/columna «CATEG»/)).toBeInTheDocument();
    expect(screen.getByText(/columna «Cant»/)).toBeInTheDocument();
    // value only echoed when the message does not already quote it
    expect(screen.getByText(/Valor recibido: «abc»/)).toBeInTheDocument();
    expect(screen.queryByText(/Valor recibido: «Televisores»/)).not.toBeInTheDocument();
  });

  it('re-fetches with the real status query param when the filter changes', async () => {
    mockedFetch.mockResolvedValue(page(ROWS));
    render(<ImportRows jobId="job-1" />);
    await waitFor(() => expect(screen.getByText('A-1', { exact: false })).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/estado/i), { target: { value: 'invalid' } });
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/imports/job-1/rows', {
        query: { page: 1, pageSize: 25, status: 'invalid' },
      }),
    );
  });

  it('shows an empty message when a filter matches nothing', async () => {
    mockedFetch.mockResolvedValue(page([]));
    render(<ImportRows jobId="job-1" />);
    await waitFor(() => expect(screen.getByText(/aún no hay filas registradas/i)).toBeInTheDocument());
  });
});
