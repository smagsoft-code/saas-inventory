'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { CreateQrCodeInput, PendingQrVariant, QrCode, QrTargetType } from '../../../../lib/types/qr';
import { Alert } from '../../../../components/ui/alert';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { QrThumbnailModal } from '../../../../components/qr-thumbnail-modal';

interface Option {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}
interface VariantOption {
  id: string;
  sku: string;
  maxPrice: number;
}

const QR_PATH = '/api/v1/qr-codes';
const PENDING_PATH = '/api/v1/qr-codes/pending-variants';
const PENDING_PAGE_SIZE = 100;

/**
 * Creates a QR code — `POST /api/v1/qr-codes` (`catalog.qr.manage`). Body is exactly
 * `CreateQrCodeDto` (`targetType`, `targetId`, `expiresAt?`) — never `tenantId`/`code`/`status`.
 * Client validation is a UX mirror; the backend re-validates the target against the caller's tenant
 * and re-authorizes.
 *
 * Picking a product variant is Categoría → Producto → Variante, and the Producto list is fed by
 * `GET /qr-codes/pending-variants` — i.e. only products that still have at least one variant
 * *without* an active QR (never a plain product list capped at 100, which hid imported products).
 * When the chosen product has exactly one variant left without a QR it is selected for the caller.
 * A QR for an Almacén (location) is still possible through the "almacén" toggle below the form.
 *
 * `initialProductId`/`initialVariantId` (from `/products`' own "Generar" link) pre-select the target.
 * After a successful create, this shows the same enlarged view (`QrThumbnailModal`, `defaultOpen`) a
 * click on the `/products` thumbnail already opens, so printing works immediately in the same place.
 */
