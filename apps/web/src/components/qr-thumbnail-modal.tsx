'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { QrCodeImage } from './qr-code-image';

/**
 * A small clickable QR thumbnail that opens a modal ("ventana secundaria") with the code at a size
 * actually big enough to scan, plus a print action — OUI-008. Used both on `/products` (QR column)
 * and the variant edit page's image/QR card, so the exact same click-to-scan-or-print experience
 * exists everywhere a QR is shown, not just at creation time (OUI-007).
 *
 * A real in-page modal (`role="dialog"`, `aria-modal`, Escape + backdrop to close, body-scroll
 * lock) rather than `window.open()` — the same dialog convention `shell-layout.tsx`'s mobile drawer
 * already establishes — so there is no popup-blocker risk and printing can isolate just the QR via
 * the same `#qr-print-area` + `@media print` trick `product-form.tsx` already uses.
 */
export function QrThumbnailModal({
  value,
  label,
  maxPrice,
  defaultOpen,
}: {
  value: string;
  label: string;
  /** Shown on both the on-screen modal and the printed label — `maxPrice` is never
   * permission-gated (ADR-0028: only `minPrice`/`cost` are), so any caller that can already see
   * this QR's row/product can show it here too, with no extra check. Optional because a couple of
   * older callers may not have a variant price on hand; the label degrades to just the code. */
  maxPrice?: number;
  /** Opens the modal immediately on mount — `/qr/new` uses this so a freshly generated QR shows up
   * exactly the same way as clicking a thumbnail on `/products` does, instead of a silent redirect. */
  defaultOpen?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen ?? false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Ver código QR de ${label}`}
        className="rounded-md border border-slate-200 p-0.5 transition-colors hover:border-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        <QrCodeImage value={value} size={36} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Cerrar el código QR"
            className="absolute inset-0 bg-slate-900/50 print:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Código QR — ${label}`}
            id="qr-print-area"
            className="relative z-10 flex flex-col items-center gap-4 rounded-lg bg-white p-6 shadow-xl"
          >
            <h2 className="text-sm font-semibold text-slate-900">{label}</h2>
            <QrCodeImage value={value} size={320} />
            <p className="max-w-xs break-all text-center text-xs text-slate-500">{value}</p>
            {typeof maxPrice === 'number' && (
              <p className="text-sm font-medium text-slate-900">Precio máximo: {maxPrice.toFixed(2)}</p>
            )}
            <div className="flex gap-2 print:hidden">
              <Button type="button" onClick={() => window.print()}>
                Imprimir
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cerrar
              </Button>
            </div>
          </div>

          <style>{`
            @media print {
              body * { visibility: hidden; }
              #qr-print-area, #qr-print-area * { visibility: visible; }
              #qr-print-area { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; border: none; box-shadow: none; }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
