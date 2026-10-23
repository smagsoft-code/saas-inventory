'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { HelpTip } from '../../../components/ui/help-tip';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  loadCategoryAttributeFieldSets,
  pruneAttributeValues,
  validateAttributeValues,
  type CategoryAttributeFieldSets,
} from '../../../lib/catalog/product-attributes';
import type { AttributeDefinition } from '../../../lib/types/catalog';
import { fetchNextSku } from '../../../lib/catalog/sku-suggest';
import {
  PRODUCT_STATUSES,
  PRODUCT_STATUS_LABELS,
  pricesAreOrdered,
  type Product,
  type ProductStatus,
} from '../../../lib/types/products';
import type { QrCode } from '../../../lib/types/qr';
import { Alert } from '../../../components/ui/alert';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select, Textarea } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
import { Spinner } from '../../../components/ui/spinner';
import { QrCodeImage } from '../../../components/qr-code-image';
import { ImageFilePicker } from '../../../components/image-file-picker';
import { SearchSelect } from '../../../components/search-select';
import { TrackingOptions } from './tracking-options';
import { AttributeFields } from './attribute-fields';

const PRODUCTS_PATH = '/api/v1/products';
const EMPTY_SETS: CategoryAttributeFieldSets = { product: [], variant: [], options: {} };

