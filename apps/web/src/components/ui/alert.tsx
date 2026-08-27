import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'info' | 'success' | 'warning' | 'error';

const TONES: Record<Tone, string> = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-green-200 bg-green-50 text-green-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
};

/** Inline status message. An `error`/`warning` alert is a live region so assistive tech announces
 * it when it appears after a failed submit (Prompt 016 §26 / §44). */
export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role={tone === 'error' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('rounded-md border px-3 py-2 text-sm', TONES[tone], className)}
    >
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
    </div>
  );
}
