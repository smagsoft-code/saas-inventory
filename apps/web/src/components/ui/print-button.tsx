'use client';

import { Button } from './button';

/**
 * "Descargar PDF" — the browser's own print dialog, not a generated file: the viewer picks
 * "Guardar como PDF" as the destination. No new dependency, no server round trip; the page's own
 * `print:` Tailwind variants (see `ShellLayout`'s nav/header, and any page using this button) hide
 * navigation chrome so only the content prints. Server-side PDF generation (a real designed
 * document, e.g. for a future fiscal invoice) is a deferred, explicitly future step — see
 * ADR-0023's amendment.
 */
export function PrintButton({ className }: { className?: string }): React.JSX.Element {
  return (
    <Button type="button" variant="secondary" size="sm" className={className} onClick={() => window.print()}>
      Descargar PDF
    </Button>
  );
}
