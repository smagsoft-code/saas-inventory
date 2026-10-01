import Link from 'next/link';

/** Global 404 (Prompt 016 §27) — for a path that matches no route at all. Safe navigation home,
 * no detail about protected resources. */
export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-8 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-slate-400">404</p>
      <h1 className="text-xl font-semibold text-slate-900">Página no encontrada</h1>
      <p className="text-sm text-slate-500">La página que buscabas no existe.</p>
      <Link href="/" className="text-sm font-medium text-slate-900 underline">
        Ir al inicio
      </Link>
    </main>
  );
}
