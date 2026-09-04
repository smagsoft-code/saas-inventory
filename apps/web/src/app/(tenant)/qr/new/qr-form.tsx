'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
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
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';

interface Option {
  id: string;
  name: string;
}

const QR_PATH = '/api/v1/qr-codes';

/**
 * Creates a QR code — `POST /api/v1/qr-codes` (`catalog.qr.manage`). Body is exactly
 * `CreateQrCodeDto` (`targetType`, `targetId`, `expiresAt?`) — never `tenantId`/`code`/`status`.
 * The target is picked as Product → Variant (`GET /products/:id/variants`) or Location. Client
 * validation is a UX mirror; the backend re-validates the target against the caller's tenant and
 * re-authorizes.
 */
export function QrForm({
  products,
  locations,
}: {
  products: Option[];
  locations: Option[];
}): React.JSX.Element {
  const router = useRouter();

  const [targetType, setTargetType] = useState<QrTargetType>('product_variant');
  const [productId, setProductId] = useState('');
  const [variants, setVariants] = useState<{ id: string; sku: string }[]>([]);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [productVariantId, setProductVariantId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');

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
      const rows = await apiFetch<{ id: string; sku: string }[]>(`/api/v1/products/${nextId}/variants`);
      setVariants(rows.map((r) => ({ id: r.id, sku: r.sku })));
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setVariantsLoading(false);
    }
  }

  function onTargetTypeChange(next: QrTargetType): void {
    setTargetType(next);
    setError(null);
    setFieldError({});
    setProductId('');
    setVariants([]);
    setProductVariantId('');
    setLocationId('');
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (targetType === 'product_variant' && !productVariantId) {
      next['targetId'] = 'Choose a product and a variant.';
    }
    if (targetType === 'location' && !locationId) {
      next['targetId'] = 'Choose a location.';
    }
    if (expiresAt !== '' && Number.isNaN(new Date(expiresAt).getTime())) {
      next['expiresAt'] = 'Enter a valid date.';
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
      const created = await apiFetch<QrCode>(QR_PATH, { method: 'POST', body });
      router.push(`/qr?targetType=${created.targetType}`);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to generate a QR code for this target.');
      } else {
        setError(httpErrorMessage(err));
      }
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Field label="Target type">
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
          <Field label="Product">
            <Select value={productId} onChange={(event) => void onProductChange(event.target.value)}>
              <option value="">Select a product…</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Variant"
            {...(fieldError['targetId'] ? { error: fieldError['targetId'] } : {})}
            {...(variantsLoading ? { hint: 'Loading variants…' } : {})}
          >
            <Select
              value={productVariantId}
              onChange={(event) => setProductVariantId(event.target.value)}
              disabled={!productId || variantsLoading}
            >
              <option value="">{productId ? 'Select a variant…' : 'Choose a product first'}</option>
              {variants.map((variant) => (
                <option key={variant.id} value={variant.id}>
                  {variant.sku}
                </option>
              ))}
            </Select>
          </Field>
        </>
      ) : (
        <Field label="Location" {...(fieldError['targetId'] ? { error: fieldError['targetId'] } : {})}>
          <Select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            <option value="">Select a location…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Expires on"
        hint="Optional. The code stops resolving at the end of this day (UTC)."
        {...(fieldError['expiresAt'] ? { error: fieldError['expiresAt'] } : {})}
      >
        <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
      </Field>

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit}>
          Generate
        </Button>
        <Button type="button" variant="ghost" disabled={submitting} onClick={() => router.push('/qr')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
