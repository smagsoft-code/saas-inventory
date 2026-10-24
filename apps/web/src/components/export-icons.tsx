// Plain inline SVGs, not an icon library — this design system doesn't use one anywhere else.
// Shared by every screen with Excel/PDF export links (Kardex, Formas de pago).
export function ExcelIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="3" width="14" height="14" rx="1.5" />
      <path d="M3 8h14M3 13h14M8.33 3v14M13.67 3v14" />
    </svg>
  );
}

export function PdfIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M6 2.5h5.5L15 6v11a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-14a.5.5 0 0 1 .5-.5Z" strokeLinejoin="round" />
      <path d="M11.5 2.5V6H15" strokeLinejoin="round" />
      <path d="M7 10.5h6M7 13h6" strokeLinecap="round" />
    </svg>
  );
}

/** The two icon-only download links, styled exactly like the Kardex ones. Plain `<a>`s (not Next's
 * `Link`): they navigate to a binary download (Content-Disposition: attachment). */
export function ExportLinks({ excelHref, pdfHref }: { excelHref: string; pdfHref: string }): React.JSX.Element {
  return (
    <div className="flex gap-1.5">
      <a
        href={excelHref}
        title="Exportar a Excel"
        aria-label="Exportar a Excel"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-green-700 hover:bg-slate-50"
      >
        <ExcelIcon />
      </a>
      <a
        href={pdfHref}
        title="Exportar a PDF"
        aria-label="Exportar a PDF"
        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-red-700 hover:bg-slate-50"
      >
        <PdfIcon />
      </a>
    </div>
  );
}
