import Link from 'next/link';
import { PageContainer } from '../../components/ui/page-container';

/** Generic not-found for the platform area — never reveals whether a resource exists. */
export default function SuperadminNotFound(): React.JSX.Element {
  return (
    <PageContainer>
      <div className="flex flex-col items-start gap-3 py-12">
        <h1 className="text-xl font-semibold text-slate-900">No encontrado</h1>
        <p className="text-sm text-slate-500">No pudimos encontrar lo que buscabas.</p>
        <Link href="/platform" className="text-sm font-medium text-slate-900 underline">
          Volver al inicio de la plataforma
        </Link>
      </div>
    </PageContainer>
  );
}
