import Link from 'next/link';
import { PageContainer } from '../../components/ui/page-container';

/** Shown for a `notFound()` inside the authenticated area (e.g. a user id that does not resolve
 * within the tenant). Deliberately generic — it never reveals whether the resource exists for
 * someone else (Prompt 016 §27). */
export default function TenantNotFound(): React.JSX.Element {
  return (
    <PageContainer>
      <div className="flex flex-col items-start gap-3 py-12">
        <h1 className="text-xl font-semibold text-slate-900">No encontrado</h1>
        <p className="text-sm text-slate-500">No pudimos encontrar lo que buscabas.</p>
        <Link href="/" className="text-sm font-medium text-slate-900 underline">
          Volver al inicio
        </Link>
      </div>
    </PageContainer>
  );
}
