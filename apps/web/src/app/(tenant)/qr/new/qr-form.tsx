'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  QR_TARGET_TYPES,
  QR_TARGET_TYPE_LABELS,
  type CreateQrCodeInput,
  type QrCode,
  type QrTargetType,
} from '../../../../lib/types/qr';
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

/**
 * Creates a QR code — `POST /api/v1/qr-codes` (`catalog.qr.manage`). Body is exactly
 * `CreateQrCodeDto` (`targetType`, `targetId`, `expiresAt?`) — never `tenantId`/`code`/`status`.
 * The target is picked as Product → Variant (`GET /products/:id/variants`) or Location. Client
 * validation is a UX mirror; the backend re-validates the target against the caller's tenant and
 * re-authorizes.
 *
 * UI-UX QR block: `initialProductId`/`initialVariantId` (from `/products`' own "Generar" link,
 * `?productId=&variantId=`) pre-select the target instead of leaving the caller to re-pick it.
 * After a successful create, this no longer redirects — it shows the same enlarged view
 * (`QrThumbnailModal`, `defaultOpen`) a click on the `/products` thumbnail already opens, so
 * printing works immediately in the same place, not after a detour through `/qr`.
 */
export function QrForm({
  products,
  warehouses,
  locations,
  variantIdsWithActiveQr,
  locationIdsWithActiveQr,
  initialProductId,
  initialVariantId,
  publicUrl,
}: {
  products: Option[];
  warehouses: Option[];
  locations: LocationOption[];
  /** OUI-010 — targets that already have an active QR are disabled here so the caller can only
   * ever pick one that doesn't, instead of only finding out from the backend's 409 after
   * submitting. Bounded to the first 100 (same convention as everywhere else in this app) — a
   * target outside that range simply isn't pre-marked; the backend's own check still catches it. */
  variantIdsWithActiveQr: Set<string>;
  locationIdsWithActiveQr: Set<string>;
  initialProductId?: string;
  initialVariantId?: string;
  /** `apiPublicUrl()`, computed server-side and handed down — a Client Component can't read
   * `API_URL` itself (only `NEXT_PUBLIC_`-prefixed vars reach the browser bundle), same convention
   * `product-form.tsx` already uses for its own post-create QR panel. */
  publicUrl: string;
}): React.JSX.Element {
  const router = useRouter();

  const [targetType, setTargetType] = useState<QrTargetType>('product_variant');
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [created, setCreated] = useState<QrCode | null>(null);
  const [pendingVariantId, setPendingVariantId] = useState(initialVariantId ?? null);

  const locationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === warehouseId),
    [locations, warehouseId],
  );

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const targetId = targetType === 'location' ? locationId : productVariantId;
  const canSubmit = targetId !== '' && !submitting;

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
  // this project's eslint config has no react-hooks rule); the caller is free to change the
  // selection afterward like any other field.
  useEffect(() => {
    if (initialProductId && products.some((p) => p.id === initialProductId)) {
      void onProductChange(initialProductId);
    }
  }, []);

  // Once that product's variants have loaded, apply the pending `?variantId=` — separate effect
  // because the fetch above is async and `variants` only exists after it resolves.
  useEffect(() => {
    if (pendingVariantId && variants.some((v) => v.id === pendingVariantId)) {
      setProductVariantId(pendingVariantId);
      setPendingVariantId(null);
    }
  }, [variants, pendingVariantId]);

  function resetForAnother(): void {
    setCreated(null);
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
    } else if (targetType === 'product_variant' && variantIdsWithActiveQr.has(productVariantId)) {
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
      setCreated(createdQr);
      setSubmitting(false);
      // Refreshes this route's server data (`variantIdsWithActiveQr`/`locationIdsWithActiveQr`)
      // in place — `created` (local state) is untouched by this, so the success view below stays
      // put; it just means "Generar otro" immediately sees the target picked here as taken.
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
    const productName = products.find((p) => p.id === productId)?.name;
    const location = locations.find((l) => l.id === locationId);
    const label =
      created.targetType === 'location'
        ? (location?.name ?? 'Almacén')
        : variant
          ? `${productName ?? 'Producto'} — ${variant.sku}`
          : (productName ?? 'Variante');
    const qrValue = `${publicUrl.replace(/\/$/, '')}/q/${created.code}`;
    return (
      <div className="flex max-w-md flex-col gap-4">
        <Alert tone="success">Código QR generado.</Alert>
        <QrThumbnailModal
          value={qrValue}
          label={label}
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

      <Field label="Tipo de destino">
        <Select
          value={targetType}
          onChange={(event) => onTargetTypeChange(event.target.value as QrTargetType)}
        >
          {QR_TARGET_TYPES.map((type) => (
            <option key={type} value={type}>
              {QR_TARGET_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      {targetType === 'product_variant' ? (
        <>
          <Field label="Producto">
            <Select value={productId} onChange={(event) => void onProductChange(event.target.value)}>
              <option value="">Selecciona un producto…</option>
              {products.map((product) => (
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
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id} disabled={variantIdsWithActiveQr.has(variant.id)}>
                  {variant.sku}
                  {variantIdsWithActiveQr.has(variant.id) ? ' (ya tiene QR activo)' : ''}
                </option>
              ))}
            </Select>
          </Field>
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
