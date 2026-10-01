import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import type { ImportJob } from '../../../../lib/types/imports';
import { ImportPipeline } from './import-pipeline';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

function job(overrides: Partial<ImportJob> = {}): ImportJob {
  return {
    id: 'job-1',
    status: 'mapping',
    originalFilename: 'catalog.xlsx',
    duplicateHandlingMode: 'update_catalog_only',
    columnMapping: { SKU: 'sku', Nombre: 'name' },
    totalRows: 10,
    validRows: 8,
    warningRows: 1,
    invalidRows: 1,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ImportPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(job());
  });
  afterEach(() => cleanup());

  it('shows real counters and never a progress bar or percentage', () => {
    render(<ImportPipeline job={job({ status: 'mapping' })} canUseInventoryMode={false} />);
    expect(screen.getByText('Filas totales')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument(); // valid count
    expect(document.querySelector('progress')).toBeNull();
    expect(document.body.textContent).not.toMatch(/%/);
    expect(screen.getByRole('button', { name: /validar filas/i })).toBeInTheDocument();
  });

  it('POSTs /validate from a mapping job with no body', async () => {
    render(<ImportPipeline job={job({ status: 'mapping' })} canUseInventoryMode={false} />);
    fireEvent.click(screen.getByRole('button', { name: /validar filas/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/imports/job-1/validate', { method: 'POST' }),
    );
  });

  it('confirms a ready job via /confirm after a confirmation step, and loads the preview', async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/preview')) {
        return { status: 'ready', totalRows: 10, validRows: 8, invalidRows: 1, warningRows: 1, importedRows: 0, pendingRows: 0, skippedRows: 0, newProducts: 6, existingProducts: 2 };
      }
      return job({ status: 'ready' });
    });
    render(<ImportPipeline job={job({ status: 'ready' })} canUseInventoryMode={false} />);
    await waitFor(() => expect(screen.getByText('Productos nuevos')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /importar 9 filas/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar importación/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/imports/job-1/confirm', { method: 'POST' }),
    );
  });

  it('warns before confirm when the mode needs import.inventory and the user lacks it', () => {
    render(
      <ImportPipeline
        job={job({ status: 'ready', duplicateHandlingMode: 'update_catalog_and_inventory' })}
        canUseInventoryMode={false}
      />,
    );
    expect(screen.getByText(/requiere el permiso import-inventory/i)).toBeInTheDocument();
  });

  it('shows a safe 403 message in place when a step is rejected', async () => {
    mockedFetch.mockImplementation(async (url: string, opts?: { method?: string }) => {
      if (opts?.method === 'POST') throw new ApiError(403, 'FORBIDDEN', 'x', undefined);
      if (url.endsWith('/preview')) {
        return { status: 'ready', totalRows: 10, validRows: 8, invalidRows: 1, warningRows: 1, importedRows: 0, pendingRows: 0, skippedRows: 0, newProducts: 6, existingProducts: 2 };
      }
      return job({ status: 'ready' });
    });
    render(
      <ImportPipeline
        job={job({ status: 'ready', duplicateHandlingMode: 'update_catalog_and_inventory' })}
        canUseInventoryMode
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /importar 9 filas/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar importación/i }));
    expect(await screen.findByText(/no tienes autorización para este paso/i)).toBeInTheDocument();
  });

  it('offers the error-report download as a plain link when there are invalid rows', () => {
    render(<ImportPipeline job={job({ status: 'completed_with_errors' })} canUseInventoryMode={false} />);
    const link = screen.getByRole('link', { name: /descargar reporte de errores/i });
    expect(link).toHaveAttribute('href', '/api/v1/imports/job-1/errors');
  });

  it('renders an honest processing state (no percentage) for a validating job', () => {
    render(<ImportPipeline job={job({ status: 'validating' })} canUseInventoryMode={false} />);
    expect(screen.getByRole('status')).toHaveTextContent(/validando filas/i);
    expect(document.body.textContent).not.toMatch(/%/);
  });

  it('cancels via /cancel after confirming', async () => {
    render(<ImportPipeline job={job({ status: 'mapping' })} canUseInventoryMode={false} />);
    fireEvent.click(screen.getByRole('button', { name: /cancelar importación/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar cancelación/i }));
    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/imports/job-1/cancel', { method: 'POST' }),
    );
  });
});
