import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-red-100 text-red-700',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps the common `invited | active | disabled | suspended` status strings to a badge tone. */
export function statusTone(status: string): Tone {
  switch (status) {
    case 'active':
      return 'success';
    case 'invited':
      return 'warning';
    case 'disabled':
    case 'suspended':
      return 'danger';
    default:
      return 'neutral';
  }
}
