import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { ProductPreviewModal } from './product-preview-modal';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const product = {
  id: 'p1',
  categoryId: 'c1',
  name: 'Armario 3 niveles',
  description: '5 puertas, con espejo',
  status: 'active',
  attributes: { ATR001: 'crema', ATR002: 80 },
};
const variant = { id: 'v1', productId: 'p1', sku: 'ARM-001', attributes: {} };
const definitions = [
  { id: 'd1', code: 'ATR001', name: 'Color', dataType: 'select', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
  { id: 'd2', code: 'ATR002', name: 'Medidas', dataType: 'number', appliesTo: 'product', unitId: 'u1', isRequiredDefault: false, status: 'active' },
];
const assignments = [
  { attributeDefinitionId: 'd1', code: 'ATR001', name: 'Color', dataType: 'select', isRequired: false, displayOrder: 0 },
  { attributeDefinitionId: 'd2', code: 'ATR002', name: 'Medidas', dataType: 'number', isRequired: false, displayOrder: 1 },
];

function routeFetch(overrides: Record<string, unknown> = {}): void {
  mockedFetch.mockImplementation((async (path: string) => {
    if (path in overrides) {
      const value = overrides[path];
      if (value instanceof Error) throw value;
      return value;
    }
    if (path === '/api/v1/products/p1') return product;
    if (path === '/api/v1/products/p1/variants/v1') return variant;
    if (path === '/api/v1/attribute-definitions') return definitions;
    if (path === '/api/v1/measurement-units') return [{ id: 'u1', code: 'cm', label: 'Centímetros', dimension: 'length' }];
    if (path === '/api/v1/products/p1/images') return [{ id: 'i1', productId: 'p1', position: 0, createdAt: '', url: '/img/full.png' }];
    if (path === '/api/v1/categories/c1/attributes') return assignments;
    if (path === '/api/v1/attribute-definitions/d1/options') {
      return [{ id: 'o1', attributeDefinitionId: 'd1', code: 'crema', label: 'Crema', displayOrder: 0, status: 'active' }];
    }
    throw new Error(`unexpected fetch ${path}`);
  }) as never);
}

function renderModal(): void {
  render(
    <ProductPreviewModal
      productId="p1"
      variantId="v1"
      productName="Armario 3 niveles"
      sku="ARM-001"
      categoryName="Muebles"
      thumbnailUrl="/img/thumb.png"
      detailHref="/products/p1/variants/v1"
      canManage
    >
      <span>miniatura</span>
    </ProductPreviewModal>,
  );
}

describe('ProductPreviewModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches nothing until the photo is clicked', () => {
    routeFetch();
    renderModal();
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a dialog with the big photo, description and attributes (names, option labels, units)', async () => {
    routeFetch();
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Ver foto y resumen/ }));
    expect(await screen.findByText('5 puertas, con espejo')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Muebles')).toBeInTheDocument();
    expect(screen.getByText('ARM-001')).toBeInTheDocument();
    expect(screen.getByText('Color')).toBeInTheDocument();
    expect(screen.getByText('Crema')).toBeInTheDocument();
    expect(screen.getByText('Medidas')).toBeInTheDocument();
    expect(screen.getByText('80 cm')).toBeInTheDocument();
    expect(screen.getByAltText('Armario 3 niveles')).toHaveAttribute('src', '/img/full.png');
    expect(screen.getByRole('link', { name: 'Editar producto' })).toHaveAttribute('href', '/products/p1/variants/v1');
  });

  it('loads once: closing and reopening does not refetch', async () => {
    routeFetch();
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Ver foto y resumen/ }));
    await screen.findByText('5 puertas, con espejo');
    const calls = mockedFetch.mock.calls.length;
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Ver foto y resumen/ }));
    expect(await screen.findByText('5 puertas, con espejo')).toBeInTheDocument();
    expect(mockedFetch.mock.calls.length).toBe(calls);
  });

  it('shows an error with a retry when loading fails', async () => {
    routeFetch({ '/api/v1/products/p1': new ApiError(500, 'INTERNAL', 'boom', undefined) });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Ver foto y resumen/ }));
    expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('a product without images falls back to the thumbnail, and one without attributes says so', async () => {
    routeFetch({
      '/api/v1/products/p1/images': [],
      '/api/v1/products/p1': { ...product, categoryId: undefined, attributes: {} },
    });
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: /Ver foto y resumen/ }));
    expect(await screen.findByText('Sin atributos registrados.')).toBeInTheDocument();
    expect(screen.getByAltText('Armario 3 niveles')).toHaveAttribute('src', '/img/thumb.png');
  });
});
