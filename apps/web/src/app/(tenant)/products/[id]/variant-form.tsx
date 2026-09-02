'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import {
  pruneAttributeValues,
  validateAttributeValues,
  type AttributeField,
} from '../../../../lib/catalog/product-attributes';
import type { AttributeOption } from '../../../../lib/types/catalog';
import { VARIANT_STATUSES, VARIANT_STATUS_LABELS, pricesAreOrdered, type Variant, type VariantStatus } from '../../../../lib/types/products';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Field } from '../../../../components/ui/field';
import { Input, Select } from '../../../../components/ui/input';
import { AttributeFields } from '../attribute-fields';

/**
 * Create / edit one variant. `POST /products/:id/variants` (`VariantFieldsDto`) or
 * `PATCH /products/:id/variants/:variantId` (`UpdateVariantDto`). On edit, `sku`, `isSerialized`
 * and `isLotTracked` are **not** in the DTO — shown read-only. Prices must satisfy
 * `min ≤ base ≤ max` (same rule the DB CHECK enforces). Variant-scope attributes are governed by
 * the product's category (ADR-0026).
 */
export function VariantForm({
  mode,
  productId,
  variant,
  variantFields,
  optionsByDefinitionId,
  canViewFloor,
  canViewCost,
}: {
  mode: 'create' | 'edit';
  productId: string;
  variant?: Variant;
  variantFields: AttributeField[];
  optionsByDefinitionId: Record<string, AttributeOption[]>;
  canViewFloor: boolean;
  canViewCost: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const base = `/api/v1/products/${productId}/variants`;

  const [sku, setSku] = useState(variant?.sku ?? '');
  const [barcode, setBarcode] = useState(variant?.barcode ?? '');
  const [unit, setUnit] = useState(variant?.unit ?? 'unit');
  const [maxPrice, setMaxPrice] = useState(variant ? String(variant.maxPrice) : '');
  const [basePrice, setBasePrice] = useState(variant ? String(variant.basePrice) : '');
  const [minPrice, setMinPrice] = useState(
    variant && typeof variant.minPrice === 'number' ? String(variant.minPrice) : '',
  );
  const [cost, setCost] = useState(variant && typeof variant.cost === 'number' ? String(variant.cost) : '');
  const [isSerialized, setIsSerialized] = useState(variant?.isSerialized ?? false);
  const [isLotTracked, setIsLotTracked] = useState(variant?.isLotTracked ?? false);
  const [status, setStatus] = useState<VariantStatus>((variant?.status as VariantStatus) ?? 'active');
  const [attributes, setAttributes] = useState<Record<string, unknown>>(
    variant?.attributes ? { ...variant.attributes } : {},
  );

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [attrError, setAttrError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const originalAttributes = useMemo(() => JSON.stringify(variant?.attributes ?? {}), [variant]);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return sku.trim().length > 0;
    }
    return (
      barcode !== (variant?.barcode ?? '') ||
      unit !== (variant?.unit ?? '') ||
      maxPrice !== String(variant?.maxPrice ?? '') ||
      basePrice !== String(variant?.basePrice ?? '') ||
      minPrice !== (typeof variant?.minPrice === 'number' ? String(variant.minPrice) : '') ||
      cost !== (typeof variant?.cost === 'number' ? String(variant.cost) : '') ||
      status !== variant?.status ||
      JSON.stringify(attributes) !== originalAttributes
    );
  }, [mode, sku, barcode, unit, maxPrice, basePrice, minPrice, cost, status, attributes, variant, originalAttributes]);

  function setAttr(code: string, value: unknown): void {
    setAttributes((cur) => {
      const next = { ...cur };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setSuccess(false);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (mode === 'create' && (sku.trim().length < 1 || sku.trim().length > 80)) {
      next['sku'] = 'SKU must be 1–80 characters.';
    }

    const priceInputs: [string, string][] = [
      ['maxPrice', maxPrice],
      ['basePrice', basePrice],
      ['minPrice', minPrice],
    ];
    for (const [key, raw] of priceInputs) {
      const requiredOnCreate = mode === 'create';
      if (raw === '') {
        if (requiredOnCreate) next[key] = 'Enter a price of 0 or more.';
        continue;
      }
      if (Number.isNaN(Number(raw)) || Number(raw) < 0) {
        next[key] = 'Enter a price of 0 or more.';
      }
    }
    if (cost !== '' && (Number.isNaN(Number(cost)) || Number(cost) < 0)) {
      next['cost'] = 'Enter a cost of 0 or more.';
    }

    // Only cross-check ordering when we actually know all three numbers.
    const haveAll = maxPrice !== '' && basePrice !== '' && minPrice !== '';
    if (haveAll && !next['maxPrice'] && !next['basePrice'] && !next['minPrice']) {
      if (!pricesAreOrdered(Number(minPrice), Number(basePrice), Number(maxPrice))) {
        next['minPrice'] = 'Prices must satisfy min ≤ base ≤ max.';
      }
    }

    const attrErrors = validateAttributeValues(attributes, variantFields);
    setFieldError(next);
    setAttrError(attrErrors);
    return Object.keys(next).length === 0 && Object.keys(attrErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          sku: sku.trim(),
          maxPrice: Number(maxPrice),
          basePrice: Number(basePrice),
          minPrice: Number(minPrice),
          attributes: pruneAttributeValues(attributes, variantFields),
        };
        if (barcode.trim()) body['barcode'] = barcode.trim();
        if (unit.trim()) body['unit'] = unit.trim();
        if (cost !== '') body['cost'] = Number(cost);
        if (isSerialized) body['isSerialized'] = true;
        if (isLotTracked) body['isLotTracked'] = true;

        const created = await apiFetch<Variant>(base, { method: 'POST', body });
        router.replace(`/products/${productId}/variants/${created.id}`);
        router.refresh();
        return;
      }

      const body: Record<string, unknown> = {};
      if (barcode !== (variant?.barcode ?? '')) body['barcode'] = barcode.trim();
      if (unit !== (variant?.unit ?? '')) body['unit'] = unit.trim();
      if (maxPrice !== String(variant?.maxPrice ?? '')) body['maxPrice'] = Number(maxPrice);
      if (basePrice !== String(variant?.basePrice ?? '')) body['basePrice'] = Number(basePrice);
      if (minPrice !== (typeof variant?.minPrice === 'number' ? String(variant.minPrice) : '') && minPrice !== '') {
        body['minPrice'] = Number(minPrice);
      }
      if (cost !== (typeof variant?.cost === 'number' ? String(variant.cost) : '') && cost !== '') {
        body['cost'] = Number(cost);
      }
      if (status !== variant?.status) body['status'] = status;
      const prunedAttrs = pruneAttributeValues(attributes, variantFields);
      if (JSON.stringify(prunedAttrs) !== originalAttributes) body['attributes'] = prunedAttrs;

      await apiFetch<Variant>(`${base}/${variant!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      setError(
        isApiError(err) && err.status === 403
          ? 'You no longer have permission to make this change.'
          : httpErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <Field label="SKU" required={mode === 'create'} {...(mode === 'edit' ? { hint: 'Cannot be changed.' } : {})} {...(fieldError['sku'] ? { error: fieldError['sku'] } : {})}>
        <Input
          required={mode === 'create'}
          readOnly={mode === 'edit'}
          maxLength={80}
          value={sku}
          onChange={(e) => {
            setSku(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Barcode">
          <Input maxLength={80} value={barcode} onChange={(e) => { setBarcode(e.target.value); setSuccess(false); }} />
        </Field>
        <Field label="Unit">
          <Input maxLength={20} value={unit} onChange={(e) => { setUnit(e.target.value); setSuccess(false); }} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Max price" required={mode === 'create'} {...(fieldError['maxPrice'] ? { error: fieldError['maxPrice'] } : {})}>
          <Input type="number" min={0} step="any" value={maxPrice} onChange={(e) => { setMaxPrice(e.target.value); setSuccess(false); }} />
        </Field>
        <Field label="Base price" required={mode === 'create'} {...(fieldError['basePrice'] ? { error: fieldError['basePrice'] } : {})}>
          <Input type="number" min={0} step="any" value={basePrice} onChange={(e) => { setBasePrice(e.target.value); setSuccess(false); }} />
        </Field>
        <Field
          label="Min price"
          required={mode === 'create'}
          hint={mode === 'edit' && !canViewFloor ? 'Hidden — leave blank to keep unchanged.' : 'Floor before an approval is needed.'}
          {...(fieldError['minPrice'] ? { error: fieldError['minPrice'] } : {})}
        >
          <Input type="number" min={0} step="any" value={minPrice} onChange={(e) => { setMinPrice(e.target.value); setSuccess(false); }} />
        </Field>
      </div>

      <Field
        label="Cost"
        hint={mode === 'edit' && !canViewCost ? 'Hidden — leave blank to keep unchanged.' : 'Optional.'}
        {...(fieldError['cost'] ? { error: fieldError['cost'] } : {})}
      >
        <Input type="number" min={0} step="any" value={cost} onChange={(e) => { setCost(e.target.value); setSuccess(false); }} />
      </Field>

      {mode === 'create' ? (
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isSerialized} onChange={(e) => setIsSerialized(e.target.checked)} />
            Serialized (each unit has its own serial number)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={isLotTracked} onChange={(e) => setIsLotTracked(e.target.checked)} />
            Lot tracked
          </label>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Serialized: <span className="font-medium text-slate-700">{variant?.isSerialized ? 'yes' : 'no'}</span> · Lot tracked:{' '}
          <span className="font-medium text-slate-700">{variant?.isLotTracked ? 'yes' : 'no'}</span> (set at creation, cannot be changed)
        </p>
      )}

      {mode === 'edit' && (
        <Field label="Status">
          <Select value={status} onChange={(e) => { setStatus(e.target.value as VariantStatus); setSuccess(false); }}>
            {VARIANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {VARIANT_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <AttributeFields
        legend="Variant attributes"
        fields={variantFields}
        optionsByDefinitionId={optionsByDefinitionId}
        values={attributes}
        errors={attrError}
        onChange={setAttr}
      />

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Variant saved.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Create variant' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push(`/products/${productId}`)}>
          Back to product
        </Button>
      </div>
    </form>
  );
}
