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
    case 'categories':
      return (
        <svg {...common}>
          <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 21 9v8.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5Z" />
        </svg>
      );
    case 'attributes':
      return (
        <svg {...common}>
          <path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h12M20 17h0" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="12" r="2" />
          <circle cx="18" cy="17" r="2" />
        </svg>
      );
    case 'warehouse':
      return (
        <svg {...common}>
          <path d="M3 21V9l9-5 9 5v12" />
          <path d="M7 21v-8h10v8" />
          <path d="M7 17h10" />
        </svg>
      );
    case 'map-pin':
      return (
        <svg {...common}>
          <path d="M12 21s7-5.5 7-11a7 7 0 0 0-14 0c0 5.5 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case 'box':
      return (
        <svg {...common}>
          <path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5Z" />
          <path d="M3 8.5 12 13l9-4.5M12 13v7" />
        </svg>
      );
    case 'layers':
      return (
        <svg {...common}>
          <path d="M12 3 3 8l9 5 9-5-9-5Z" />
          <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
        </svg>
      );
    case 'activity':
      return (
        <svg {...common}>
          <path d="M3 12h4l3 8 4-16 3 8h4" />
        </svg>
      );
    case 'transfer':
      return (
        <svg {...common}>
          <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
        </svg>
      );
    case 'cart':
      return (
        <svg {...common}>
          <circle cx="9" cy="20" r="1.3" />
          <circle cx="18" cy="20" r="1.3" />
          <path d="M3 4h2l2.4 11.2a1.5 1.5 0 0 0 1.5 1.2h8.7a1.5 1.5 0 0 0 1.5-1.2L21 8H6" />
        </svg>
      );
    case 'contact':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.6" />
          <circle cx="9" cy="11" r="2" />
          <path d="M5.5 16a3.5 3.5 0 0 1 7 0M15 9h4M15 13h4" />
        </svg>
      );
  }
}
