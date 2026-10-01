'use client';

/** Last-resort boundary for an error thrown in the root layout itself (Prompt 016 §26). It
 * replaces the whole document, so it must render its own <html>/<body>. Kept deliberately plain —
 * no shared components, since the failure may be in the component tree. */
export default function GlobalError({
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.JSX.Element {
  return (
    <html lang="es">
      <body className="flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Algo salió mal</h1>
        <p className="text-sm text-slate-500">
          Inténtalo de nuevo. Si el problema continúa, contacta a soporte.
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
