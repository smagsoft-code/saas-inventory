'use client';

import { httpErrorMessage, isApiError } from '../../lib/api/errors';
import { Button } from './button';

/**
 * Consistent, non-technical rendering of a failure (frontend.md, Prompt 016 §26). Shows the
 * friendly per-status message and, when it is an `ApiError`, the `correlationId` for support —
 * never a stack trace or raw backend body. `onRetry` renders a retry button when provided.
 */
export function ErrorState({
  error,
  onRetry,
  title = 'Something went wrong',
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}): React.JSX.Element {
  const correlationId = isApiError(error) ? error.correlationId : undefined;

  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div>
        <p className="text-sm font-medium text-red-800">{title}</p>
        <p className="mt-0.5 text-sm text-red-700">{httpErrorMessage(error)}</p>
        {correlationId && (
          <p className="mt-1 text-xs text-red-600/80">Reference: {correlationId}</p>
        )}
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
