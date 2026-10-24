import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from '../lib/fetch-all';
import { buildOrdersExportHref } from '../lib/sales/orders';
import { buildCustomersExportHref } from '../lib/sales/customers';
import { buildProductCatalogExportHref } from '../lib/catalog/product-catalog';
import { buildTransfersExportHref } from '../lib/inventory/transfers';
import { ListViewControls } from './list-view-controls';

const base = { allHref: '/x?all=1', pagedHref: '/x', excelHref: '/x/export?format=xlsx', pdfHref: '/x/export?format=pdf' };

describe('ListViewControls', () => {
  it('offers "Ver todos" (linking to the all view) and the two export icons', () => {
    render(<ListViewControls {...base} showingAll={false} shown={20} total={85} />);
    expect(screen.getByRole('link', { name: 'Ver todos' })).toHaveAttribute('href', '/x?all=1');
    expect(screen.getByRole('link', { name: 'Exportar a Excel' })).toHaveAttribute('href', '/x/export?format=xlsx');
    expect(screen.getByRole('link', { name: 'Exportar a PDF' })).toHaveAttribute('href', '/x/export?format=pdf');
  });

  it('in the all view it counts what is shown and offers "Ver paginado"', () => {
    render(<ListViewControls {...base} showingAll shown={85} total={85} />);
    expect(screen.getByText('Mostrando todos: 85.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver paginado' })).toHaveAttribute('href', '/x');
    expect(screen.queryByRole('link', { name: 'Ver todos' })).not.toBeInTheDocument();
  });

  it('says so when the on-screen cap cut the list, instead of implying it is complete', () => {
    render(<ListViewControls {...base} showingAll shown={1000} total={1500} truncated />);
    expect(screen.getByRole('status')).toHaveTextContent('Mostrando los primeros 1000 de 1500');
  });

  it('hides the toggle when everything already fits one page, but keeps the exports', () => {
    render(<ListViewControls {...base} showingAll={false} shown={5} total={5} canToggle={false} />);
    expect(screen.queryByRole('link', { name: 'Ver todos' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Exportar a Excel' })).toBeInTheDocument();
  });
});

describe('fetchAllPages', () => {
  const page = (n: number, size: number, total: number) => ({
    data: Array.from({ length: Math.max(0, Math.min(size, total - (n - 1) * size)) }, (_, i) => (n - 1) * size + i),
    meta: { page: n, pageSize: size, total, totalPages: Math.ceil(total / size) },
  });

  it('reads every page (100 rows each) and concatenates them in order', async () => {
    const fetchPage = vi.fn(async (n: number, size: number) => page(n, size, 250));
    const result = await fetchAllPages(fetchPage);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(result.data).toHaveLength(250);
    expect(result.data[0]).toBe(0);
    expect(result.data[249]).toBe(249);
    expect(result).toMatchObject({ total: 250, truncated: false });
  });

  it('does a single request for a short list', async () => {
    const fetchPage = vi.fn(async (n: number, size: number) => page(n, size, 7));
    expect((await fetchAllPages(fetchPage)).data).toHaveLength(7);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('stops at the cap and reports truncation', async () => {
    const fetchPage = vi.fn(async (n: number, size: number) => page(n, size, 5000));
    const result = await fetchAllPages(fetchPage, 300);
    expect(result.data).toHaveLength(300);
    expect(result).toMatchObject({ total: 5000, truncated: true });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});

describe('export hrefs carry the filters and never a page', () => {
  it('orders', () => {
    const href = buildOrdersExportHref({ dateFrom: '2026-10-13', status: 'confirmed', customerName: 'ana', sort: 'total', dir: 'asc', page: 4, pageSize: 20 }, 'pdf');
    expect(href).toContain('/api/v1/orders/export?');
    expect(href).toContain('format=pdf');
    expect(href).toContain('dateFrom=2026-10-13');
    expect(href).toContain('status=confirmed');
    expect(href).toContain('customerName=ana');
    expect(href).toContain('sort=total');
    expect(href).not.toContain('page');
  });

  it('customers', () => {
    expect(buildCustomersExportHref({ q: 'juan' }, 'xlsx')).toBe('/api/v1/customers/export?format=xlsx&q=juan');
    expect(buildCustomersExportHref({}, 'xlsx')).toBe('/api/v1/customers/export?format=xlsx');
  });

  it('products', () => {
    const href = buildProductCatalogExportHref({ q: 'sofa', categoryId: 'cat-1', status: 'active', stock: 'with' }, 'pdf');
    expect(href).toBe('/api/v1/reports/product-catalog/export?format=pdf&q=sofa&categoryId=cat-1&status=active&stock=with');
    expect(buildProductCatalogExportHref({}, 'xlsx')).toBe('/api/v1/reports/product-catalog/export?format=xlsx');
  });

  it('transfers', () => {
    const href = buildTransfersExportHref({ status: 'dispatched', sourceLocationId: 'loc-1' }, 'xlsx');
    expect(href).toBe('/api/v1/inventory/transfers/export?format=xlsx&status=dispatched&sourceLocationId=loc-1');
  });
});
