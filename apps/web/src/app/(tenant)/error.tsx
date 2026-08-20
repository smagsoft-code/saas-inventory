'use client';

import { useEffect } from 'react';
import { ApiError } from '../../lib/api-client';

/** Route-level error boundary (frontend.md#error-loading-and-empty-states) — an actionable
 * message, including the correlationId for support, never a raw stack trace or API error body. */
export default function TenantError({ error, reset }: { error: Error; reset: () => void }): React.JSX.Element {
  useEffect(() => {
    // Minimal client-side error visibility; a real error reporting integration is out of this
    // phase's scope.
    console.error(error);
  }, [error]);

  const correlationId = error instanceof ApiError ? error.correlationId : undefined;

  return (
    <div className="flex flex-col gap-3 p-8">
      <p className="text-sm text-red-600">Something went wrong loading this page.</p>
      {correlationId && <p className="text-xs text-slate-400">Reference: {correlationId}</p>}
      <button type="button" onClick={reset} className="w-fit rounded border border-slate-300 px-3 py-1.5 text-sm">
        Try again
      </button>
    </div>
  );
}
