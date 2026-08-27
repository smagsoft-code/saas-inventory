import type { ReactNode } from 'react';

/** "The request succeeded and there is legitimately no data" — a distinct state from loading and
 * error (frontend.md#error-loading-and-empty-states, Prompt 016 §25). The optional `action` slot
 * is where a caller puts a permission-gated call-to-action. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description && <p className="max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
