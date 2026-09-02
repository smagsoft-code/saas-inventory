'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  loadCategoryAttributeFieldSets,
  pruneAttributeValues,
  validateAttributeValues,
  type CategoryAttributeFieldSets,
} from '../../../lib/catalog/product-attributes';
import type { AttributeDefinition } from '../../../lib/types/catalog';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  pricesAreOrdered,
  type Product,
  type ProductStatus,
} from '../../../lib/types/products';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select, Textarea } from '../../../components/ui/input';
import { Spinner } from '../../../components/ui/spinner';
import { AttributeFields } from './attribute-fields';

const PRODUCTS_PATH = '/api/v1/products';
const EMPTY_SETS: CategoryAttributeFieldSets = { product: [], variant: [], options: {} };

export interface CategoryOption {
  id: string;
  name: string;
}

interface VariantDraft {
  sku: string;
  barcode: string;
  unit: string;
  maxPrice: string;
  basePrice: string;
  minPrice: string;
  cost: string;
  isSerialized: boolean;
  isLotTracked: boolean;
}

const EMPTY_VARIANT: VariantDraft = {
  sku: '',
  barcode: '',
  unit: 'unit',
  maxPrice: '',
  basePrice: '',
  minPrice: '',
  cost: '',
  isSerialized: false,
  isLotTracked: false,
};

/**
 * Create / edit a product. `POST /products` (create — requires the mandatory `defaultVariant`,
 * ADR-0017) or `PATCH /products/:id` (edit, changed fields only). Dynamic attributes are
 * category-driven (ADR-0026): the PRODUCT-scope group re-renders when the category changes, and a
 * category change sends the pruned `attributes` alongside `categoryId` so the backend re-validates
 * them together (§34). Variants other than the first are managed on the product detail page.
 */
