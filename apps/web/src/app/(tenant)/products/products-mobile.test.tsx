import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../../lib/api/client';
import type { ProductCatalogRow } from '../../../lib/types/product-catalog';
import { parseAttributeLine, ProductsChips, ProductsKpis, ProductsMobileList } from './products-mobile';
import { PRODUCTS_MOBILE_THEMES } from './products-mobile-theme';

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('./product-preview-modal', () => ({
  ProductPreviewModal: ({ children, productName }: { children: React.ReactNode; productName: string }) => (
    <button type="button" aria-label={`Ver foto y resumen de ${productName}`}>
      {children}
    </button>
  ),
}));
vi.mock('../../../components/qr-thumbnail-modal', () => ({ QrThumbnailModal: ({ label }: { label: string }) => <button type="button">{`QR ${label}`}</button> }));
const mockedFetch = vi.mocked(apiFetch);

const row = (overrides: Partial<ProductCatalogRow> = {}): ProductCatalogRow => ({
  productId: 'p1',
  productName: 'Aparador Grande Dos Niveles',
  categoryId: 'c1',
  variantId: 'v1',
  sku: 'APA-001',
  status: 'active',
  maxPrice: 110,
  basePrice: 100,
  availableQuantity: 21,
  ...overrides,
});

function renderList(rows: ProductCatalogRow[], extra: Partial<Parameters<typeof ProductsMobileList>[0]> = {}) {
  return render(
    <ProductsMobileList
      rows={rows}
      total={rows.length}
      categoryNames={new Map([['c1', 'Aparador']])}
      attributeLineByVariant={new Map([['v1', 'Color: Vino; Medidas: 200 cm']])}
      qrValueByVariant={new Map()}
      canManage={false}
      canViewInventory
      locationNames={new Map([['loc1', 'Almacén Principal']])}
      locationWarehouseNames={new Map([['loc1', 'Sucursal Matriz']])}
      {...extra}
    />,
  );
}

describe('parseAttributeLine', () => {
  it('splits "Label: value; Label: value" and tolerates junk', () => {
    expect(parseAttributeLine('Color: Vino; Medidas: 200 cm')).toEqual([
      { label: 'Color', value: 'Vino' },
      { label: 'Medidas', value: '200 cm' },
    ]);
    expect(parseAttributeLine(undefined)).toEqual([]);
    expect(parseAttributeLine('sin dos puntos')).toEqual([]);
  });
});

describe('ProductsKpis', () => {
  const data = { totalModels: 56, totalStock: 37, availablePercent: 80, outOfStockCount: 1, firstOutOfStockSku: 'ARM-002', modelsCaption: 'Activos' };

  it('shows total models, total stock with the available share, and the out-of-stock model', () => {
    render(<ProductsKpis data={data} />);
    expect(screen.getByText('Total modelos')).toBeInTheDocument();
    expect(screen.getByText('56')).toBeInTheDocument();
    expect(screen.getByText('Activos')).toBeInTheDocument();
    expect(screen.getByText('37')).toBeInTheDocument();
    expect(screen.getByText('80% disp.')).toBeInTheDocument();
    expect(screen.getByText('modelo')).toBeInTheDocument();
    expect(screen.getByText('⚠ ARM-002')).toBeInTheDocument();
  });

  it('shows "—" (never 0) when the stock figures are unknown or not permitted', () => {
    render(<ProductsKpis data={{ ...data, totalStock: null, availablePercent: null, outOfStockCount: null, firstOutOfStockSku: undefined }} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('No disponible')).toBeInTheDocument();
  });
});