/** Mirrors `PRODUCT_IMAGE_ALLOWED_MIME_TYPES`/`PRODUCT_IMAGE_MAX_BYTES`
 * (`apps/api/src/catalog/products/product-images.service.ts`) — an up-front client check; the
 * backend re-enforces both. */
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

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
  apiPublicUrl,
  canAddStock,
}: {
  mode: 'create' | 'edit';
  product?: Product;
  categories: CategoryOption[];
  definitions: AttributeDefinition[];
  initialFieldSets: CategoryAttributeFieldSets;
  /** The API's own public origin (`API_URL`/`NEXT_PUBLIC_API_URL`, never a secret — same posture
   * as `lib/api/client.ts`'s own doc comment) — needed only in `create` mode, to build the QR's
   * encoded value (`GET /q/:code` is a public API route, deliberately never proxied through
   * `/api/*`, so it needs the API's real origin, not a same-origin path). */
  apiPublicUrl?: string;
  /** OUI-011 — `checker.can('inventory.adjust')`, resolved server-side. The success panel never
   * assumes a caller who can create a product can also add stock — those are different
   * permission domains; this prop is the only source of truth for showing that action. */
  canAddStock?: boolean;
}): React.JSX.Element {
  const router = useRouter();

  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(
    typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '',
  );
  const [status, setStatus] = useState<ProductStatus>(
    (product?.status as ProductStatus) ?? 'active',
  );

  const [fieldSets, setFieldSets] = useState<CategoryAttributeFieldSets>(initialFieldSets);
  const [attrLoading, setAttrLoading] = useState(false);
  const [productAttributes, setProductAttributes] = useState<Record<string, unknown>>(
    product?.attributes ? { ...product.attributes } : {},
  );
  const [variantAttributes, setVariantAttributes] = useState<Record<string, unknown>>({});
  const [variant, setVariant] = useState<VariantDraft>(EMPTY_VARIANT);
  // Tracks whether SKU/barcode still hold an auto-suggested value (vs. one the user typed) — once
  // edited by hand, a category change never overwrites it again.
  const [skuAutoGenerated, setSkuAutoGenerated] = useState(true);
  const skuAutoGeneratedRef = useRef(true);
  skuAutoGeneratedRef.current = skuAutoGenerated;
  const [barcodeAutoGenerated, setBarcodeAutoGenerated] = useState(true);
  const [skuSuggestLoading, setSkuSuggestLoading] = useState(false);

  // Create: propose the next automatic product code — the first three letters of the category plus
  // the next number of that prefix across all categories (ARM-001, ARM-002…; PRD-001 without a
  // category) — when the form opens and again whenever the category changes, as long as the user has
  // not typed their own. A failed lookup just leaves the field empty: with an untouched code the
  // server assigns it anyway.
  useEffect(() => {
    if (mode !== 'create') return;
    let cancelled = false;
    setSkuSuggestLoading(true);
    fetchNextSku(categoryId || undefined)
      .then((code) => {
        if (!cancelled) setVariant((v) => (skuAutoGeneratedRef.current ? { ...v, sku: code } : v));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSkuSuggestLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, categoryId]);

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [attrError, setAttrError] = useState<Record<string, string>>({});
  const [variantAttrError, setVariantAttrError] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // --- OUI-007: right-side image + auto-QR, `create` mode only ---
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [noImageConfirmOpen, setNoImageConfirmOpen] = useState(false);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [createdProduct, setCreatedProduct] = useState<Product | null>(null);
  const [createdVariant, setCreatedVariant] = useState<{ id: string; sku: string } | null>(null);
  const [postCreateWarning, setPostCreateWarning] = useState<string | null>(null);
  const [qr, setQr] = useState<QrCode | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);

  // Revoke the object URL on unmount / when a new file replaces it — it is never persisted.
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  function onPickImage(next: File | null): void {
    setImageError(null);
    if (!next) {
      setImageFile(null);
      return;
    }
    if (!IMAGE_ACCEPT.split(',').includes(next.type)) {
      setImageFile(null);
      setImageError('Solo se aceptan imágenes JPEG, PNG o WEBP.');
      return;
    }
    if (next.size > IMAGE_MAX_BYTES) {
      setImageFile(null);
      setImageError('Esa imagen supera el límite de 5 MB.');
      return;
    }
    setImagePreviewUrl((cur) => {
      if (cur) URL.revokeObjectURL(cur);
      return URL.createObjectURL(next);
    });
    setImageFile(next);
  }

  const originalCategoryId = product?.categoryId ?? '';
  const originalAttributes = useMemo(() => JSON.stringify(product?.attributes ?? {}), [product]);

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

  // The barcode default always tracks the SKU ("COD-" + sku) — whether the SKU came from the
  // category suggestion above or was typed by hand — until the user edits the barcode itself.
  useEffect(() => {
    if (mode !== 'create' || !barcodeAutoGenerated) {
      return;
    }
    const expected = variant.sku ? `COD-${variant.sku}` : '';
    setVariant((v) => (v.barcode === expected ? v : { ...v, barcode: expected }));
  }, [variant.sku, barcodeAutoGenerated, mode]);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0 || (!skuAutoGenerated && variant.sku.trim().length > 0);
    }
    return (
      name.trim() !== (product?.name ?? '') ||
      description !== (product?.description ?? '') ||
      categoryId !== originalCategoryId ||
      warrantyMonths !==
        (typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '') ||
      status !== product?.status ||
      JSON.stringify(productAttributes) !== originalAttributes
    );
  }, [
    mode,
    name,
    description,
    categoryId,
    warrantyMonths,
    status,
    productAttributes,
    variant.sku,
    product,
    originalCategoryId,
    originalAttributes,
  ]);

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
      next['name'] = 'El nombre debe tener 2–200 caracteres.';
    }
    if (
      warrantyMonths !== '' &&
      (!Number.isInteger(Number(warrantyMonths)) || Number(warrantyMonths) < 0)
    ) {
      next['warrantyMonths'] = 'La garantía debe ser un número entero de meses (0 o más).';
    }

    if (mode === 'create') {
      // An untouched automatic code is not validated here: the server assigns it.
      if (!skuAutoGenerated && (variant.sku.trim().length < 1 || variant.sku.trim().length > 80)) {
        next['sku'] = 'El código debe tener 1–80 caracteres.';
      }
      const max = Number(variant.maxPrice);
      const base = Number(variant.basePrice);
      const min = Number(variant.minPrice);
      for (const [key, raw] of [
        ['maxPrice', variant.maxPrice],
        ['basePrice', variant.basePrice],
        ['minPrice', variant.minPrice],
      ] as const) {
        if (raw === '' || Number.isNaN(Number(raw)) || Number(raw) < 0) {
          next[key] = 'Ingresa un precio de 0 o más.';
        }
      }
      if (
        !next['maxPrice'] &&
        !next['basePrice'] &&
        !next['minPrice'] &&
        !pricesAreOrdered(min, base, max)
      ) {
        next['minPrice'] = 'Los precios deben cumplir mínimo ≤ base ≤ máximo.';
      }
      if (variant.cost !== '' && (Number.isNaN(Number(variant.cost)) || Number(variant.cost) < 0)) {
        next['cost'] = 'Ingresa un costo de 0 o más.';
      }
    }

    const productAttrErrors = validateAttributeValues(productAttributes, fieldSets.product);
    const variantAttrErrors =
      mode === 'create' ? validateAttributeValues(variantAttributes, fieldSets.variant) : {};

    setFieldError(next);
    setAttrError(productAttrErrors);
    setVariantAttrError(variantAttrErrors);
    return (
      Object.keys(next).length === 0 &&
      Object.keys(productAttrErrors).length === 0 &&
      Object.keys(variantAttrErrors).length === 0
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (submitting || !dirty || attrLoading) {
      return;
    }
    if (!validate()) {
      return;
    }
    // Creating without a picture: ask first, once the rest of the form is valid.
    if (mode === 'create' && !imageFile) {
      setNoImageConfirmOpen(true);
      return;
    }
    void save();
  }

  async function save(): Promise<void> {
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const body: Record<string, unknown> = {
          name: name.trim(),
          attributes: pruneAttributeValues(productAttributes, fieldSets.product),
          defaultVariant: {
            // Untouched automatic code -> omitted: the server assigns the real next PRD-00X (and COD-<sku>).
            ...(skuAutoGenerated ? {} : { sku: variant.sku.trim() }),
            ...(variant.barcode.trim() && !(skuAutoGenerated && barcodeAutoGenerated) ? { barcode: variant.barcode.trim() } : {}),
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
        // Deliberately no immediate `router.replace()` here (unlike the old behavior) — OUI-007
        // needs the right-side panel to actually show the uploaded image + the auto-generated QR
        // (visualizar/imprimir) before the caller navigates away; `router.refresh()` happens once
        // they choose to via the "Ver producto" action below.
        setCreatedProduct(created);
        setSubmitting(false);
        router.refresh();

        let variantId: string | null = null;
        try {
          const variants = await apiFetch<{ id: string; sku: string }[]>(
            `${PRODUCTS_PATH}/${created.id}/variants`,
          );
          const defaultVariant = variants[0];
          variantId = defaultVariant?.id ?? null;
          if (defaultVariant) {
            setCreatedVariant({ id: defaultVariant.id, sku: defaultVariant.sku });
          }
        } catch {
          variantId = null;
        }

        if (imageFile) {
          try {
            const imageForm = new FormData();
            imageForm.set('file', imageFile);
            await apiFetch(`${PRODUCTS_PATH}/${created.id}/images`, {
              method: 'POST',
              body: imageForm,
            });
          } catch {
            setPostCreateWarning(
              'El producto se creó, pero no se pudo subir la imagen. Puedes intentarlo de nuevo desde la página del producto.',
            );
          }
        }

        if (variantId) {
          setQrLoading(true);
          try {
            const createdQr = await apiFetch<QrCode>('/api/v1/qr-codes', {
              method: 'POST',
              body: { targetType: 'product_variant', targetId: variantId },
            });
            setQr(createdQr);
          } catch {
            setQrFailed(true);
          } finally {
            setQrLoading(false);
          }
        } else {
          setQrFailed(true);
        }
        return;
      }

      const body: Record<string, unknown> = {};
      if (name.trim() !== (product?.name ?? '')) body['name'] = name.trim();
      if (description !== (product?.description ?? '')) body['description'] = description.trim();
      if (status !== product?.status) body['status'] = status;
      if (
        warrantyMonths !==
        (typeof product?.warrantyMonths === 'number' ? String(product.warrantyMonths) : '')
      ) {
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
        setError('Ya no tienes permiso para hacer este cambio.');
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
    <div
      className={mode === 'create' ? 'flex flex-col gap-8 lg:flex-row lg:items-start' : undefined}
    >
      <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-xl flex-col gap-5">
        <fieldset disabled={mode === 'create' && createdProduct !== null} className="contents">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="flex items-center gap-1 text-sm font-medium text-slate-700">
                Categoría
                <HelpTip>Determina los atributos dinámicos de abajo.</HelpTip>
              </span>
              {/* A search bar, not a dropdown: the categories are already loaded, so the match is a
                  local, case-insensitive "contains" on the name — no extra request. */}
              <SearchSelect<CategoryOption>
                selected={
                  categoryId ? { id: categoryId, label: categories.find((c) => c.id === categoryId)?.name ?? categoryId } : null
                }
                search={async (q) => {
                  const needle = q.trim().toLocaleLowerCase('es');
                  return categories.filter((c) => c.name.toLocaleLowerCase('es').includes(needle)).slice(0, 10);
                }}
                getKey={(category) => category.id}
                renderOption={(category) => <span className="font-medium text-slate-900">{category.name}</span>}
                onSelect={(category) => void onCategoryChange(category.id)}
                onClear={() => void onCategoryChange('')}
                ariaLabel="Buscar categoría"
                listLabel="Categorías encontradas"
                placeholder="Busca una categoría (opcional)"
                emptyText="Ninguna categoría coincide con esa búsqueda."
                clearLabel="Cambiar"
              />
            </div>

            <Field
              label="Nombre"
              required
              {...(fieldError['name'] ? { error: fieldError['name'] } : {})}
            >
              <Input
                required
                minLength={2}
                maxLength={200}
                className="uppercase"
                value={name}
                onChange={(e) => {
                  // Product names are always stored in capitals.
                  setName(e.target.value.toUpperCase());
                  setSuccess(false);
                }}
              />
            </Field>

            <Field label="Descripción">
              <Textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setSuccess(false);
                }}
              />
            </Field>

            <Field
              label="Garantía (meses)"
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
              <Field label="Estado">
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
              <Spinner className="h-4 w-4" /> Cargando atributos de la categoría…
            </p>
          ) : (
            <AttributeFields
              legend="Atributos del producto"
              fields={fieldSets.product}
              optionsByDefinitionId={fieldSets.options}
              values={productAttributes}
              errors={attrError}
              onChange={setProductAttr}
            />
          )}

          {mode === 'create' && (
            <fieldset className="flex flex-col gap-4 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-medium text-slate-500">
                <span className="flex items-center gap-1">
                  Primera variante (Código)
                  <HelpTip>
                    Todo producto tiene al menos una variante. Puedes agregar más desde la página del producto luego.
                  </HelpTip>
                </span>
              </legend>

              <Field
                label="Código"
                required
                {...(fieldError['sku']
                  ? { error: fieldError['sku'] }
                  : skuSuggestLoading
                    ? { hint: 'Obteniendo el siguiente código…' }
                    : skuAutoGenerated && variant.sku
                      ? { hint: 'Automático: 3 primeras letras de la categoría + secuencia — puedes editarlo.' }
                      : {})}
              >
                <Input
                  required
                  maxLength={80}
                  value={variant.sku}
                  onChange={(e) => {
                    setSkuAutoGenerated(false);
                    setVariant((v) => ({ ...v, sku: e.target.value.toUpperCase() }));
                    setSuccess(false);
                  }}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Código de barras"
                  {...(barcodeAutoGenerated && variant.barcode
                    ? { hint: 'Sugerido a partir del código — puedes editarlo.' }
                    : {})}
                >
                  <Input
                    maxLength={80}
                    value={variant.barcode}
                    onChange={(e) => {
                      setBarcodeAutoGenerated(false);
                      setVariant((v) => ({ ...v, barcode: e.target.value.toUpperCase() }));
                    }}
                  />
                </Field>
                <Field label="Unidad">
                  <Input
                    maxLength={20}
                    value={variant.unit}
                    onChange={(e) => setVariant((v) => ({ ...v, unit: e.target.value }))}
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field
                  label="Precio máximo"
                  required
                  {...(fieldError['maxPrice'] ? { error: fieldError['maxPrice'] } : {})}
                >
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={variant.maxPrice}
                    onChange={(e) => setVariant((v) => ({ ...v, maxPrice: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Precio base"
                  required
                  help="Por debajo de este precio se necesita aprobación."
                  {...(fieldError['basePrice'] ? { error: fieldError['basePrice'] } : {})}
                >
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    value={variant.basePrice}
                    onChange={(e) => setVariant((v) => ({ ...v, basePrice: e.target.value }))}
                  />
                </Field>
                <Field
                  label="Precio mínimo"
                  required
                  help="Piso de referencia del precio."
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

              <Field
                label="Costo"
                help="Opcional. Necesita el permiso de costo para leerse de vuelta."
                {...(fieldError['cost'] ? { error: fieldError['cost'] } : {})}
              >
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={variant.cost}
                  onChange={(e) => setVariant((v) => ({ ...v, cost: e.target.value }))}
                />
              </Field>

              <TrackingOptions
                isSerialized={variant.isSerialized}
                isLotTracked={variant.isLotTracked}
                onSerializedChange={(value) => setVariant((v) => ({ ...v, isSerialized: value }))}
                onLotTrackedChange={(value) => setVariant((v) => ({ ...v, isLotTracked: value }))}
              />

              {!attrLoading && (
                <AttributeFields
                  legend="Atributos de la variante"
                  fields={fieldSets.variant}
                  optionsByDefinitionId={fieldSets.options}
                  values={variantAttributes}
                  errors={variantAttrError}
                  onChange={setVariantAttr}
                />
              )}
            </fieldset>
          )}
        </fieldset>

        {error && <Alert tone="error">{error}</Alert>}
        {success && <Alert tone="success">Producto guardado.</Alert>}
        {postCreateWarning && <Alert tone="warning">{postCreateWarning}</Alert>}

        {createdProduct ? (
          <div className="flex flex-wrap gap-2">
            {canAddStock && createdVariant && (
              <ButtonLink
                href={`/inventory/add-stock?productVariantId=${createdVariant.id}&sku=${encodeURIComponent(createdVariant.sku)}`}
                variant="secondary"
                className="w-fit"
              >
                Agregar stock
              </ButtonLink>
            )}
            <ButtonLink href={`/products/${createdProduct.id}`} className="w-fit">
              Ver producto
            </ButtonLink>
            <Button
              type="button"
              variant="ghost"
              className="w-fit"
              onClick={() => router.push('/products')}
            >
              Ir al catálogo
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              type="submit"
              loading={submitting}
              disabled={!dirty || attrLoading}
              className="w-fit"
            >
              {mode === 'create' ? 'Crear producto' : 'Guardar cambios'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="w-fit"
              onClick={() => router.push('/products')}
            >
              {mode === 'create' ? 'Cancelar' : 'Volver a productos'}
            </Button>
          </div>
        )}
      </form>

      <Modal
        open={noImageConfirmOpen}
        onClose={() => setNoImageConfirmOpen(false)}
        title="Producto sin imagen"
        size="md"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setNoImageConfirmOpen(false)}>
              Volver a cargar imagen
            </Button>
            <Button
              type="button"
              onClick={() => {
                setNoImageConfirmOpen(false);
                void save();
              }}
            >
              Guardar de todos modos
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          No has cargado una imagen para este producto. Puedes guardarlo así y agregarla después, o volver y cargarla ahora.
        </p>
      </Modal>

      {mode === 'create' && (
        <aside className="flex w-full flex-col gap-4 lg:w-72 lg:shrink-0">
          <div className="rounded-md border border-slate-200 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Imagen del producto</h3>
            {imagePreviewUrl ? (
              // A local object URL preview, never persisted as-is — same posture as
              // products-catalog-table.tsx's real thumbnails (no next/image remote-loader needed).
              <img
                src={imagePreviewUrl}
                alt=""
                className="mb-3 aspect-square w-full rounded-md border border-slate-200 object-cover"
              />
            ) : (
              <div
                className="mb-3 flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-300"
                aria-hidden
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-10 w-10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <path d="M21 15l-5-5-9 9" />
                </svg>
              </div>
            )}
            <ImageFilePicker
              label="Elegir imagen"
              hint="Opcional. JPEG, PNG o WEBP, hasta 5 MB."
              accept={IMAGE_ACCEPT}
              disabled={createdProduct !== null}
              error={imageError}
              onPick={onPickImage}
            />
          </div>

          {createdProduct && (
            <div id="qr-print-area" className="rounded-md border border-slate-200 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">Código QR</h3>
              {qrLoading ? (
                <p className="flex items-center gap-2 text-sm text-slate-500" aria-busy="true">
                  <Spinner className="h-4 w-4" /> Generando código QR…
                </p>
              ) : qr ? (
                <>
                  <QrCodeImage value={`${(apiPublicUrl ?? '').replace(/\/$/, '')}/q/${qr.code}`} />
                  <p className="mt-2 break-all text-xs text-slate-500">
                    {`${(apiPublicUrl ?? '').replace(/\/$/, '')}/q/${qr.code}`}
                  </p>
                  <p className="mt-1 text-sm font-medium text-slate-900">
                    Precio máximo: {Number(variant.maxPrice).toFixed(2)}
                  </p>
                  <div className="mt-3 flex gap-2 print:hidden">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => window.print()}
                    >
                      Imprimir
                    </Button>
                    <ButtonLink href="/qr" variant="ghost" size="sm">
                      Ver todos los QR
                    </ButtonLink>
                  </div>
                </>
              ) : qrFailed ? (
                <p className="text-sm text-red-700">
                  No se pudo generar el código QR automáticamente. Puedes generarlo desde la página
                  de QR.
                </p>
              ) : null}
            </div>
          )}
        </aside>
      )}

      {mode === 'create' && (
        // Print only the QR panel — everything else on the page is hidden for the duration of the
        // print job (restored automatically once it closes, no state to clean up).
        <style>{`
        @media print {
          body * { visibility: hidden; }
          #qr-print-area, #qr-print-area * { visibility: visible; }
          #qr-print-area { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; }
        }
      `}</style>
      )}
    </div>
  );
}
