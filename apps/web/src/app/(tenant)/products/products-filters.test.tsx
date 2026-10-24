import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsFilters } from './products-filters';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

const CATEGORIES = [{ id: 'c1', name: 'Electrónica' }];

describe('ProductsFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not navigate on mount even with an existing q', () => {
    render(<ProductsFilters initial={{ q: 'wid' }} categories={CATEGORIES} />);
    vi.advanceTimersByTime(1000);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('filters live as the owner types — debounced, not on every keystroke', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    const input = screen.getByLabelText('Buscar productos');
    fireEvent.change(input, { target: { value: 'w' } });
    fireEvent.change(input, { target: { value: 'wi' } });
    fireEvent.change(input, { target: { value: 'wid' } });
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(349);
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/products?q=wid', { scroll: false });
  });

  it('trims the search box and omits q entirely when it is blank', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.change(screen.getByLabelText('Buscar productos'), { target: { value: '   ' } });
    vi.advanceTimersByTime(400);
    expect(pushMock).toHaveBeenCalledWith('/products', { scroll: false });
  });

  it('hides the filter panel until "Filtro" is pressed', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Stock')).toBeInTheDocument();
  });

  it('closes the filter panel on an outside click, without pressing "Filtro" again', () => {
    render(
      <div>
        <ProductsFilters initial={{}} categories={CATEGORIES} />
        <button type="button">Fuera</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Fuera' }));
    expect(screen.queryByLabelText('Categoría')).not.toBeInTheDocument();
  });

  it('keeps the panel open when clicking inside it', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    fireEvent.mouseDown(screen.getByLabelText('Categoría'));
    expect(screen.getByLabelText('Categoría')).toBeInTheDocument();
  });

  it('labels the stock options "Con Stock" / "Sin Stock"', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    expect(screen.getByRole('option', { name: 'Con Stock' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sin Stock' })).toBeInTheDocument();
  });

  it('applies categoryId/status/stock as soon as each select changes', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));

    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'c1' } });
    expect(pushMock).toHaveBeenLastCalledWith('/products?categoryId=c1', { scroll: false });

    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'active' } });
    expect(pushMock).toHaveBeenLastCalledWith('/products?categoryId=c1&status=active', { scroll: false });

    fireEvent.change(screen.getByLabelText('Stock'), { target: { value: 'with' } });
    expect(pushMock).toHaveBeenLastCalledWith('/products?categoryId=c1&status=active&stock=with', { scroll: false });
  });

  it('the Filtro count is exactly the applied filters: Estado (unless Todos) + Categoría + Stock', () => {
    const { rerender } = render(<ProductsFilters initial={{ categoryId: 'c1', stock: 'without' }} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: 'Filtro (3)' })).toBeInTheDocument(); // Activos + categoría + stock
    rerender(<ProductsFilters initial={{ categoryId: 'c1', stock: 'without', status: 'all' }} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: 'Filtro (2)' })).toBeInTheDocument();
    rerender(<ProductsFilters initial={{ status: 'all' }} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: 'Filtro' })).toBeInTheDocument(); // none → no suffix
  });

  it('removing a filter from outside (a chip ×) drops it from the count and from the panel controls', () => {
    const { rerender } = render(<ProductsFilters initial={{ categoryId: 'c1', stock: 'with' }} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    expect(screen.getByLabelText('Categoría')).toHaveValue('c1');
    expect(screen.getByLabelText('Stock')).toHaveValue('with');
    // The page re-renders with the filters the URL now has (category chip removed).
    rerender(<ProductsFilters initial={{ stock: 'with' }} categories={CATEGORIES} />);
    expect(screen.getByRole('button', { name: 'Filtro (2)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Categoría')).toHaveValue('');
    expect(screen.getByLabelText('Stock')).toHaveValue('with');
  });

  it('clears every filter but keeps the search text', () => {
    render(<ProductsFilters initial={{ q: 'wid', categoryId: 'c1', status: 'active', stock: 'with' }} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(pushMock).toHaveBeenCalledWith('/products?q=wid', { scroll: false });
  });

  it('shows "Activo" selected by default (untouched) — and counts it, like the Activos chip', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    expect(screen.getByLabelText('Estado')).toHaveValue('active');
    expect(screen.getByRole('button', { name: 'Filtro (1)' })).toBeInTheDocument();
  });

  it('offers an explicit "Todos" choice, distinct from the untouched default, that asks for every status', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'all' } });
    expect(pushMock).toHaveBeenLastCalledWith('/products?status=all', { scroll: false });
  });

  it('never sends a tenantId anywhere', () => {
    render(<ProductsFilters initial={{}} categories={CATEGORIES} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtro/ }));
    fireEvent.change(screen.getByLabelText('Categoría'), { target: { value: 'c1' } });
    expect(JSON.stringify(pushMock.mock.calls)).not.toMatch(/tenant_?id/i);
  });

});
