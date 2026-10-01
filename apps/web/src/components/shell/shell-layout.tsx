'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';

/**
 * The bare authenticated-shell frame (Prompt 016 §12 / F17-01 §15–§16): a compact icon rail on
 * desktop that expands to the full labeled sidebar on hover (OUI-005 — pure CSS, no JS state: the
 * `<aside>` itself carries `hover:w-64` plus a rule that any `.nav-label` descendant starts at
 * `opacity-0` and only reaches `opacity-100` while *this* element is hovered — moving the mouse off
 * collapses it back automatically, no click needed either way), a slide-over drawer on mobile (Esc /
 * overlay / route-change close, body-scroll lock, `aria-modal` dialog), a sticky header with
 * left/right slots, and the page content area.
 *
 * Deliberately context-free: it takes `brand`, `nav`, and header slots as props so both the
 * tenant `AppShell` and the platform `PlatformShell` compose it without duplicating the drawer
 * mechanics (F17-01 §19 — reuse over duplication). It holds no session/permission logic. `nav`'s own
 * item labels (and `brand`'s full text) must carry the `nav-label` class for the collapse to look
 * right — see `SidebarNav`/`PlatformNav`. The identical `nav`/`brand` nodes are rendered a second
 * time inside the always-expanded mobile drawer below; that subtree has no fade rule of its own, so
 * `.nav-label` there just sits at the browser default (visible) — the same nodes look right in both
 * places without any prop threading a "collapsed" flag down.
 */
export function ShellLayout({
  brand,
  nav,
  headerLeft,
  headerRight,
  banner,
  children,
}: {
  brand: ReactNode;
  nav: ReactNode;
  headerLeft?: ReactNode;
  headerRight?: ReactNode;
  /** Optional full-width strip rendered above the sticky header, inside the content column (never
   * above the fixed sidebar). Still context-free: a plain slot, no session/permission logic lives
   * here — e.g. `PlatformShell`'s ADR-0036 "modo soporte" banner. */
  banner?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) {
      return;
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setMobileNavOpen(false);
      }
    }
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop rail — collapsed (w-16, icons only) until hovered, then w-64 with labels. Fixed +
          overlaying (never pushes the content), so the content column below only ever reserves the
          collapsed width via lg:pl-16. */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden w-16 flex-col overflow-hidden',
          'border-r border-slate-200 bg-white shadow-none transition-[width] duration-200 ease-in-out',
          'hover:w-64 hover:shadow-xl lg:flex',
          // Only this rail's own `.nav-label` descendants fade in on hover — the identical `nav`/
          // `brand` nodes rendered again in the always-expanded mobile drawer below are a separate
          // DOM subtree with no such rule, so their labels stay visible there unconditionally.
          // `hover:[&_.nav-label]:opacity-100` (stacking `hover:` in FRONT of the arbitrary variant)
          // was the bug: Tailwind attaches the trailing variant to the LAST selector segment, so it
          // compiled to `.aside .nav-label:hover { opacity: 1 }` — the tiny invisible text itself
          // had to be hovered, not the sidebar — which is why the labels never appeared (verified
          // against the real computed CSS). Putting `:hover` on `&` inside one arbitrary variant
          // compiles to the correct `.aside:hover .nav-label { opacity: 1 }`.
          //
          // `max-w-0`/`overflow-hidden` alongside `opacity-0` (not opacity alone) — a label left at
          // its natural width while merely invisible still occupies that width in the flex row, so
          // the active item's rounded highlight pill (which wraps icon + gap + label) is wider than
          // the collapsed 64px rail and gets its right, rounded edge sheared off by this `<aside>`'s
          // own `overflow-hidden` — the real cause of "el ícono seleccionado queda incompleto",
          // confirmed against a real screenshot. Collapsing the label's own box to 0 width fixes it
          // regardless of how long any given label text is, which a wider rail alone would not.
          '[&_.nav-label]:opacity-0 [&_.nav-label]:max-w-0 [&_.nav-label]:overflow-hidden',
          '[&_.nav-label]:transition-[opacity,max-width] [&_.nav-label]:duration-150',
          '[&:hover_.nav-label]:opacity-100 [&:hover_.nav-label]:max-w-xs',
        )}
      >
        <div className="h-14 shrink-0 overflow-hidden whitespace-nowrap">{brand}</div>
        {/* On Windows, Chrome/Edge render a classic (non-overlay) scrollbar once this list of nav
            items is taller than the viewport — unlike the overlay scrollbars on macOS/Linux, that
            one takes up real layout width. Inside this 64px icon-only rail, that shrinks the
            available width and `overflow-x-hidden` then clips the right edge of the active item's
            pill/icon — confirmed against the reported screenshot. The rail doesn't need a visible
            track (it's still wheel/touch-scrollable without one, like VS Code's activity bar), so
            the fix is to hide the scrollbar rather than reserve space for it. */}
        <div
          className={cn(
            'flex-1 overflow-y-auto overflow-x-hidden px-3 py-4',
            '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden',
          )}
        >
          {nav}
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar navegación"
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navegación"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[80%] flex-col bg-white shadow-xl"
          >
            {brand}
            <div className="flex-1 overflow-y-auto px-3 py-4">{nav}</div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-col lg:pl-16">
        <div className="sticky top-0 z-20 flex flex-col">
          {banner}
          <header className="flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Abrir navegación"
                className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 lg:hidden"
              >
                <svg
                  className="h-5 w-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
                </svg>
              </button>
              {headerLeft}
            </div>
            {headerRight}
          </header>
        </div>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
