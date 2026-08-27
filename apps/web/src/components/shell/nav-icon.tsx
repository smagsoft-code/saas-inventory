import type { NavIcon } from '../../lib/navigation';

/** Inline, dependency-free icons for the navigation registry's `icon` keys. Purely decorative —
 * every nav item also has a text label (Prompt 016 §29). */
export function NavIconGlyph({
  name,
  className,
}: {
  name: NavIcon;
  className?: string;
}): React.JSX.Element {
  const common = {
    className: className ?? 'h-5 w-5',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <path d="M16 5.5a3 3 0 0 1 0 6M17.5 20a5 5 0 0 0-3-4.6" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 12a7.4 7.4 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7.3 7.3 0 0 0-1.7-1l-.3-2.5H10l-.3 2.5a7.3 7.3 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7.4 7.4 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7.3 7.3 0 0 0 1.7 1l.3 2.5h4l.3-2.5a7.3 7.3 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" />
        </svg>
      );
  }
}
