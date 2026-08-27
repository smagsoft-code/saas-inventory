'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, type NavSection } from '../../lib/navigation';
import { cn } from '../../lib/cn';
import { NavIconGlyph } from './nav-icon';

/**
 * The navigation list, shared by the desktop sidebar and the mobile drawer. `sections` is already
 * permission-filtered by the server layout — this component only decides the active item from the
 * current pathname (Prompt 016 §40) and closes the mobile drawer on navigation.
 */
export function SidebarNav({
  sections,
  onNavigate = () => {},
}: {
  sections: NavSection[];
  onNavigate?: () => void;
}): React.JSX.Element {
  const pathname = usePathname();

  return (
    <nav aria-label="Primary" className="flex flex-col gap-6">
      {sections.map((section, index) => (
        <div key={section.title ?? `section-${index}`} className="flex flex-col gap-1">
          {section.title && (
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title}
            </p>
          )}
          {section.items.map((item) => {
            const active = isNavItemActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900',
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                )}
              >
                <NavIconGlyph name={item.icon} className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
