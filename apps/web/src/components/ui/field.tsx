'use client';

import { useId, cloneElement, type ReactElement } from 'react';
import { cn } from '../../lib/cn';

type WiredControl = ReactElement<{
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}>;

interface FieldProps {
  label: string;
  /** The control element — its `id`, `aria-describedby`, and `aria-invalid` are wired up here so
   * callers don't repeat the plumbing (Prompt 016 §29 / §43). */
  children: WiredControl;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
}

export function Field({
  label,
  children,
  hint,
  error,
  required,
  className,
}: FieldProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const wiredProps: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean } = { id };
  if (describedBy) {
    wiredProps['aria-describedby'] = describedBy;
  }
  if (error) {
    wiredProps['aria-invalid'] = true;
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="flex items-baseline gap-0.5">
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {required && (
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        )}
      </span>
      {cloneElement(children, wiredProps)}
      {hint && !error && (
        <p id={hintId} className="text-xs text-slate-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