export function ProductForm({
  mode,
  product,
  categories,
  definitions,
  initialFieldSets,
}: {
  mode: 'create' | 'edit';
  product?: Product;
  categories: CategoryOption[];
  definitions: AttributeDefinition[];
  initialFieldSets: CategoryAttributeFieldSets;
}): React.JSX.Element {
  const router = useRouter();

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(
    typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '',
  );
  const [status, setStatus] = useState<ProductStatus>((product?.status as ProductStatus) ?? 'draft');

  const [fieldSets, setFieldSets] = useState<CategoryAttributeFieldSets>(initialFieldSets);
  const [attrLoading, setAttrLoading] = useState(false);
  const [productAttributes, setProductAttributes] = useState<Record<string, unknown>>(
    product?.attributes ? { ...product.attributes } : {},
  );
  const [variantAttributes, setVariantAttributes] = useState<Record<string, unknown>>({});
  const [variant, setVariant] = useState<VariantDraft>(EMPTY_VARIANT);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [attrError, setAttrError] = useState<Record<string, string>>({});
  const [variantAttrError, setVariantAttrError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const originalCategoryId = product?.categoryId ?? '';
  const originalAttributes = useMemo(
    () => JSON.stringify(product?.attributes ?? {}),
    [product],
  );

  const onCategoryChange = useCallback(
    async (nextCategoryId: string) => {
      setCategoryId(nextCategoryId);
      setSuccess(false);
      if (!nextCategoryId) {
        setFieldSets(EMPTY_SETS);
        setProductAttributes((cur) => pruneAttributeValues(cur, []));
        setVariantAttributes((cur) => pruneAttributeValues(cur, []));
        return;
      }
      setAttrLoading(true);
      try {
        const next = await loadCategoryAttributeFieldSets(
          (path) => apiFetch(path),
          nextCategoryId,
          definitions,
        );
        setFieldSets(next);
        setProductAttributes((cur) => pruneAttributeValues(cur, next.product));
        setVariantAttributes((cur) => pruneAttributeValues(cur, next.variant));
      } catch (err) {
        setError(httpErrorMessage(err));
      } finally {
        setAttrLoading(false);
      }
    },
    [definitions],
  );

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0 || variant.sku.trim().length > 0;
    }
    return (
      name.trim() !== (product?.name ?? '') ||
      description !== (product?.description ?? '') ||
      categoryId !== originalCategoryId ||
      warrantyMonths !== (typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '') ||
      status !== product?.status ||
      JSON.stringify(productAttributes) !== originalAttributes
    );
  }, [mode, name, description, categoryId, warrantyMonths, status, productAttributes, variant.sku, product, originalCategoryId, originalAttributes]);

  function setProductAttr(code: string, value: unknown): void {
    setProductAttributes((cur) => {
      const next = { ...cur };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setSuccess(false);
  }
  function setVariantAttr(code: string, value: unknown): void {
    setVariantAttributes((cur) => {
      const next = { ...cur };
      if (value === undefined) delete next[code];
      else next[code] = value;
      return next;
    });
    setSuccess(false);
  }

  function validate(): boolean {
    const next: Record<string, string> = {};
    const trimmedName = name.trim();
    if (trimmedName.length < 2 || trimmedName.length > 200) {
      next['name'] = 'Name must be 2–200 characters.';
    }
    if (warrantyMonths !== '' && (!Number.isInteger(Number(warrantyMonths)) || Number(warrantyMonths) < 0)) {
      next['warrantyMonths'] = 'Warranty must be a whole number of months (0 or more).';
    }

    if (mode === 'create') {
      if (variant.sku.trim().length < 1 || variant.sku.trim().length > 80) {
        next['sku'] = 'SKU must be 1–80 characters.';
      }
      const max = Number(variant.maxPrice);
      const base = Number(variant.basePrice);
      const min = Number(variant.minPrice);
      for (const [key, raw] of [['maxPrice', variant.maxPrice], ['basePrice', variant.basePrice], ['minPrice', variant.minPrice]] as const) {
        if (raw === '' || Number.isNaN(Number(raw)) || Number(raw) < 0) {
          next[key] = 'Enter a price of 0 or more.';
        }
      }
      if (!next['maxPrice'] && !next['basePrice'] && !next['minPrice'] && !pricesAreOrdered(min, base, max)) {
        next['minPrice'] = 'Prices must satisfy min ≤ base ≤ max.';
      }
      if (variant.cost !== '' && (Number.isNaN(Number(variant.cost)) || Number(variant.cost) < 0)) {
        next['cost'] = 'Enter a cost of 0 or more.';
      }
    }

    const productAttrErrors = validateAttributeValues(productAttributes, fieldSets.product);
    const variantAttrErrors = mode === 'create' ? validateAttributeValues(variantAttributes, fieldSets.variant) : {};

    setFieldError(next);
    setAttrError(productAttrErrors);
    setVariantAttrError(variantAttrErrors);
    return (
      Object.keys(next).length === 0 &&
      Object.keys(productAttrErrors).length === 0 &&
      Object.keys(variantAttrErrors).length === 0
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty || attrLoading) {
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
          name: name.trim(),
          attributes: pruneAttributeValues(productAttributes, fieldSets.product),
          defaultVariant: {
            sku: variant.sku.trim(),
            ...(variant.barcode.trim() ? { barcode: variant.barcode.trim() } : {}),
            ...(variant.unit.trim() ? { unit: variant.unit.trim() } : {}),
            maxPrice: Number(variant.maxPrice),
            basePrice: Number(variant.basePrice),
            minPrice: Number(variant.minPrice),
            ...(variant.cost !== '' ? { cost: Number(variant.cost) } : {}),
            ...(variant.isSerialized ? { isSerialized: true } : {}),
            ...(variant.isLotTracked ? { isLotTracked: true } : {}),
            attributes: pruneAttributeValues(variantAttributes, fieldSets.variant),
          },
        };
        if (description.trim()) body['description'] = description.trim();
        if (categoryId) body['categoryId'] = categoryId;
        if (warrantyMonths !== '') body['warrantyMonths'] = Number(warrantyMonths);

        const created = await apiFetch<Product>(PRODUCTS_PATH, { method: 'POST', body });
        router.replace(`/products/${created.id}`);
        router.refresh();
        return;
      }

      const body: Record<string, unknown> = {};
      if (name.trim() !== (product?.name ?? '')) body['name'] = name.trim();
      if (description !== (product?.description ?? '')) body['description'] = description.trim();
      if (status !== product?.status) body['status'] = status;
      if (warrantyMonths !== (typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '')) {
        body['warrantyMonths'] = warrantyMonths === '' ? 0 : Number(warrantyMonths);
      }
      const categoryChanged = categoryId !== originalCategoryId;
      if (categoryChanged) {
        body['categoryId'] = categoryId || undefined;
      }
      const prunedAttrs = pruneAttributeValues(productAttributes, fieldSets.product);
      if (categoryChanged || JSON.stringify(prunedAttrs) !== originalAttributes) {
        body['attributes'] = prunedAttrs;
      }

      await apiFetch<Product>(`${PRODUCTS_PATH}/${product!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You no longer have permission to make this change.');
      } else if (isApiError(err) && (err.status === 400 || err.status === 422)) {
        setError(httpErrorMessage(err));
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-xl flex-col gap-5">
      <div className="flex flex-col gap-4">
        <Field label="Name" required {...(fieldError['name'] ? { error: fieldError['name'] } : {})}>
          <Input
            required
            minLength={2}
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>

        <Field label="Category" hint="Determines the dynamic attributes below.">
          <Select value={categoryId} onChange={(e) => void onCategoryChange(e.target.value)}>
            <option value="">None</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Warranty (months)"
          {...(fieldError['warrantyMonths'] ? { error: fieldError['warrantyMonths'] } : {})}
        >
          <Input
            type="number"
            min={0}
            step={1}
            value={warrantyMonths}
            onChange={(e) => {
              setWarrantyMonths(e.target.value);
              setSuccess(false);
            }}
          />
        </Field>

        {mode === 'edit' && (
          <Field label="Status">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as ProductStatus);
                setSuccess(false);
              }}
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PRODUCT_STATUS_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {attrLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500" aria-busy="true">
          <Spinner className="h-4 w-4" /> Loading category attributes…
        </p>
      ) : (
        <AttributeFields
          legend="Product attributes"
          fields={fieldSets.product}
          optionsByDefinitionId={fieldSets.options}
          values={productAttributes}
          errors={attrError}
          onChange={setProductAttr}
        />
      )}

      {mode === 'create' && (
        <fieldset className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-medium text-slate-500">First variant (SKU)</legend>
          <p className="text-xs text-slate-500">
            Every product has at least one variant. You can add more from the product page afterwards.
          </p>

          <Field label="SKU" required {...(fieldError['sku'] ? { error: fieldError['sku'] } : {})}>
            <Input
              required
              maxLength={80}
              value={variant.sku}
              onChange={(e) => {
                setVariant((v) => ({ ...v, sku: e.target.value }));
                setSuccess(false);
              }}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Barcode">
              <Input
                maxLength={80}
                value={variant.barcode}
                onChange={(e) => setVariant((v) => ({ ...v, barcode: e.target.value }))}
              />
            </Field>
            <Field label="Unit">
              <Input
                maxLength={20}
                value={variant.unit}
                onChange={(e) => setVariant((v) => ({ ...v, unit: e.target.value }))}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Max price" required {...(fieldError['maxPrice'] ? { error: fieldError['maxPrice'] } : {})}>
              <Input
                type="number"
                min={0}
                step="any"
                value={variant.maxPrice}
                onChange={(e) => setVariant((v) => ({ ...v, maxPrice: e.target.value }))}
              />
            </Field>
            <Field label="Base price" required {...(fieldError['basePrice'] ? { error: fieldError['basePrice'] } : {})}>
              <Input
                type="number"
                min={0}
                step="any"
                value={variant.basePrice}
                onChange={(e) => setVariant((v) => ({ ...v, basePrice: e.target.value }))}
              />
            </Field>
            <Field
              label="Min price"
              required
              hint="Floor before an approval is needed."
              {...(fieldError['minPrice'] ? { error: fieldError['minPrice'] } : {})}
            >
              <Input
                type="number"
                min={0}
                step="any"
                value={variant.minPrice}
                onChange={(e) => setVariant((v) => ({ ...v, minPrice: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Cost" hint="Optional. Needs the cost permission to read back." {...(fieldError['cost'] ? { error: fieldError['cost'] } : {})}>
            <Input
              type="number"
              min={0}
              step="any"
              value={variant.cost}
              onChange={(e) => setVariant((v) => ({ ...v, cost: e.target.value }))}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={variant.isSerialized}
                onChange={(e) => setVariant((v) => ({ ...v, isSerialized: e.target.checked }))}
              />
              Serialized (each unit has its own serial number)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={variant.isLotTracked}
                onChange={(e) => setVariant((v) => ({ ...v, isLotTracked: e.target.checked }))}
              />
              Lot tracked
            </label>
          </div>

          {!attrLoading && (
            <AttributeFields
              legend="Variant attributes"
              fields={fieldSets.variant}
              optionsByDefinitionId={fieldSets.options}
              values={variantAttributes}
              errors={variantAttrError}
              onChange={setVariantAttr}
            />
          )}
        </fieldset>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Product saved.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty || attrLoading} className="w-fit">
          {mode === 'create' ? 'Create product' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" className="w-fit" onClick={() => router.push('/products')}>
          {mode === 'create' ? 'Cancel' : 'Back to products'}
        </Button>
      </div>
    </form>
  );
}
