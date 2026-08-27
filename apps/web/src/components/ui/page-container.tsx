import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** The consistent max-width + vertical rhythm wrapper every authenticated page renders into, so
 * pages stop each defining their own margins (Prompt 016 §42). */
export function PageContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('mx-auto flex w-full max-w-5xl flex-col gap-6', className)}>{children}</div>
  );
}
