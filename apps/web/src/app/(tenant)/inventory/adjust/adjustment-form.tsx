'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  ADJUSTMENT_MOVEMENT_TYPES,
  MOVEMENT_TYPE_LABELS,
  type AdjustmentMovementType,
  type InventoryMovement,
} from '../../../../lib/types/inventory';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';

const ADJUSTMENTS_PATH = '/api/v1/inventory/adjustments';

export interface ProductOption {
  id: string;
  name: string;
}
export interface WarehouseOption {
  id: string;
  name: string;
}
export interface LocationOption {
  id: string;
  warehouseId: string;
  name: string;
}
interface VariantOption {
  id: string;
  sku: string;
}

/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in the browser's own timezone — `toISOString` would
 * shift to UTC and show the wrong wall-clock time to the user. */
function nowForDatetimeLocalInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * Records a manual stock adjustment — `POST /api/v1/inventory/adjustments` (`inventory.adjust` +
 * location authorization, ADR-0024). Body is exactly `CreateAdjustmentDto`; never `tenantId`.
 * When a `productVariantId` is passed in (drill-in from a variant/balance), the variant is fixed;
 * otherwise the user picks a product then one of its variants (`GET /products/:id/variants`).
 */
export function AdjustmentForm({
  fixedProductVariantId,
  fixedVariantLabel,
  fixedLocationId,
  products,
  warehouses,
  locations,
}: {
  fixedProductVariantId?: string;
  /** A human label (SKU) for the fixed variant when the caller knows it — display only. */
  fixedVariantLabel?: string;
  fixedLocationId?: string;
  products: ProductOption[];
  warehouses: WarehouseOption[];
  locations: LocationOption[];
}): React.JSX.Element {
  const router = useRouter();

  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState(fixedProductVariantId ?? '');
  // A drill-in `fixedLocationId` already implies its sucursal — preselect it so the almacén shows
  // immediately instead of forcing the user to re-pick the sucursal for a location they didn't choose.
  const [warehouseId, setWarehouseId] = useState(
    () => locations.find((l) => l.id === fixedLocationId)?.warehouseId ?? '',
  );
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [movementType, setMovementType] = useState<AdjustmentMovementType>('ADJUSTMENT_IN');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => nowForDatetimeLocalInput());

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [result, setResult] = useState<InventoryMovement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const variantFixed = Boolean(fixedProductVariantId);
  const locationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === warehouseId),
    [locations, warehouseId],
  );

  function onWarehouseChange(nextWarehouseId: string): void {
    setWarehouseId(nextWarehouseId);
    setLocationId('');
    setResult(null);
  }

  const canSubmit = useMemo(
    () =>
      productVariantId !== '' && locationId !== '' && quantity !== '' && reason.trim() !== '' && occurredAt !== '',
    [productVariantId, locationId, quantity, reason, occurredAt],
  );

  async function onProductChange(nextProductId: string): Promise<void> {
    setProductId(nextProductId);
    setProductVariantId('');
    setVariants([]);
    setResult(null);
    if (!nextProductId) {
      return;
    }
    setVariantsLoading(true);
    try {
      const rows = await apiFetch<{ id: string; sku: string }[]>(
        `/api/v1/products/${nextProductId}/variants`,
      );
      setVariants(rows.map((r) => ({ id: r.id, sku: r.sku })));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(false);
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!warehouseId) next['warehouseId'] = 'Elige una sucursal.';
    if (!productVariantId) next['productVariantId'] = 'Elige una variante.';
    if (warehouseId && !locationId) next['locationId'] = 'Elige un almacén.';
    const q = Number(quantity);
    if (quantity === '' || Number.isNaN(q) || q <= 0) {
      next['quantity'] = 'Ingresa una cantidad mayor que cero.';
    }
    if (reason.trim().length < 1 || reason.trim().length > 500) {
      next['reason'] = 'Se requiere un motivo de 1–500 caracteres.';
    }
    if (!occurredAt) next['occurredAt'] = 'Indica la fecha del movimiento.';
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !canSubmit) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        productVariantId,
        locationId,
        movementType,
        quantity: Number(quantity),
        reason: reason.trim(),
        occurredAt: new Date(occurredAt).toISOString(),
      };
      const movement = await apiFetch<InventoryMovement>(ADJUSTMENTS_PATH, { method: 'POST', body });
      setResult(movement);
      setQuantity('');
      setReason('');
      setOccurredAt(nowForDatetimeLocalInput());
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para ajustar existencias en este almacén.');
      } else if (isApiError(err) && (err.status === 404 || err.status === 409 || err.status === 400 || err.status === 422)) {
        setError(httpErrorMessage(err));
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      {variantFixed ? (
        <Field label="Variante" hint="Fija para este ajuste.">
          <Input readOnly value={fixedVariantLabel ?? productVariantId} />
        </Field>
      ) : (
        <>
          <Field label="Producto" required>
            <Select value={productId} onChange={(e) => void onProductChange(e.target.value)}>
              <option value="">Elegir un producto…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Variante"
            required
            {...(fieldError['productVariantId'] ? { error: fieldError['productVariantId'] } : {})}
            {...(variantsLoading ? { hint: 'Cargando variantes…' } : {})}
          >
            <Select
              value={productVariantId}
              disabled={!productId || variantsLoading}
              onChange={(e) => {
                setProductVariantId(e.target.value);
                setResult(null);
              }}
            >
              <option value="">{productId ? 'Elegir una variante…' : 'Elige primero un producto'}</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.sku}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <Field label="Sucursal" required {...(fieldError['warehouseId'] ? { error: fieldError['warehouseId'] } : {})}>
        <Select value={warehouseId} onChange={(e) => onWarehouseChange(e.target.value)}>
          <option value="">Elegir una sucursal…</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Almacén" required {...(fieldError['locationId'] ? { error: fieldError['locationId'] } : {})}>
        <Select
          value={locationId}
          disabled={!warehouseId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setResult(null);
          }}
        >
          <option value="">{warehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
          {locationsInWarehouse.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Tipo" required hint="Dirección del cambio.">
        <Select value={movementType} onChange={(e) => setMovementType(e.target.value as AdjustmentMovementType)}>
          {ADJUSTMENT_MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Cantidad"
        required
        hint="Un monto positivo — la dirección viene del tipo."
        {...(fieldError['quantity'] ? { error: fieldError['quantity'] } : {})}
      >
        <Input
          type="number"
          min={0}
          step="any"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setResult(null);
          }}
        />
      </Field>

      <Field
        label="Motivo"
        required
        hint="Por qué cambia el stock (p. ej. corrección de conteo físico)."
        {...(fieldError['reason'] ? { error: fieldError['reason'] } : {})}
      >
        <Textarea
          maxLength={500}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setResult(null);
          }}
        />
      </Field>

      <Field
        label="Fecha del movimiento"
        required
        hint="Por defecto, ahora — cámbiala para una corrección retroactiva."
        {...(fieldError['occurredAt'] ? { error: fieldError['occurredAt'] } : {})}
      >
        <Input
          type="datetime-local"
          value={occurredAt}
          onChange={(e) => {
            setOccurredAt(e.target.value);
            setResult(null);
          }}
        />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}
      {result && (
        <Alert tone="success">
          Ajuste registrado. Saldo físico después: <span className="font-medium">{result.balanceAfter}</span>.{' '}
          <Link href={`/inventory?productVariantId=${result.productVariantId}`} className="underline underline-offset-2">
            Ver existencias
          </Link>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit} className="w-fit">
          Registrar ajuste
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push('/inventory')}>
          Volver a inventario
        </Button>
      </div>
    </form>
  );
}
