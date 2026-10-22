'use client';

import { useId, cloneElement, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { HelpTip } from './help-tip';

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
  /** Legend shown on demand behind a small "?" icon next to the label, instead of a permanent line
   * under the control (saves space). Prefer this over `hint` for explanatory text; `hint` stays for
   * text that must always be visible. */
  help?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
  /** Extra classes on the visible label text only (e.g. `sm:sr-only` to keep it screen-reader-only
   * from a breakpoint up, for a repeated table-like row whose column header already labeled the
   * first row — the accessible name is never lost, only the redundant visual repeat). */
  labelClassName?: string;
}

export function Field({
  label,
  children,
  hint,
  help,
  error,
  required,
  className,
  labelClassName,
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
      <span className={cn('flex items-center gap-0.5', labelClassName)}>
        <label htmlFor={id} className="text-sm font-medium text-slate-700">
          {label}
        </label>
        {required && (
          <span className="text-red-600" aria-hidden="true">
            *
          </span>
        )}
        {help && (
          <HelpTip className="ml-1">
            {help}
          </HelpTip>
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
