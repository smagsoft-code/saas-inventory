import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QrFilters } from './qr-filters';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const CATEGORIES = [{ id: 'c1', name: 'Electrónica' }];

describe('QrFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not navigate on mount even with an existing q', () => {
    render(<QrFilters initial={{ q: 'wid' }} categories={CATEGORIES} />);
    vi.advanceTimersByTime(1000);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('filters live as the owner types — debounced, not on every keystroke', () => {
    render(<QrFilters initial={{}} categories={CATEGORIES} />);
    const input = screen.getByLabelText('Buscar por producto, variante o código');
    fireEvent.change(input, { target: { value: 'w' } });
    fireEvent.change(input, { target: { value: 'wi' } });
    fireEvent.change(input, { target: { value: 'wid' } });
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(349);
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/qr?q=wid');
  });

  it('hides the filter panel until "Filtro" is pressed, and shows only Categoría + Estado (no Stock)', () => {
    render(<QrFilters initial={{}} categories={CATEGORIES} />);
    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtro$/ }));
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.queryByLabelText('Stock')).not.toBeInTheDocument();
  });

  it('closes the filter panel on an outside click', () => {
    render(
      <div>
        <QrFilters initial={{}} categories={CATEGORIES} />
        <button type="button">Fuera</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filtro$/ }));
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Fuera' }));
    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
  });

  it('the Estado select offers exactly Activo / Revocado', () => {
    render(<QrFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro$/ }));
    expect(screen.getByRole('option', { name: 'Activo' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Revocado' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /descontinuad/i })).not.toBeInTheDocument();
  });

  it('applies categoryId/status as soon as each select changes', () => {
    render(<QrFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro$/ }));

    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'c1' } });
    expect(pushMock).toHaveBeenLastCalledWith('/qr?categoryId=c1');

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'revoked' } });
    expect(pushMock).toHaveBeenLastCalledWith('/qr?categoryId=c1&status=revoked');
  });

  it('shows the active-filter count on the Filtro button', () => {
    render(<QrFilters initial={{ categoryId: 'c1', status: 'active' }} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: 'Filtro (2)' })).toBeInTheDocument();
  });

  it('clears every filter but keeps the search text', () => {
    render(<QrFilters initial={{ q: 'wid', categoryId: 'c1', status: 'active' }} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(pushMock).toHaveBeenCalledWith('/qr?q=wid');
  });

  it('never sends a tenantId anywhere', () => {
    render(<QrFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro$/ }));
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'c1' } });
    expect(JSON.stringify(pushMock.mock.calls)).not.toMatch(/tenant_?id/i);
  });
});
