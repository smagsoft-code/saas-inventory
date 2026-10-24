'use client';

import { ProductImageDimensions } from '../../../components/product-image-dimensions';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { buildAttributeSummary, type AttributeSummaryItem } from '../../../lib/catalog/attribute-summary';
import { loadCategoryAttributeFieldSets } from '../../../lib/catalog/product-attributes';
import type { AttributeDefinition, MeasurementUnit } from '../../../lib/types/catalog';
import {
  PRODUCT_STATUS_LABELS,
  type Product,
  type ProductImage,
  type ProductStatus,
  type Variant,
} from '../../../lib/types/products';
import { Badge } from '../../../components/ui/badge';
import { Modal } from '../../../components/ui/modal';
import { Spinner } from '../../../components/ui/spinner';

interface Preview {
  product: Product;
  /** Resolved from the product's own category when the caller did not pass a name. */
  categoryName: string | undefined;
  imageUrl: string | undefined;
  attributes: AttributeSummaryItem[];
}

/**
 * Click-the-photo preview of a product (the `/products` table): the picture at a readable size plus
 * the same facts "Ver producto" shows — name, code, status, category, description and the
 * attributes with their names and units. Everything is fetched the first time it opens (the table
 * itself stays light) with the same endpoints the product page uses; nothing is written here.
 * `children` is the thumbnail the user clicks.
 */
export function ProductPreviewModal({
  productId,
  variantId,
  productName,
  sku,
  categoryName,
  thumbnailUrl,
  detailHref,
  canManage,
  children,
}: {
  productId: string;
  variantId: string;
  productName: string;
  sku: string;
  categoryName?: string | undefined;
  /** Shown instantly while the full image loads. */
  thumbnailUrl?: string | undefined;
  detailHref: string;
  canManage: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; error?: string; data?: Preview }>({
    status: 'idle',
  });

  const load = useCallback(async (): Promise<void> => {
    setState({ status: 'loading' });
    try {
      const [product, variant, definitions, units, images] = await Promise.all([
        apiFetch<Product>(`/api/v1/products/${productId}`),
        apiFetch<Variant>(`/api/v1/products/${productId}/variants/${variantId}`),
        apiFetch<AttributeDefinition[]>('/api/v1/attribute-definitions'),
        apiFetch<MeasurementUnit[]>('/api/v1/measurement-units'),
        apiFetch<ProductImage[]>(`/api/v1/products/${productId}/images`).catch(() => [] as ProductImage[]),
      ]);
      // The cart has no category list at hand; the product's own category is looked up instead
      // (best-effort — a seller without categories.view just sees no category line).
      const resolvedCategoryName =
        categoryName ?? (product.categoryId ? await apiFetch<{ name: string }>(`/api/v1/categories/${product.categoryId}`).then((c) => c.name).catch(() => undefined) : undefined);
      const sets = await loadCategoryAttributeFieldSets(apiFetch, product.categoryId, definitions);
      const attributes = buildAttributeSummary({
        fields: [...sets.product, ...sets.variant],
        options: sets.options,
        definitions,
        units,
        values: { ...product.attributes, ...variant.attributes },
      });
      setState({ status: 'ready', data: { product, categoryName: resolvedCategoryName, imageUrl: images[0]?.url ?? thumbnailUrl, attributes } });
    } catch (err) {
      setState({ status: 'error', error: httpErrorMessage(err) });
    }
  }, [productId, variantId, thumbnailUrl, categoryName]);

  useEffect(() => {
    if (open && state.status === 'idle') void load();
  }, [open, state.status, load]);

  const close = useCallback(() => setOpen(false), []);
  const data = state.data;
  const image = data?.imageUrl ?? thumbnailUrl;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ver foto y resumen de ${productName}`}
        className="rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        {children}
      </button>
      <Modal open={open} onClose={close} title={productName} size="lg">
        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="sm:w-64 sm:shrink-0">
            {image ? (
              <img src={image} alt={productName} className="aspect-square w-full rounded-md border border-slate-200 bg-white object-contain" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
                Sin imagen
              </div>
            )}
            <ProductImageDimensions className="mt-2 mb-0" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 text-sm">
            <p className="text-slate-500">
              Código <span className="font-medium text-slate-900">{sku}</span>
              {data && (
                <Badge tone={data.product.status === 'active' ? 'success' : 'neutral'} className="ml-2">
                  {PRODUCT_STATUS_LABELS[data.product.status as ProductStatus] ?? data.product.status}
                </Badge>
              )}
            </p>
            {(categoryName ?? data?.categoryName) && (
              <p>
                <span className="text-slate-500">Categoría:</span> <span className="text-slate-800">{categoryName ?? data?.categoryName}</span>
              </p>
            )}

            {state.status === 'loading' && (
              <p className="flex items-center gap-2 text-slate-500" aria-busy="true">
                <Spinner className="h-4 w-4" /> Cargando…
              </p>
            )}
            {state.status === 'error' && (
              <p className="text-red-700">
                {state.error}{' '}
                <button type="button" className="font-medium underline" onClick={() => void load()}>
                  Reintentar
                </button>
              </p>
            )}

            {data && (
              <>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Descripción</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-800">{data.product.description || '—'}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Atributos</p>
                  {data.attributes.length === 0 ? (
                    <p className="mt-1 text-slate-500">Sin atributos registrados.</p>
                  ) : (
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      {data.attributes.map((item) => (
                        <div key={item.code} className="contents">
                          <dt className="text-slate-500">{item.label}</dt>
                          <dd className="text-slate-900">{item.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              </>
            )}

            <div className="mt-auto pt-2">
              <Link href={detailHref} className="text-sm font-medium text-slate-700 underline underline-offset-2">
                {canManage ? 'Editar producto' : 'Ver producto'}
              </Link>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}
