'use client';

import { useEffect, useState } from 'react';
import { toDataURL } from 'qrcode';

/**
 * Renders a scannable QR bitmap for a given value (OUI-007 — "Nuevo producto" auto-QR). The
 * backend's QR model is deliberately identity-only (`qr_codes.code`, no stored image —
 * `lib/types/qr.ts`'s own doc comment), so the bitmap is generated here, client-side, from the
 * `qrcode` package's browser build — encoding the public resolver URL (`{apiPublicUrl}/q/:code`)
 * that a phone camera actually needs to land on. A PNG data URL doubles as both the `<img>` source
 * (viewable) and something a print stylesheet can render at full size (printable) — no server
 * round-trip, no new API surface.
 */
export function QrCodeImage({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setError(null);
    toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo generar la imagen del código QR.');
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (error) {
    return <p className="text-sm text-red-700">{error}</p>;
  }
  if (!dataUrl) {
    return (
      <div
        className="animate-pulse rounded-md border border-slate-200 bg-slate-100"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  // A locally generated data URL, not a remote asset — next/image's remote-loader config is
  // unwarranted here (this project's eslint config has no next/image rule, see products-catalog-table.tsx).
  return (
    <img
      src={dataUrl}
      alt={`Código QR — ${value}`}
      width={size}
      height={size}
      className="rounded-md border border-slate-200"
    />
  );
}
