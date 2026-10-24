'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent as ReactTouchEvent } from 'react';
import { isNavItemActive, type NavItem, type NavSection } from '../../lib/navigation';
import { cn } from '../../lib/cn';
import { NavIconGlyph } from './nav-icon';

/** The tabs the phone bar leads with, in order. `+` is the centre "nueva venta" action. */
const MAIN_TABS: { href: string; label: string; plus?: boolean }[] = [
  { href: '/', label: 'Inicio' },
  { href: '/products', label: 'Productos' },
  { href: '/sales/new', label: 'Nueva venta', plus: true },
  { href: '/inventory', label: 'Inventario' },
  { href: '/sales', label: 'Ventas' },
];

export interface MobileTab {
  item: NavItem;
  label: string;
  plus: boolean;
}

/**
 * Which tabs the bar can show, from the already permission-filtered navigation: the main ones the
 * user may use (in the fixed order above), then every other navigation item in its usual order. A
 * main tab the user has no permission for simply does not appear (never a dead tab). Pure, so it is
 * unit-testable.
 */
export function buildMobileTabs(sections: NavSection[]): MobileTab[] {
  const items = sections.flatMap((section) => section.items);
  const byHref = new Map(items.map((item) => [item.href, item]));
  const main: MobileTab[] = MAIN_TABS.flatMap((tab) => {
    const item = byHref.get(tab.href);
    return item ? [{ item, label: tab.label, plus: Boolean(tab.plus) }] : [];
  });
  const mainHrefs = new Set(main.map((tab) => tab.item.href));
  const rest: MobileTab[] = items.filter((item) => !mainHrefs.has(item.href)).map((item) => ({ item, label: item.label, plus: false }));
  return [...main, ...rest];
}

/**
 * The tabs actually on screen for a given rotation. Without a `+` the window is 5 tabs, with it 4
 * (two on each side of the fixed centre button). More tabs than the window → a circular window that
 * starts at `offset` and wraps past the last tab back to the first; otherwise everything is shown.
 */
export function visibleTabs(others: MobileTab[], offset: number, hasPlus: boolean): { tabs: MobileTab[]; rotating: boolean } {
  const size = hasPlus ? 4 : 5;
  if (others.length <= size) return { tabs: others, rotating: false };
  const n = others.length;
  return { tabs: Array.from({ length: size }, (_, i) => others[(((offset + i) % n) + n) % n]!), rotating: true };
}

const SWIPE_MIN_PX = 24;

/**
 * The bottom navigation of phones and tablets (hidden from `lg`, where the sidebar takes over). The
 * centre ＋ (nueva venta) is fixed — a raised round button overlapping the page — and never moves.
 * Around it sit four tabs, two on each side: Inicio · Productos · ＋ · Inventario · Ventas to start
 * with. Swiping the bar sideways rotates the *other* tabs through those four slots, endlessly (after
 * the last comes the first again), so every navigation item is reachable without a scrollbar. The
 * hamburger drawer still lists everything for keyboard and screen-reader users.
 */
export function MobileTabBar({ sections }: { sections: NavSection[] }): React.JSX.Element {
  const pathname = usePathname();
  const all = buildMobileTabs(sections);
  const plus = all.find((tab) => tab.plus);
  const others = all.filter((tab) => !tab.plus);
  const allHrefs = sections.flatMap((section) => section.items.map((item) => item.href));

  const [offset, setOffset] = useState(0);
  const { tabs, rotating } = visibleTabs(others, offset, Boolean(plus));
  const left = plus ? tabs.slice(0, Math.ceil(tabs.length / 2)) : tabs;
  const right = plus ? tabs.slice(Math.ceil(tabs.length / 2)) : [];

  const startX = useRef<number | null>(null);
  const swiped = useRef(false);
  const barRef = useRef<HTMLElement>(null);

  function begin(x: number): void {
    startX.current = x;
  }
  function finish(x: number): void {
    const from = startX.current;
    startX.current = null;
    if (from === null || !rotating) return;
    const dx = x - from;
    if (Math.abs(dx) < SWIPE_MIN_PX) return;
    // One slot per ~slot-width of travel (at least one): a long swipe moves further around.
    const slot = (barRef.current?.clientWidth || 360) / 5; // 0 before layout (or without one) → a phone-sized fallback
    const steps = Math.max(1, Math.round(Math.abs(dx) / slot));
    const n = others.length;
    setOffset((current) => (((current + (dx < 0 ? steps : -steps)) % n) + n) % n);
    swiped.current = true;
    setTimeout(() => {
      swiped.current = false;
    }, 0);
  }

  function renderTab({ item, label }: MobileTab): React.JSX.Element {
    const active = isNavItemActive(item, pathname, allHrefs);
    return (
      <li key={item.href} className="min-w-0 flex-1">
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          className="flex flex-col items-center gap-0.5 px-1 pb-1.5 pt-1 text-[11px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
        >
          <span className={cn('flex h-8 w-14 items-center justify-center rounded-full', active ? 'bg-slate-100 text-slate-900' : 'text-slate-500')}>
            <NavIconGlyph name={item.icon} className="h-5 w-5" />
          </span>
          <span className={cn('max-w-full truncate', active ? 'text-slate-900' : 'text-slate-500')}>{label}</span>
        </Link>
      </li>
    );
  }

  return (
    <nav
      ref={barRef}
      aria-label="Navegación principal"
      // `pan-y`: a sideways drag is ours (rotate the tabs), vertical scrolling stays the page's.
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(e: ReactTouchEvent) => begin(e.touches[0]?.clientX ?? 0)}
      onTouchEnd={(e: ReactTouchEvent) => finish(e.changedTouches[0]?.clientX ?? 0)}
      onMouseDown={(e: ReactMouseEvent) => begin(e.clientX)}
      onMouseUp={(e: ReactMouseEvent) => finish(e.clientX)}
      // A swipe must not also activate the link it ended on.
      onClickCapture={(e) => {
        if (swiped.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] print:hidden lg:hidden"
    >
      <ul className="relative flex items-end px-1 pt-1">
        {left.map(renderTab)}
        {plus && (
          <li className="relative w-[4.5rem] shrink-0 self-stretch">
            <Link
              href={plus.item.href}
              aria-current={isNavItemActive(plus.item, pathname, allHrefs) ? 'page' : undefined}
              aria-label={plus.label}
              className="absolute left-1/2 top-0 flex -translate-x-1/2 -translate-y-6 flex-col items-center gap-0.5 focus-visible:outline-none"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-4 ring-white focus-visible:outline focus-visible:outline-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" className="h-7 w-7" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
            </Link>
          </li>
        )}
        {right.map(renderTab)}
      </ul>
    </nav>
  );
}
