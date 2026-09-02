import Link from 'next/link';
import { PageContainer } from '../../components/ui/page-container';

/** Generic not-found for the platform area — never reveals whether a resource exists. */
export default function SuperadminNotFound(): React.JSX.Element {
  return (
    <PageContainer>
      <div className="flex flex-col items-start gap-3 py-12">
        <h1 className="text-xl font-semibold text-slate-900">Not found</h1>
        <p className="text-sm text-slate-500">We couldn&apos;t find what you were looking for.</p>
        <Link href="/platform" className="text-sm font-medium text-slate-900 underline">
          Back to platform home
        </Link>
      </div>
    </PageContainer>
  );
}
