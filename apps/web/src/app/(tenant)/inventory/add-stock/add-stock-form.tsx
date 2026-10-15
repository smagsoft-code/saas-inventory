'use client';

import Link from 'next/link';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { InventoryMovement } from '../../../../lib/types/inventory';
import { Alert } from '../../../../components/ui/alert';
import { Button, ButtonLink } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';
import { ProductSearchSelect } from '../../../../components/product-search-select';

const ADJUSTMENTS_PATH = '/api/v1/inventory/adjustments';

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

/**
 * "Agregar stock" (OUI-011) — ingreso de nuevas unidades, nunca una corrección. Body enviado es
 * exactamente `CreateAdjustmentDto` con `movementType` fijo en `'RECEIPT'` — el usuario nunca ve ni
 * elige un tipo de movimiento (a diferencia de `AdjustmentForm`, que sí lo expone porque cubre
 * tanto recepciones como correcciones). Sucursal → Almacén es un filtro puramente client-side sobre
 * dos listas acotadas ya traídas por el server component — sin round-trip adicional al elegir
 * sucursal, igual que cualquier otro selector en cascada de esta app.
 */
export function AddStockForm({
  fixedProductVariantId,
  fixedVariantLabel,
  warehouses,
  locations,
}: {
  fixedProductVariantId?: string;
  /** Etiqueta humana (SKU) para la variante fija, cuando el caller ya la conoce — solo display. */
  fixedVariantLabel?: string;
  warehouses: WarehouseOption[];
  locations: LocationOption[];
}): React.JSX.Element {
  // The product picked in the search bar (id + name); the variant is then chosen among its own.
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; name: string } | null>(null);
  const productId = selectedProduct?.id ?? '';
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState(fixedProductVariantId ?? '');

  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');

  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');

  const [step, setStep] = useState<'form' | 'review'>('form');
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [result, setResult] = useState<InventoryMovement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const variantFixed = Boolean(fixedProductVariantId);
  const locationsInWarehouse = useMemo(
    () => locations.filter((l) => l.warehouseId === warehouseId),
    [locations, warehouseId],
  );
  const selectedVariant = variants.find((v) => v.id === productVariantId);
  const selectedWarehouse = warehouses.find((w) => w.id === warehouseId);
  const selectedLocation = locations.find((l) => l.id === locationId);

  async function onProductChange(next: { id: string; name: string } | null): Promise<void> {
    setSelectedProduct(next);
    setProductVariantId('');
    setVariants([]);
    if (!next) {
      return;
    }
    const nextProductId = next.id;
    setVariantsLoading(true);
    try {
      const rows = await apiFetch<{ id: string; sku: string }[]>(`/api/v1/products/${nextProductId}/variants`);
      setVariants(rows.map((r) => ({ id: r.id, sku: r.sku })));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(false);
    }
  }

  function onWarehouseChange(nextWarehouseId: string): void {
    setWarehouseId(nextWarehouseId);
    setLocationId('');
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!productVariantId) next['productVariantId'] = 'Elige una variante.';
    if (!warehouseId) next['warehouseId'] = 'Elige una sucursal.';
    if (warehouseId && !locationId) next['locationId'] = 'Elige un almacén.';
    const q = Number(quantity);
    if (quantity === '' || Number.isNaN(q) || q <= 0) {
      next['quantity'] = 'Ingresa una cantidad mayor que cero.';
    }
    const cost = Number(unitCost);
    if (unitCost === '' || Number.isNaN(cost) || cost < 0) {
      next['unitCost'] = 'Ingresa el costo unitario (0 o mayor).';
    }
    if (reason.trim().length < 1 || reason.trim().length > 500) {
      next['reason'] = 'Se requiere un motivo de 1–500 caracteres.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  function onReview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setError(null);
    if (!validate()) {
      return;
    }
    setStep('review');
  }

  async function onConfirm(): Promise<void> {
    if (submitting) {
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const movement = await apiFetch<InventoryMovement>(ADJUSTMENTS_PATH, {
        method: 'POST',
        body: {
          productVariantId,
          locationId,
          movementType: 'RECEIPT',
          quantity: Number(quantity),
          unitCost: Number(unitCost),
          reason: reason.trim(),
        },
      });
      setResult(movement);
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('No tienes autorización para agregar stock en este almacén.');
      } else {
        setError(httpErrorMessage(err));
      }
      setStep('form');
    } finally {
      setSubmitting(false);
    }
  }

  function startAnother(): void {
    setResult(null);
    setError(null);
    setStep('form');
    if (!variantFixed) {
      setSelectedProduct(null);
      setVariants([]);
      setProductVariantId('');
    }
    setWarehouseId('');
    setLocationId('');
    setQuantity('');
    setUnitCost('');
    setReason('');
  }

  if (result) {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <Alert tone="success">
          Ingreso registrado. Nueva cantidad física en este almacén: <strong>{result.balanceAfter}</strong>.
        </Alert>
        <div className="flex gap-2">
          <Button type="button" onClick={startAnother} className="w-fit">
            Registrar otro ingreso
          </Button>
          <Link href="/inventory" className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline">
            Ir a inventario
          </Link>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    return (
      <div className="flex max-w-md flex-col gap-4">
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Revisar ingreso de stock</h3>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Producto</dt>
            <dd className="text-slate-900">{selectedProduct?.name ?? '—'}</dd>
            <dt className="text-slate-500">Variante (Código)</dt>
            <dd className="text-slate-900">{fixedVariantLabel ?? selectedVariant?.sku ?? '—'}</dd>
            <dt className="text-slate-500">Sucursal</dt>
            <dd className="text-slate-900">{selectedWarehouse?.name ?? '—'}</dd>
            <dt className="text-slate-500">Almacén</dt>
            <dd className="text-slate-900">{selectedLocation?.name ?? '—'}</dd>
            <dt className="text-slate-500">Cantidad a ingresar</dt>
            <dd className="text-slate-900">+{quantity}</dd>
            <dt className="text-slate-500">Costo unitario</dt>
            <dd className="text-slate-900">{unitCost}</dd>
            <dt className="text-slate-500">Motivo</dt>
            <dd className="text-slate-900">{reason}</dd>
          </dl>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        <div className="flex gap-2">
          <Button type="button" loading={submitting} onClick={() => void onConfirm()} className="w-fit">
            Confirmar ingreso
          </Button>
          <Button type="button" variant="ghost" disabled={submitting} onClick={() => setStep('form')} className="w-fit">
            Volver a editar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onReview} noValidate className="flex max-w-md flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      {variantFixed ? (
        <Field label="Variante" hint="Fija para este ingreso.">
          <Input readOnly value={fixedVariantLabel ?? productVariantId} />
        </Field>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-slate-700">Producto</span>
            <ProductSearchSelect
              selected={selectedProduct ? { id: selectedProduct.id, label: selectedProduct.name } : null}
              onSelect={(product) => void onProductChange({ id: product.id, name: product.name })}
              onClear={() => void onProductChange(null)}
            />
          </div>
          <Field
            label="Variante"
            required
            {...(fieldError['productVariantId'] ? { error: fieldError['productVariantId'] } : {})}
            {...(variantsLoading ? { hint: 'Cargando variantes…' } : {})}
          >
            <Select
              value={productVariantId}
              disabled={!productId || variantsLoading}
              onChange={(event) => setProductVariantId(event.target.value)}
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
        <Select value={warehouseId} onChange={(event) => onWarehouseChange(event.target.value)}>
          <option value="">Elegir una sucursal…</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Almacén"
        required
        {...(fieldError['locationId'] ? { error: fieldError['locationId'] } : {})}
      >
        <Select value={locationId} disabled={!warehouseId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">{warehouseId ? 'Elegir un almacén…' : 'Elige primero una sucursal'}</option>
          {locationsInWarehouse.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Cantidad a ingresar" required {...(fieldError['quantity'] ? { error: fieldError['quantity'] } : {})}>
        <Input type="number" min={0} step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
      </Field>

      <Field
        label="Costo unitario"
        required
        hint="Costo por unidad del stock que estás ingresando — no es el precio de venta."
        {...(fieldError['unitCost'] ? { error: fieldError['unitCost'] } : {})}
      >
        <Input type="number" min={0} step="0.01" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} />
      </Field>

      <Field
        label="Motivo del ingreso"
        required
        hint="Ej: producción propia, compra directa a proveedor, devolución de consignación."
        {...(fieldError['reason'] ? { error: fieldError['reason'] } : {})}
      >
        <Textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" className="w-fit">
          Revisar ingreso
        </Button>
        <ButtonLink href="/inventory" variant="ghost" className="w-fit">
          Cancelar
        </ButtonLink>
      </div>
    </form>
  );
}