describe('ProductsChips', () => {
  it('renders each active filter as a link that removes it', () => {
    render(<ProductsChips chips={[{ key: 's', label: 'Activos', removeHref: '/products?status=all', tone: 'accent' }, { key: 'k', label: 'Con stock', removeHref: '/products', tone: 'accent' }]} />);
    expect(screen.getByText('Activos:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Quitar filtro Activos' })).toHaveAttribute('href', '/products?status=all');
  });

  it('renders nothing without filters', () => {
    const { container } = render(<ProductsChips chips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ProductsMobileList', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('counts the models and shows code, stock line, price, name, category and badges per card', () => {
    renderList([row()]);
    expect(screen.getByText('1 modelo encontrado')).toBeInTheDocument();
    expect(screen.getByText('Toca para expandir detalle')).toBeInTheDocument();
    expect(screen.getByText('APA-001')).toBeInTheDocument();
    expect(screen.getByText('En stock (21 un.)')).toBeInTheDocument();
    expect(screen.getByText('110.00')).toBeInTheDocument();
    expect(screen.getByText('Aparador Grande Dos Niveles')).toBeInTheDocument();
    expect(screen.getByText('Categoría: Aparador')).toBeInTheDocument();
    expect(screen.getByText('21 en stock')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
  });

  it('an out-of-stock model is flagged as sold out, in red', () => {
    renderList([row({ variantId: 'v2', sku: 'ARM-002', availableQuantity: 0 })], { attributeLineByVariant: new Map() });
    expect(screen.getByText('Agotado')).toBeInTheDocument();
    expect(screen.getByText('0 un. (Agotado)')).toBeInTheDocument();
    expect(screen.getByText('Reponer')).toBeInTheDocument();
    expect(screen.getByText('ARM-002')).toHaveClass('text-red-600');
  });

  it('shows the product photo, and tapping it opens the same summary as the web table', () => {
    const { container } = renderList([row({ thumbnailUrl: '/api/v1/products/p1/images/i1' })]);
    const photo = screen.getByRole('button', { name: 'Ver foto y resumen de Aparador Grande Dos Niveles' });
    expect(photo.querySelector('img')).toHaveAttribute('src', '/api/v1/products/p1/images/i1');
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  it('without a photo it shows the same empty placeholder as the web (never a broken image)', () => {
    const { container } = renderList([row()]);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver foto y resumen de Aparador Grande Dos Niveles' })).toBeInTheDocument();
  });

  it('tapping a card expands it: attributes, base price, estimated margin, locations with stock, QR and product link', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [{ id: 'b1', locationId: 'loc1', quantityAvailable: 21, quantityPhysical: 21, quantityReserved: 0, quantityCommitted: 0 }] });
    renderList([row()], { qrValueByVariant: new Map([['v1', 'https://x/q/abc']]) });
    const card = screen.getByRole('button', { name: /APA-001/ });
    expect(card).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(card);

    expect(card).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Color')).toBeInTheDocument();
    expect(screen.getByText('Vino')).toBeInTheDocument();
    expect(screen.getByText('200 cm')).toBeInTheDocument();
    expect(screen.getByText('$100.00')).toBeInTheDocument();
    expect(screen.getByText('+$10.00')).toBeInTheDocument();
    expect(await screen.findByText('Sucursal Matriz · Almacén Principal')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/inventory/balances', { query: { productVariantId: 'v1', pageSize: 100 } });
    expect(screen.getByText('Código QR')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver producto/ })).toHaveAttribute('href', '/products/p1/variants/v1');

    fireEvent.click(card); // collapse again
    expect(card).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Vino')).not.toBeInTheDocument();
  });

  it('offers "Generar QR" when the variant has none, and "Editar producto" to a manager', async () => {
    mockedFetch.mockResolvedValueOnce({ data: [] });
    renderList([row()], { canManage: true });
    fireEvent.click(screen.getByRole('button', { name: /APA-001/ }));
    expect(screen.getByRole('link', { name: 'Generar QR' })).toHaveAttribute('href', '/qr/new?productId=p1&variantId=v1');
    expect(screen.getByRole('link', { name: /Editar producto/ })).toBeInTheDocument();
  });

  it('never fetches balances without inventory.view', () => {
    renderList([row()], { canViewInventory: false });
    fireEvent.click(screen.getByRole('button', { name: /APA-001/ }));
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Ubicación')).not.toBeInTheDocument();
  });

  it('shows a failed balances read inside the card, not a crash', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('boom'));
    renderList([row()]);
    fireEvent.click(screen.getByRole('button', { name: /APA-001/ }));
    await waitFor(() => expect(within(screen.getByText('Ubicación').parentElement!).getByText(/Algo salió mal/)).toBeInTheDocument());
  });
});

describe('theme tokens', () => {
  it('light renders now; dark is kept complete for a later switch (same keys, different classes)', () => {
    const light = PRODUCTS_MOBILE_THEMES.light;
    const dark = PRODUCTS_MOBILE_THEMES.dark;
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    expect(light.card).toContain('bg-white');
    expect(dark.card).toContain('bg-[#101a2b]');
  });

  it('theme="dark" swaps the classes without touching the markup or logic', () => {
    renderList([row()], { theme: 'dark' });
    expect(screen.getByText('APA-001')).toHaveClass('text-cyan-300');
  });
});