export function QrForm({
  categories,
  initialPending,
  initialPendingTotal,
  warehouses,
  locations,
  variantIdsWithActiveQr,
  locationIdsWithActiveQr,
  initialProductId,
  initialVariantId,
  publicUrl,
}: {
  categories: Option[];
  /** The first page of variants with no active QR (`pending-variants`, unfiltered). */
  initialPending: PendingQrVariant[];
  initialPendingTotal?: number;
  warehouses: Option[];
  locations: LocationOption[];
  /** Targets that already have an active QR are disabled so the caller can only pick one that
   * doesn't, instead of only finding out from the backend's 409 after submitting. Bounded to the
   * first 100 — the backend's own check still catches anything outside that range. */
  variantIdsWithActiveQr: Set<string>;
  locationIdsWithActiveQr: Set<string>;
  initialProductId?: string;
  initialVariantId?: string;
  /** `apiPublicUrl()`, computed server-side and handed down — a Client Component can't read
   * `API_URL` itself (only `NEXT_PUBLIC_`-prefixed vars reach the browser bundle). */
  publicUrl: string;
}): React.JSX.Element {
  const router = useRouter();

  const [targetType, setTargetType] = useState<QrTargetType>('product_variant');
  const [categoryId, setCategoryId] = useState('');
  const [pending, setPending] = useState<PendingQrVariant[]>(initialPending);
  const [pendingTotal, setPendingTotal] = useState(initialPendingTotal ?? initialPending.length);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [created, setCreated] = useState<QrCode | null>(null);
  const [createdLabel, setCreatedLabel] = useState<string | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState(initialVariantId ?? null);

  const locationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === warehouseId),
    [locations, warehouseId],
  );

  /** Distinct products that still have a variant without a QR. */
  const productOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of pending) {
      if (!seen.has(row.productId)) seen.set(row.productId, row.productName);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [pending]);
  const pendingVariantIds = useMemo(() => new Set(pending.map((p) => p.variantId)), [pending]);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const targetId = targetType === 'location' ? locationId : productVariantId;
  const canSubmit = targetId !== '' && !submitting;

  /** A variant can be picked only if it has no active QR: it is in the pending list, and not known
   * (from the server-side bounded list) to already have one. */
  function variantUnavailableReason(variantId: string): string | null {
    if (variantIdsWithActiveQr.has(variantId)) return 'ya tiene QR activo';
    if (!pendingVariantIds.has(variantId)) return 'no disponible';
    return null;
  }

  async function loadPending(nextCategoryId: string): Promise<void> {
    setPendingLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number> = { page: 1, pageSize: PENDING_PAGE_SIZE };
      if (nextCategoryId) query['categoryId'] = nextCategoryId;
      const result = await apiFetch<{ data: PendingQrVariant[]; meta?: { total: number } }>(PENDING_PATH, { query });
      setPending(result.data);
      setPendingTotal(result.meta?.total ?? result.data.length);
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setPendingLoading(false);
    }
  }

  function onCategoryChange(nextId: string): void {
    setCategoryId(nextId);
    setProductId('');
    setVariants([]);
    setProductVariantId('');
    setFieldError({});
    void loadPending(nextId);
  }

  async function onProductChange(nextId: string): Promise<void> {
    setProductId(nextId);
    setProductVariantId('');
    setVariants([]);
    if (!nextId) {
      return;
    }
    setVariantsLoading(true);
    try {
      const rows = await apiFetch<{ id: string; sku: string; maxPrice: number }[]>(
        `/api/v1/products/${nextId}/variants`,
      );
      setVariants(rows.map((r) => ({ id: r.id, sku: r.sku, maxPrice: r.maxPrice })));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(false);
    }
  }

  // Pre-select the product handed in via `?productId=` (the `/products` "Generar" link) — once,
  // on mount only (empty deps deliberate, same as `products-filters.tsx`'s own debounce effect —
  // this project's eslint config has no react-hooks rule).
  useEffect(() => {
    if (initialProductId && initialPending.some((p) => p.productId === initialProductId)) {
      void onProductChange(initialProductId);
    }
  }, []);

  // Once that product's variants have loaded: apply the pending `?variantId=`, otherwise — when
  // exactly one variant of the product is still available — select it by default.
  useEffect(() => {
    if (variants.length === 0) return;
    if (pendingVariantId && variants.some((v) => v.id === pendingVariantId)) {
      setProductVariantId(pendingVariantId);
      setPendingVariantId(null);
      return;
    }
    const available = variants.filter((v) => variantUnavailableReason(v.id) === null);
    if (available.length === 1 && productVariantId === '') {
      setProductVariantId(available[0]!.id);
    }
  }, [variants, pendingVariantId]);

  function resetForAnother(): void {
    setCreated(null);
    setCreatedLabel(null);
    setTargetType('product_variant');
    setProductId('');
    setVariants([]);
    setProductVariantId('');
    setWarehouseId('');
    setLocationId('');
    setExpiresAt('');
    setError(null);
    setFieldError({});
  }

  function onTargetTypeChange(next: QrTargetType): void {
    setTargetType(next);
    setError(null);
    setFieldError({});
    setProductId('');
    setVariants([]);
    setProductVariantId('');
    setWarehouseId('');
    setLocationId('');
  }

  function onWarehouseChange(nextWarehouseId: string): void {
    setWarehouseId(nextWarehouseId);
    setLocationId('');
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (targetType === 'product_variant' && !productVariantId) {
      next['targetId'] = 'Elige un producto y una variante.';
    } else if (targetType === 'product_variant' && variantUnavailableReason(productVariantId)) {
      next['targetId'] = 'Esta variante ya tiene un código QR activo. Revócalo antes de generar uno nuevo.';
    }
    if (targetType === 'location' && !locationId) {
      next['targetId'] = 'Elige un almacén.';
    } else if (targetType === 'location' && locationIdsWithActiveQr.has(locationId)) {
      next['targetId'] = 'Este almacén ya tiene un código QR activo. Revócalo antes de generar uno nuevo.';
    }
    if (expiresAt !== '' && Number.isNaN(new Date(expiresAt).getTime())) {
      next['expiresAt'] = 'Ingresa una fecha válida.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !canSubmit || !validate()) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const body: CreateQrCodeInput = { targetType, targetId };
      if (expiresAt !== '') {
        // A calendar date → end of that day, UTC (the DTO wants an ISO date-time).
        body.expiresAt = new Date(`${expiresAt}T23:59:59.999Z`).toISOString();
      }
      const createdQr = await apiFetch<QrCode>(QR_PATH, { method: 'POST', body });
      if (targetType === 'product_variant') {
        const productName = productOptions.find((p) => p.id === productId)?.name;
        const sku = variants.find((v) => v.id === productVariantId)?.sku;
        setCreatedLabel(sku ? `${productName ?? 'Producto'} — ${sku}` : (productName ?? 'Variante'));
        // It has a QR now: drop it from the "still without QR" list the pickers read.
        setPending((cur) => cur.filter((p) => p.variantId !== productVariantId));
      } else {
        setCreatedLabel(locations.find((l) => l.id === locationId)?.name ?? 'Almacén');
      }
      setCreated(createdQr);
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para generar un código QR para este destino.');
      } else if (isApiError(err) && err.status === 409) {
        setError('Este destino ya tiene un código QR activo. Revócalo antes de generar uno nuevo.');
      } else {
        setError(httpErrorMessage(err));
      }
      setSubmitting(false);
    }
  }

  if (created) {
    const variant = variants.find((v) => v.id === productVariantId);
    const qrValue = `${publicUrl.replace(/\/$/, '')}/q/${created.code}`;
    return (
      <div className="flex max-w-md flex-col gap-4">
        <Alert tone="success">Código QR generado.</Alert>
        <QrThumbnailModal
          value={qrValue}
          label={createdLabel ?? 'Código QR'}
          {...(created.targetType === 'product_variant' && variant ? { maxPrice: variant.maxPrice } : {})}
          defaultOpen
        />
        <div className="flex gap-2">
          <ButtonLink href="/qr">Ver todos los QR</ButtonLink>
          <Button type="button" variant="ghost" onClick={resetForAnother}>
            Generar otro
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      {targetType === 'product_variant' ? (
        <>
          <Field label="Categoría" {...(pendingLoading ? { hint: 'Cargando productos…' } : {})}>
            <Select value={categoryId} onChange={(event) => onCategoryChange(event.target.value)}>
              <option value="">Todas las categorías</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Producto"
            help="Solo aparecen productos que todavía tienen alguna variante sin código QR."
            {...(pendingTotal > pending.length ? { hint: `Mostrando ${pending.length} de ${pendingTotal} variantes sin QR — filtra por categoría.` } : {})}
          >
            <Select
              value={productId}
              disabled={pendingLoading}
              onChange={(event) => void onProductChange(event.target.value)}
            >
              <option value="">
                {productOptions.length === 0 ? 'No hay productos sin QR' : 'Selecciona un producto…'}
              </option>
              {productOptions.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Variante"
            {...(fieldError['targetId'] ? { error: fieldError['targetId'] } : {})}
            {...(variantsLoading ? { hint: 'Cargando variantes…' } : {})}
          >
            <Select
              value={productVariantId}
              onChange={(event) => setProductVariantId(event.target.value)}
              disabled={!productId || variantsLoading}
            >
              <option value="">{productId ? 'Selecciona una variante…' : 'Elige primero un producto'}</option>
              {variants.map((variant) => {
                const reason = variantUnavailableReason(variant.id);
                return (
                  <option key={variant.id} value={variant.id} disabled={reason !== null}>
                    {variant.sku}
                    {reason ? ` (${reason})` : ''}
                  </option>
                );
              })}
            </Select>
          </Field>
          <button
            type="button"
            onClick={() => onTargetTypeChange('location')}
            className="w-fit text-sm font-medium text-slate-500 underline-offset-2 hover:underline"
          >
            Generar QR de un almacén en lugar de un producto
          </button>
        </>
      ) : (
        <>
          <Field label="Sucursal">
            <Select value={warehouseId} onChange={(event) => onWarehouseChange(event.target.value)}>
              <option value="">Selecciona una sucursal…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Almacén" {...(fieldError['targetId'] ? { error: fieldError['targetId'] } : {})}>
            <Select value={locationId} disabled={!warehouseId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">{warehouseId ? 'Selecciona un almacén…' : 'Elige primero una sucursal'}</option>
              {locationsInWarehouse.map((location) => (
                <option key={location.id} value={location.id} disabled={locationIdsWithActiveQr.has(location.id)}>
                  {location.name}
                  {locationIdsWithActiveQr.has(location.id) ? ' (ya tiene QR activo)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <button
            type="button"
            onClick={() => onTargetTypeChange('product_variant')}
            className="w-fit text-sm font-medium text-slate-500 underline-offset-2 hover:underline"
          >
            Volver a generar QR de un producto
          </button>
        </>
      )}

      <Field
        label="Vence el"
        help="Opcional. El código deja de resolverse al final de este día (UTC)."
        {...(fieldError['expiresAt'] ? { error: fieldError['expiresAt'] } : {})}
      >
        <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit}>
          Generar
        </Button>
        <Button type="button" variant="ghost" disabled={submitting} onClick={() => router.push('/qr')}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
