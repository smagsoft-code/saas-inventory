'use client';

import { useEffect } from 'react';
import { ErrorState } from '../../components/ui/error-state';

/** Route-level error boundary (frontend.md#error-loading-and-empty-states). Renders the shared,
 * non-technical `ErrorState` — including the `correlationId` for support — never a raw stack. */
export default function TenantError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    // Minimal client-side visibility; a real error-reporting integration is out of scope here.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ErrorState error={error} onRetry={reset} title="This page could not be loaded" />
    </div>
  );
}
