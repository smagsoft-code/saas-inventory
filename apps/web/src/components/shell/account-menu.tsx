'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

/**
 * Presentational account menu (Prompt 016 §41): identity block + a real sign-out. Keyboard
 * accessible — Escape closes and returns focus to the trigger, an outside click closes. No
 * profile/billing/notifications entries — those routes do not exist.
 *
 * Context-free: the tenant `UserMenu` and the platform account menu both feed it their own
 * `name`/`email`/`contextLabel` and their own `onSignOut` (F17-01 §19).
 */
export function AccountMenu({
  name,
  email,
  contextLabel,
  onSignOut,
  signingOut,
}: {
  name: string;
  email: string;
  /** A short line under the identity — the tenant name, or "Platform administrator". */
  contextLabel: string;
  onSignOut: () => void;
  signingOut: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onClick(event: MouseEvent): void {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || email[0]?.toUpperCase() || '?';

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
          {initials}
        </span>
        <span className="hidden max-w-[12rem] truncate sm:block">{name}</span>
        <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M5.5 7.5 10 12l4.5-4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Cuenta"
          className={cn(
            'absolute right-0 z-30 mt-1 w-64 rounded-md border border-slate-200 bg-white p-1 shadow-lg',
          )}
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{name}</p>
            <p className="truncate text-xs text-slate-500">{email}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{contextLabel}</p>
          </div>
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            role="menuitem"
            onClick={onSignOut}
            disabled={signingOut}
            className="w-full rounded px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </div>
      )}
    </div>
  );
}
