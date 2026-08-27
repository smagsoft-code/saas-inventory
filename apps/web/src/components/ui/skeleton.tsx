import { cn } from '../../lib/cn';

/** A shimmering placeholder block for loading states (Prompt 016 §24). Decorative — the
 * surrounding `loading.tsx` / container carries the `role="status"` / label. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-slate-200', className)} />
  );
}
