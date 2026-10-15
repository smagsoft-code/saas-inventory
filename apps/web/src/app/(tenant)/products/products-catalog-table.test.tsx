import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import { ApiError } from '../../../lib/api/errors';
import { ProductsCatalogTable } from './products-catalog-table';
import type { ProductCatalogRow } from '../../../lib/types/product-catalog';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const locationNames = new Map([['l1', 'Cuarentena QA']]);
const locationWarehouseNames = new Map([['l1', 'Sucursal Principal QA']]);

function row(overrides: Partial<ProductCatalogRow> = {}): ProductCatalogRow {
  return {
    productId: 'p1',
    productName: 'Widget',
    categoryId: 'c1',
    variantId: 'v1',
    sku: 'SKU-1',
    status: 'active',
    maxPrice: 120,
    basePrice: 100,
    availableQuantity: 7,
    ...overrides,
  };
}

describe('ProductsCatalogTable', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders one row per variant with SKU, stock, prices and status', () => {
    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map([['c1', 'Electrónica']])}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('120.00')).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('gives a product with two variants two rows, not one', () => {
    render(
      <ProductsCatalogTable
        rows={[row({ variantId: 'v1', sku: 'SKU-1' }), row({ variantId: 'v2', sku: 'SKU-2' })]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('SKU-2')).toBeInTheDocument();
  });

  it('keeps the detail panel collapsed until the expand icon is pressed', () => {
    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map([['c1', 'Electrónica']])}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    // The category lives in its own column; the expanded panel no longer repeats it.
    expect(screen.queryByText('Ver producto completo →')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Expandir Widget/ }));
    expect(screen.getByText('Ver producto completo →')).toBeInTheDocument();
    expect(screen.queryByText('Categoría:')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Contraer Widget/ }));
    expect(screen.queryByText('Ver producto completo →')).not.toBeInTheDocument();
  });

  it('links to "Generar" a QR for a variant that has none, and shows a scannable thumbnail for one that does', () => {
    render(
      <ProductsCatalogTable
        rows={[row({ variantId: 'v1' }), row({ variantId: 'v2', sku: 'SKU-2' })]}
        categoryNames={new Map()}
        qrValueByVariant={new Map([['v2', 'http://localhost:4000/q/abc123']])}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Generar' })).toHaveAttribute(
      'href',
      '/qr/new?productId=p1&variantId=v1',
    );
    expect(screen.getByRole('button', { name: /ver código qr de widget/i })).toBeInTheDocument();
  });

  it('opens a modal with a full-size QR and a print action when the thumbnail is clicked', () => {
    render(
      <ProductsCatalogTable
        rows={[row({ variantId: 'v1' })]}
        categoryNames={new Map()}
        qrValueByVariant={new Map([['v1', 'http://localhost:4000/q/abc123']])}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ver código qr de widget/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('http://localhost:4000/q/abc123')).toBeInTheDocument();
    expect(screen.getByText('Precio máximo: 120.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Imprimir' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('has a Categoría column (name of the product\'s category, "—" when none)', () => {
    render(
      <ProductsCatalogTable
        rows={[row({ categoryId: 'c1' }), { ...row({ variantId: 'v2', sku: 'SKU-2' }), categoryId: undefined as unknown as string }]}
        categoryNames={new Map([['c1', 'Electrónica']])}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('Categoría')).toBeGreaterThan(headers.indexOf('Nombre'));
    expect(headers.indexOf('Categoría')).toBeLessThan(headers.indexOf('Código'));
    expect(screen.getByText('Electrónica')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('the edit action is an icon (pencil) with an accessible name, not the word "Editar"', () => {
    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    const edit = screen.getByRole('link', { name: 'Editar' });
    expect(edit).toHaveTextContent('');
    expect(edit.querySelector('svg')).not.toBeNull();
  });

  it('links Editar to the variant edit page, and reads "Ver" when the caller cannot manage', () => {
    const { rerender } = render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/products/p1/variants/v1');

    rerender(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage={false}
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ver' })).toBeInTheDocument();
  });

  it('renders the row thumbnail from thumbnailUrl, and a placeholder when absent', () => {
    const { container } = render(
      <ProductsCatalogTable
        rows={[row({ variantId: 'v1', thumbnailUrl: '/api/v1/products/p1/images/img-1' }), row({ variantId: 'v2', sku: 'SKU-2' })]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('src', '/api/v1/products/p1/images/img-1');
  });

  it('tells a caller without inventory.view they need the permission, and never fetches balances', () => {
    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={new Map()}
        locationWarehouseNames={new Map()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Expandir Widget/ }));
    expect(screen.getByText(/necesitas el permiso de inventario/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('lists the attributes under the product name (Color: Crema; Medidas: 80 cm)', () => {
    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        attributeLineByVariant={new Map([['v1', 'Color: Crema; Medidas: 80 cm']])}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory={false}
        locationNames={locationNames}
        locationWarehouseNames={locationWarehouseNames}
      />,
    );
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('Color: Crema; Medidas: 80 cm')).toBeInTheDocument();
  });

  it('lazily fetches Existencias on first expand and renders Almacén/Sucursal/Disponible/Físico/Reservado/Comprometido', async () => {
    mockedFetch.mockResolvedValue({
      data: [
        {
          id: 'b1',
          productVariantId: 'v1',
          locationId: 'l1',
          quantityPhysical: 1,
          quantityReserved: 0,
          quantityCommitted: 0,
          quantityAvailable: 1,
        },
      ],
    });

    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory
        locationNames={locationNames}
        locationWarehouseNames={locationWarehouseNames}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Expandir Widget/ }));
    expect(screen.getByText(/cargando existencias/i)).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/balances', {
      query: { productVariantId: 'v1', pageSize: 100 },
    });

    await waitFor(() => expect(screen.getByText('Cuarentena QA')).toBeInTheDocument());
    expect(screen.getByText('Sucursal Principal QA')).toBeInTheDocument();
    // Sucursal comes first, then Almacén.
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers.indexOf('Sucursal')).toBeGreaterThan(-1);
    expect(headers.indexOf('Sucursal')).toBeLessThan(headers.indexOf('Almacén'));
    expect(screen.getByText('Movimientos')).toBeInTheDocument();
    expect(screen.getByText('Ajustar')).toBeInTheDocument();

    // Re-collapsing and re-expanding must not re-fetch.
    fireEvent.click(screen.getByRole('button', { name: /Contraer Widget/ }));
    fireEvent.click(screen.getByRole('button', { name: /Expandir Widget/ }));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('shows an error message when the balances fetch fails', async () => {
    mockedFetch.mockRejectedValue(new ApiError(500, 'INTERNAL', 'boom', undefined));

    render(
      <ProductsCatalogTable
        rows={[row()]}
        categoryNames={new Map()}
        qrValueByVariant={new Map()}
        canManage
        canViewInventory
        locationNames={locationNames}
        locationWarehouseNames={locationWarehouseNames}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Expandir Widget/ }));
    });
    await waitFor(() => expect(screen.getByText(/algo salió mal de nuestro lado/i)).toBeInTheDocument());
  });
});
