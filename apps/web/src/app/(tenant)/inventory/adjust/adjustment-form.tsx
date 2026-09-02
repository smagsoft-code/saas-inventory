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
export interface LocationOption {
  id: string;
  name: string;
}
interface VariantOption {
  id: string;
  sku: string;
}

/**
 * Records a manual stock adjustment — `POST /api/v1/inventory/adjustments` (`inventory.adjust` +
 * location authorization, ADR-0024). Body is exactly `CreateAdjustmentDto`; never `tenantId`.
 * When a `productVariantId` is passed in (drill-in from a variant/balance), the variant is fixed;
 * otherwise the user picks a product then one of its variants (`GET /products/:id/variants`).
 */
export function AdjustmentForm({
  fixedProductVariantId,
  fixedLocationId,
  products,
  locations,
}: {
  fixedProductVariantId?: string;
  fixedLocationId?: string;
  products: ProductOption[];
  locations: LocationOption[];
}): React.JSX.Element {
  const router = useRouter();

  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState(fixedProductVariantId ?? '');
  const [locationId, setLocationId] = useState(fixedLocationId ?? '');
  const [movementType, setMovementType] = useState<AdjustmentMovementType>('ADJUSTMENT_IN');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [occurredAt, setOccurredAt] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [result, setResult] = useState<InventoryMovement | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const variantFixed = Boolean(fixedProductVariantId);

  const canSubmit = useMemo(
    () => productVariantId !== '' && locationId !== '' && quantity !== '' && reason.trim() !== '',
    [productVariantId, locationId, quantity, reason],
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
    if (!productVariantId) next['productVariantId'] = 'Choose a variant.';
    if (!locationId) next['locationId'] = 'Choose a location.';
    const q = Number(quantity);
    if (quantity === '' || Number.isNaN(q) || q <= 0) {
      next['quantity'] = 'Enter a quantity greater than zero.';
    }
    if (reason.trim().length < 1 || reason.trim().length > 500) {
      next['reason'] = 'A reason of 1–500 characters is required.';
    }
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
      };
      if (occurredAt) {
        body['occurredAt'] = new Date(occurredAt).toISOString();
      }
      const movement = await apiFetch<InventoryMovement>(ADJUSTMENTS_PATH, { method: 'POST', body });
      setResult(movement);
      setQuantity('');
      setReason('');
      setOccurredAt('');
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to adjust stock at this location.');
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
        <Field label="Variant" hint="Fixed for this adjustment.">
          <Input readOnly value={productVariantId} />
        </Field>
      ) : (
        <>
          <Field label="Product" required>
            <Select value={productId} onChange={(e) => void onProductChange(e.target.value)}>
              <option value="">Choose a product…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Variant"
            required
            {...(fieldError['productVariantId'] ? { error: fieldError['productVariantId'] } : {})}
            {...(variantsLoading ? { hint: 'Loading variants…' } : {})}
          >
            <Select
              value={productVariantId}
              disabled={!productId || variantsLoading}
              onChange={(e) => {
                setProductVariantId(e.target.value);
                setResult(null);
              }}
            >
              <option value="">{productId ? 'Choose a variant…' : 'Pick a product first'}</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.sku}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}

      <Field label="Location" required {...(fieldError['locationId'] ? { error: fieldError['locationId'] } : {})}>
        <Select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setResult(null);
          }}
        >
          <option value="">Choose a location…</option>
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Type" required hint="Direction of the change.">
        <Select value={movementType} onChange={(e) => setMovementType(e.target.value as AdjustmentMovementType)}>
          {ADJUSTMENT_MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Quantity"
        required
        hint="A positive amount — the direction comes from the type."
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
        label="Reason"
        required
        hint="Why the stock is changing (e.g. physical count correction)."
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

      <Field label="Occurred at" hint="Optional. Leave blank for now; set it for a backdated correction.">
        <Input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} />
      </Field>

      {error && <Alert tone="error">{error}</Alert>}
      {result && (
        <Alert tone="success">
          Adjustment recorded. Physical balance after: <span className="font-medium">{result.balanceAfter}</span>.{' '}
          <Link href={`/inventory?productVariantId=${result.productVariantId}`} className="underline underline-offset-2">
            View stock
          </Link>
        </Alert>
      )}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit} className="w-fit">
          Record adjustment
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push('/inventory')}>
          Back to stock
        </Button>
      </div>
    </form>
  );
}
