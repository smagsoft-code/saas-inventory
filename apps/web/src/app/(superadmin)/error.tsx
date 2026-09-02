'use client';

import { useEffect } from 'react';
import { ErrorState } from '../../components/ui/error-state';

/** Route-level error boundary for the platform area. Renders the shared non-technical
 * `ErrorState` (with `correlationId` for support) — never a raw stack. */
export default function SuperadminError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.JSX.Element {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <ErrorState error={error} onRetry={reset} title="This page could not be loaded" />
    </div>
  );
}
