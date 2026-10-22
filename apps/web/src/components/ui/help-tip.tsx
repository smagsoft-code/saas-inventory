'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/**
 * A small "?" icon that discloses a help legend on demand (click or keyboard), instead of printing
 * the legend permanently and spending screen space on it. Closes on Escape, on a click outside, and
 * on a second press of the icon. The legend is only in the DOM while open, so it never clutters the
 * page or the accessibility tree until the user asks for it.
 */
export function HelpTip({
  children,
  label = 'Ayuda',
  align = 'left',
  className,
}: {
  children: ReactNode;
  /** Accessible name of the icon button (e.g. "Ayuda sobre el precio base"). */
  label?: string;
  /** Which edge of the icon the popover lines up with — use `right` near the right screen edge. */
  align?: 'left' | 'right';
  className?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: MouseEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={rootRef} className={cn('relative inline-flex align-middle', className)}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 hover:border-slate-500 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <span
          id={panelId}
          role="tooltip"
          className={cn(
            'absolute top-full z-20 mt-1.5 w-64 rounded-md border border-slate-200 bg-white p-2.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-slate-600 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
