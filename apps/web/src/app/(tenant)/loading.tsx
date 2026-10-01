import { Skeleton } from '../../components/ui/skeleton';

/** Route-level loading state (frontend.md#error-loading-and-empty-states) — a shaped skeleton,
 * never a blank screen, while the server components resolve the session and page data. */
export default function TenantLoading(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="mx-auto flex w-full max-w-5xl flex-col gap-6"
    >
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
