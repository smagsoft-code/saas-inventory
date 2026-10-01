import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { ImportUploadForm } from './import-upload-form';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const TEMPLATES = [{ id: 't1', name: 'Proveedor X' }];
const WAREHOUSES = [{ id: 'wh-1', name: 'Sucursal Central' }];
const LOCATIONS = [{ id: 'loc-1', warehouseId: 'wh-1', name: 'Main' }];
const CATEGORIES = [{ id: 'c1', name: 'TVs' }];

function xlsx(name = 'catalog.xlsx'): File {
  return new File([new Uint8Array([1, 2, 3])], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function setFile(file: File): void {
  const input = screen.getByLabelText(/archivo excel/i);
  fireEvent.change(input, { target: { files: [file] } });
}

describe('ImportUploadForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('keeps submit disabled until a valid .xlsx file is chosen', () => {
    render(<ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: /subir y continuar/i })).toBeDisabled();
    setFile(xlsx());
    expect(screen.getByRole('button', { name: /subir y continuar/i })).toBeEnabled();
  });

  it('rejects a non-xlsx file client-side without calling the API', () => {
    render(<ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={CATEGORIES} />);
    setFile(new File(['x'], 'catalog.csv', { type: 'text/csv' }));
    expect(screen.getByText(/solo se aceptan archivos .xlsx/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subir y continuar/i })).toBeDisabled();
  });

  it('POSTs multipart/form-data with the standard column mapping, no tenantId, and redirects to the job', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'job-9', status: 'mapping' });
    render(<ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={CATEGORIES} />);
    setFile(xlsx());
    fireEvent.click(screen.getByRole('button', { name: /subir y continuar/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/imports/job-9'));
    const [url, opts] = mockedFetch.mock.calls.at(-1)!;
    expect(url).toBe('/api/v1/imports');
    const options = opts as { method: string; body: FormData };
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.body.get('file')).toBeInstanceOf(File);
    expect(options.body.get('mappingTemplateId')).toBeNull();
    expect(JSON.parse(options.body.get('columnMapping') as string)).toMatchObject({ SKU: 'sku' });
    expect(options.body.get('duplicateHandlingMode')).toBe('update_catalog_only');
    // FormData has no way to carry a tenantId and we never add one
    for (const key of (options.body as unknown as { keys(): IterableIterator<string> }).keys()) {
      expect(key).not.toMatch(/tenant/i);
    }
  });

  it('sends mappingTemplateId (not columnMapping) when a saved template is chosen', async () => {
    mockedFetch.mockResolvedValueOnce({ id: 'job-1', status: 'mapping' });
    render(<ImportUploadForm canUseInventoryMode={false} templates={TEMPLATES} warehouses={WAREHOUSES} locations={LOCATIONS} categories={[]} />);
    setFile(xlsx());
    fireEvent.click(screen.getByRole('button', { name: /subir y continuar/i }));
    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    const body = mockedFetch.mock.calls.at(-1)![1]!.body as FormData;
    expect(body.get('mappingTemplateId')).toBe('t1');
    expect(body.get('columnMapping')).toBeNull();
  });

  it('hides the inventory duplicate-mode option unless the user holds import.inventory', () => {
    const { rerender } = render(
      <ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={[]} />,
    );
    expect(screen.queryByRole('option', { name: /actualizar catálogo e inventario/i })).not.toBeInTheDocument();
    rerender(<ImportUploadForm canUseInventoryMode templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={[]} />);
    expect(screen.getByRole('option', { name: /actualizar catálogo e inventario/i })).toBeInTheDocument();
  });

  it('surfaces a 403 in place without navigating', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    render(<ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={[]} />);
    setFile(xlsx());
    fireEvent.click(screen.getByRole('button', { name: /subir y continuar/i }));
    expect(await screen.findByText(/no tienes autorización para iniciar/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('offers the template download as a plain link to the API path', () => {
    render(<ImportUploadForm canUseInventoryMode={false} templates={[]} warehouses={WAREHOUSES} locations={LOCATIONS} categories={[]} />);
    const link = screen.getByRole('link', { name: /descargar plantilla/i });
    expect(link).toHaveAttribute('href', '/api/v1/imports/template');
  });
});
