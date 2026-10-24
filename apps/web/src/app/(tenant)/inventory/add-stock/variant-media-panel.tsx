'use client';

import { ProductImageDimensions } from '../../../../components/product-image-dimensions';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { QrCodeImage } from '../../../../components/qr-code-image';

/**
 * Read-only photo + QR of the variant being stocked, in the same right-hand `<aside>` position and
 * size (`lg:w-72`, square image, inline QR) as "Nuevo producto". Nothing is edited here — images and
 * QR codes are managed from the product/variant screens. Both lookups are best-effort: a failure or
 * a missing permission simply shows the empty placeholder / hides the QR card.
 */
export function VariantMediaPanel({
  productId,
  variantId,
  apiPublicUrl,
  canViewQr,
}: {
  productId: string;
  variantId: string;
  apiPublicUrl: string;
  /** `catalog.qr.manage` — the permission every other QR surface requires to see a code. */
  canViewQr: boolean;
}): React.JSX.Element {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [qrValue, setQrValue] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    if (productId) {
      apiFetch<{ url: string }[]>(`/api/v1/products/${productId}/images`)
        .then((rows) => {
          if (!cancelled) setImageUrl(rows[0]?.url ?? null);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    setQrValue(null);
    if (variantId && canViewQr) {
      apiFetch<{ data: { code: string }[] }>('/api/v1/qr-codes', {
        query: { targetType: 'product_variant', targetId: variantId, pageSize: 1 },
      })
        .then((page) => {
          const code = page.data[0]?.code;
          if (!cancelled && code) setQrValue(`${apiPublicUrl.replace(/\/$/, '')}/q/${code}`);
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [variantId, canViewQr, apiPublicUrl]);

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-72 lg:shrink-0">
      <div className="rounded-md border border-slate-200 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900">Imagen del producto</h3>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="aspect-square w-full rounded-md border border-slate-200 bg-white object-contain"
          />
        ) : (
          <div
            className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-300"
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
        <ProductImageDimensions className="mt-2" />
      </div>

      {canViewQr && (
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Código QR</h3>
          {qrValue ? (
            <>
              <QrCodeImage value={qrValue} />
              <p className="mt-2 break-all text-xs text-slate-500">{qrValue}</p>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              {variantId
                ? 'Esta variante aún no tiene código QR.'
                : 'Elige una variante para ver su código QR.'}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
