import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white', className)}>{children}</div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={cn('p-4 sm:p-6', className)}>{children}</div>;
}
