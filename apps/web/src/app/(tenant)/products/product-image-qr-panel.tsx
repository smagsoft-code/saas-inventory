'use client';

import { ProductImageDimensions } from '../../../components/product-image-dimensions';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { Alert } from '../../../components/ui/alert';
import { Button, ButtonLink } from '../../../components/ui/button';
import { Spinner } from '../../../components/ui/spinner';
import { QrCodeImage } from '../../../components/qr-code-image';
import { ImageFilePicker } from '../../../components/image-file-picker';
import { useStagedImage } from './staged-image';

/** Mirrors `PRODUCT_IMAGE_ALLOWED_MIME_TYPES`/`PRODUCT_IMAGE_MAX_BYTES`
 * (`apps/api/src/catalog/products/product-images.service.ts`) — the same up-front client check
 * `product-form.tsx`'s create flow already uses; the backend re-enforces both. */
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * The image + QR panel on the variant edit page (OUI-008/OUI-009) — deliberately the exact same
 * markup, position (a right-hand `<aside>` next to the main form, never a full-width card below
 * it), and sizing (`lg:w-72`, `aspect-square` image, full `QrCodeImage` inline, not a thumbnail)
 * as `product-form.tsx`'s "Nuevo producto" create flow, so the two screens read as one consistent
 * feature rather than two different ones. The QR half always renders (unlike create mode, where it
 * only appears once a product exists) — editing an existing product means one already does — either
 * the real code or a "Generar código QR" action when the variant never got one.
 */
export function ProductImageQrPanel({
  productId,
  variantId,
  apiPublicUrl,
  canManageImage,
  canManageQr,
  maxPrice,
  initialImageUrl,
  initialQrValue,
}: {
  productId: string;
  variantId: string;
  apiPublicUrl: string;
  canManageImage: boolean;
  /** Gates both generating a new QR and seeing an existing one — the same `catalog.qr.manage`
   * permission every other QR surface in this app requires (the `/qr` list, the products table). */
  canManageQr: boolean;
  /** Printed on the QR label — never permission-gated (ADR-0028: only `minPrice`/`cost` are), so
   * always known here since the caller already loaded this variant to render the page at all. */
  maxPrice: number;
  initialImageUrl?: string;
  initialQrValue?: string;
}): React.JSX.Element {
  const staged = useStagedImage();
  const [imageUrl, setImageUrl] = useState<string | undefined>(initialImageUrl);
  // Local preview of the staged (picked, not yet saved) image.
  const [stagedPreview, setStagedPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!staged?.file) {
      setStagedPreview(null);
      return;
    }
    const url = URL.createObjectURL(staged.file);
    setStagedPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [staged?.file]);
  // After a save the page refreshes with the stored image; show it once the staged one is gone.
  useEffect(() => {
    setImageUrl(initialImageUrl);
  }, [initialImageUrl]);
  const [imageError, setImageError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [qrValue, setQrValue] = useState<string | undefined>(initialQrValue);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrGenerating, setQrGenerating] = useState(false);

  async function onPickImage(file: File | null): Promise<void> {
    setImageError(null);
    if (!file) return;
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      setImageError('Solo se aceptan imágenes JPEG, PNG o WEBP.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setImageError('Esa imagen supera el límite de 5 MB.');
      return;
    }
    if (staged) {
      // Edit screen: only stage it — it is uploaded by "Guardar cambios", with the other changes.
      staged.setFile(file);
      return;
    }
    setUploading(true);
    try {
      const image = new FormData();
      image.set('file', file);
      const created = await apiFetch<{ url: string }>(`/api/v1/products/${productId}/images`, {
        method: 'POST',
        body: image,
      });
      setImageUrl(created.url);
    } catch (err) {
      setImageError(httpErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function onGenerateQr(): Promise<void> {
    setQrError(null);
    setQrGenerating(true);
    try {
      const created = await apiFetch<{ code: string }>('/api/v1/qr-codes', {
        method: 'POST',
        body: { targetType: 'product_variant', targetId: variantId },
      });
      setQrValue(`${apiPublicUrl.replace(/\/$/, '')}/q/${created.code}`);
      staged?.setQrGenerated(true);
    } catch (err) {
      setQrError(httpErrorMessage(err));
    } finally {
      setQrGenerating(false);
    }
  }

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-72 lg:shrink-0">
      <div className="rounded-md border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Imagen del producto</h3>
        {stagedPreview || imageUrl ? (
          // A same-origin path from the API (`ProductImageResponseDto.url`), never a fabricated
          // one — same posture as `products-catalog-table.tsx`'s real thumbnails.
          <img
            src={stagedPreview ?? imageUrl}
            alt=""
            className="mb-1 aspect-square w-full rounded-md border border-slate-200 bg-white object-contain"
          />
        ) : (
          <div
            className="mb-1 flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-300"
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
        <ProductImageDimensions />
        {canManageImage && (
          <>
            {uploading && (
              <p className="mb-2 flex items-center gap-2 text-xs text-slate-500" aria-busy="true">
                <Spinner className="h-3 w-3" /> Subiendo…
              </p>
            )}
            {stagedPreview && (
              <p className="mb-2 flex items-center gap-2 text-xs text-slate-600" role="status">
                Imagen nueva sin guardar — pulsa «Guardar cambios».
                <button type="button" className="font-medium underline" onClick={() => staged?.setFile(null)}>
                  Descartar
                </button>
              </p>
            )}
            <ImageFilePicker
              label={imageUrl || stagedPreview ? 'Reemplazar imagen' : 'Elegir imagen'}
              hint="Opcional. JPEG, PNG o WEBP, hasta 5 MB."
              accept={IMAGE_ACCEPT}
              disabled={uploading}
              error={imageError}
              onPick={(file) => void onPickImage(file)}
            />
          </>
        )}
      </div>

      {canManageQr && (
        <div id="qr-print-area" className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Código QR</h3>
          {qrValue ? (
            <>
              <QrCodeImage value={qrValue} />
              <p className="mt-2 break-all text-xs text-slate-500">{qrValue}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">Precio máximo: {maxPrice.toFixed(2)}</p>
              <div className="mt-3 flex gap-2 print:hidden">
                <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
                  Imprimir
                </Button>
                <ButtonLink href="/qr" variant="ghost" size="sm">
                  Ver todos los QR
                </ButtonLink>
              </div>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={qrGenerating}
                onClick={() => void onGenerateQr()}
              >
                Generar código QR
              </Button>
              {qrError && (
                <Alert tone="error" className="mt-2">
                  {qrError}
                </Alert>
              )}
            </>
          )}
        </div>
      )}

      {canManageQr && qrValue && (
        // Same isolation trick as `product-form.tsx` — print only the QR panel, restored
        // automatically once the print job closes, no state to clean up.
        <style>{`
          @media print {
            body * { visibility: hidden; }
            #qr-print-area, #qr-print-area * { visibility: visible; }
            #qr-print-area { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; }
          }
        `}</style>
      )}
    </aside>
  );
}
