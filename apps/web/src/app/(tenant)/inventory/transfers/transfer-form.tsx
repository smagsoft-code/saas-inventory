'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { Transfer } from '../../../../lib/types/inventory';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';

const TRANSFERS_PATH = '/api/v1/inventory/transfers';

interface ProductOption {
  id: string;
  name: string;
}
interface LocationOption {
  id: string;
  name: string;
}
interface VariantOption {
  id: string;
  sku: string;
}
interface Line {
  key: number;
  productId: string;
  variants: VariantOption[];
  variantsLoading: boolean;
  productVariantId: string;
  quantity: string;
}

function emptyLine(key: number): Line {
  return { key, productId: '', variants: [], variantsLoading: false, productVariantId: '', quantity: '' };
}

/**
 * Creates a transfer — `POST /api/v1/inventory/transfers` (`inventory.transfers.request`). Body is
 * exactly `CreateTransferDto` (`sourceLocationId`, `destinationLocationId`, `items[]`, `notes?`);
 * never `tenantId`/`requestedBy`/`status`. Each line is Product → Variant → quantity, reusing
 * `GET /products/:id/variants` (no tenant-wide variant list — `GAP-VARIANT-LIST`). Client
 * validation is a UX mirror only; the backend re-validates and authorizes.
 */
export function TransferForm({
  products,
  locations,
}: {
  products: ProductOption[];
  locations: LocationOption[];
}): React.JSX.Element {
  const router = useRouter();

  const [sourceLocationId, setSourceLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(0)]);
  const [nextKey, setNextKey] = useState(1);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const sameLocation = sourceLocationId !== '' && sourceLocationId === destinationLocationId;

  const canSubmit = useMemo(
    () =>
      sourceLocationId !== '' &&
      destinationLocationId !== '' &&
      !sameLocation &&
      lines.length > 0 &&
      lines.every((line) => line.productVariantId !== '' && Number(line.quantity) > 0),
    [sourceLocationId, destinationLocationId, sameLocation, lines],
  );

  function updateLine(key: number, patch: Partial<Line>): void {
    setLines((cur) => cur.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine(): void {
    setLines((cur) => [...cur, emptyLine(nextKey)]);
    setNextKey((k) => k + 1);
  }

  function removeLine(key: number): void {
    setLines((cur) => (cur.length > 1 ? cur.filter((line) => line.key !== key) : cur));
  }

  async function onProductChange(key: number, productId: string): Promise<void> {
    updateLine(key, { productId, productVariantId: '', variants: [], variantsLoading: Boolean(productId) });
    if (!productId) {
      return;
    }
    try {
      const rows = await apiFetch<{ id: string; sku: string }[]>(`/api/v1/products/${productId}/variants`);
      updateLine(key, { variants: rows.map((r) => ({ id: r.id, sku: r.sku })), variantsLoading: false });
    } catch (err) {
      updateLine(key, { variantsLoading: false });
      setError(httpErrorMessage(err));
    }
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!sourceLocationId) next['sourceLocationId'] = 'Choose a source location.';
    if (!destinationLocationId) next['destinationLocationId'] = 'Choose a destination location.';
    if (sameLocation) next['destinationLocationId'] = 'Source and destination must be different.';

    const seen = new Set<string>();
    lines.forEach((line, i) => {
      if (!line.productVariantId) {
        next[`line-${i}-variant`] = 'Choose a variant.';
      } else if (seen.has(line.productVariantId)) {
        next[`line-${i}-variant`] = 'This variant is already on another line.';
      } else {
        seen.add(line.productVariantId);
      }
      const q = Number(line.quantity);
      if (line.quantity === '' || Number.isNaN(q) || q <= 0) {
        next[`line-${i}-quantity`] = 'Enter a quantity greater than zero.';
      }
    });

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
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        sourceLocationId,
        destinationLocationId,
        items: lines.map((line) => ({
          productVariantId: line.productVariantId,
          quantityRequested: Number(line.quantity),
        })),
      };
      if (notes.trim()) {
        body['notes'] = notes.trim();
      }
      const created = await apiFetch<Transfer>(TRANSFERS_PATH, { method: 'POST', body });
      router.push(`/inventory/transfers/${created.id}`);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to create a transfer for these locations.');
      } else {
        setError(httpErrorMessage(err));
      }
      setSubmitting(false);
    }
  }

  const productsDisabled = products.length === 0;

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-2xl flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="From location"
          required
          {...(fieldError['sourceLocationId'] ? { error: fieldError['sourceLocationId'] } : {})}
        >
          <Select value={sourceLocationId} onChange={(e) => setSourceLocationId(e.target.value)}>
            <option value="">Choose a location…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="To location"
          required
          {...(fieldError['destinationLocationId'] ? { error: fieldError['destinationLocationId'] } : {})}
        >
          <Select value={destinationLocationId} onChange={(e) => setDestinationLocationId(e.target.value)}>
            <option value="">Choose a location…</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-4 rounded-lg border border-slate-200 p-4">
        <legend className="px-1 text-sm font-medium text-slate-700">Lines</legend>
        {lines.map((line, i) => (
          <div key={line.key} className="flex flex-col gap-3 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Product" required>
                <Select
                  value={line.productId}
                  disabled={productsDisabled}
                  onChange={(e) => void onProductChange(line.key, e.target.value)}
                >
                  <option value="">{productsDisabled ? 'No products available' : 'Choose a product…'}</option>
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
                {...(fieldError[`line-${i}-variant`] ? { error: fieldError[`line-${i}-variant`] } : {})}
                {...(line.variantsLoading ? { hint: 'Loading variants…' } : {})}
              >
                <Select
                  value={line.productVariantId}
                  disabled={!line.productId || line.variantsLoading}
                  onChange={(e) => updateLine(line.key, { productVariantId: e.target.value })}
                >
                  <option value="">{line.productId ? 'Choose a variant…' : 'Pick a product first'}</option>
                  {line.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.sku}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Quantity"
                required
                {...(fieldError[`line-${i}-quantity`] ? { error: fieldError[`line-${i}-quantity`] } : {})}
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={line.quantity}
                  onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                />
              </Field>
            </div>
            {lines.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => removeLine(line.key)}
              >
                Remove line
              </Button>
            )}
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" className="w-fit" onClick={addLine} disabled={productsDisabled}>
          Add line
        </Button>
      </fieldset>

      <Field label="Notes" hint="Optional — visible on the transfer.">
        <Textarea maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {sameLocation && <Alert tone="warning">Source and destination must be different.</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!canSubmit} className="w-fit">
          Create transfer
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push('/inventory/transfers')}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
