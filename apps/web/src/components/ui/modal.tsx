'use client';

import { useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type Size = 'md' | 'lg' | 'xl';

/** Open modals, bottom = oldest. A modal opened on top of another (the product preview inside the
 * cart) must be the only one Escape closes — the one underneath stays open. */
const openModalStack: symbol[] = [];

const SIZES: Record<Size, string> = {
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-4xl',
};

/**
 * A generic modal dialog — the only reusable one in the app (the audit found no existing
 * `Modal`/`Dialog` component, just the ad-hoc `QrThumbnailModal` and the shell's mobile nav
 * drawer). Follows the same convention both already establish: `role="dialog"` + `aria-modal`,
 * Escape + overlay click to close, body-scroll lock while open.
 *
 * Responsive by default, no extra props needed: a bottom-sheet anchored to the viewport's bottom
 * edge below `sm` (mobile), a centered panel from `sm` up (tablet/desktop) — `size` only caps the
 * centered panel's max width, it never changes the mobile behavior.
 *
 * Closing the modal never discards anything by itself — every caller in this app backs its
 * content with server state (the `/cart` resource, customer records, …), so an accidental
 * Escape/overlay close just hides the UI; reopening shows the same state again.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
  emphasizeTitle = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Muted context shown next to the title (e.g. the sucursal · almacén a sale is made from). */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: Size;
  /** Phones and tablets: a large title with the subtitle underneath (the sale modal). From `lg` up it is the regular small header. */
  emphasizeTitle?: boolean;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!open) {
      return;
    }
    const self = Symbol('modal');
    openModalStack.push(self);
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && openModalStack[openModalStack.length - 1] === self) {
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      const index = openModalStack.indexOf(self);
      if (index >= 0) openModalStack.splice(index, 1);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Cerrar"
        className="absolute inset-0 bg-slate-900/50"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-10 flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl',
          'sm:max-h-[85vh] sm:w-full sm:rounded-2xl',
          SIZES[size],
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
          <div
            className={cn(
              'flex min-w-0 gap-y-0.5',
              emphasizeTitle
                ? 'flex-col lg:flex-row lg:flex-wrap lg:items-baseline lg:gap-x-3'
                : 'flex-wrap items-baseline gap-x-3',
            )}
          >
            <h2
              className={cn(
                'font-semibold text-slate-900',
                emphasizeTitle ? 'text-xl font-bold lg:text-sm lg:font-semibold' : 'text-sm',
              )}
            >
              {title}
            </h2>
            {subtitle && (
              <p
                className={cn(
                  'truncate text-slate-500',
                  emphasizeTitle ? 'text-sm lg:text-xs' : 'text-xs',
                )}
              >
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">{children}</div>
        {footer && <div className="border-t border-slate-200 px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
