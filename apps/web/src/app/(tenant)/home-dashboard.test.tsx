import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeAttention, HomeKpiCard, HomeKpiGrid, HomeQuickActions } from './home-dashboard';
import type { HomeTile } from '../../lib/home/dashboard';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function baseTile(overrides: Partial<HomeTile>): HomeTile {
  return {
    key: 'k',
    label: 'Pending orders',
    href: '/sales?status=pending',
    state: 'ready',
    count: 0,
    actionable: true,
    items: [],
    ...overrides,
  };
}

describe('HomeKpiCard', () => {
  it('shows the real count for a ready tile', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', count: 12 })} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sales?status=pending');
  });

  it('renders a real zero, not a dash', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'ready', count: 0 })} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('shows "—" and a note for an unavailable tile — never a fake 0', () => {
    render(<HomeKpiCard tile={baseTile({ state: 'unavailable', count: 0 })} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText(/not available/i)).toBeInTheDocument();
  });

  it('shows the timezone limitation note for a no-timezone tile', () => {
    render(
      <HomeKpiCard
        tile={baseTile({
          key: 'orders-today',
          label: 'Orders confirmed today',
          state: 'no-timezone',
          note: 'Needs the company-settings permission to read the tenant timezone (GAP-TZ-VISIBILITY).',
        })}
      />,
    );
    expect(screen.getByText(/GAP-TZ-VISIBILITY/)).toBeInTheDocument();
  });
});

describe('HomeKpiGrid', () => {
  it('renders one card per tile', () => {
    render(
      <HomeKpiGrid
        tiles={[baseTile({ key: 'a', label: 'A' }), baseTile({ key: 'b', label: 'B' })]}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('shows a friendly empty state when the user can see no tiles', () => {
    render(<HomeKpiGrid tiles={[]} />);
    expect(screen.getByText(/no operational modules/i)).toBeInTheDocument();
  });
});

describe('HomeAttention', () => {
  it('lists only ready, non-zero queues that have preview rows', () => {
    const tiles: HomeTile[] = [
      baseTile({
        key: 'pending-orders',
        label: 'Pending orders',
        state: 'ready',
        count: 2,
        items: [
          { id: 'o1', href: '/sales/o1', primary: 'ORD-1', secondary: 'Acme' },
          { id: 'o2', href: '/sales/o2', primary: 'ORD-2' },
        ],
      }),
      baseTile({ key: 'returns', label: 'Returns to process', state: 'ready', count: 0, items: [] }),
      baseTile({ key: 'transfers', label: 'Transfers', state: 'unavailable', count: 0, items: [] }),
    ];
    render(<HomeAttention tiles={tiles} />);
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText('ORD-2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute(
      'href',
      '/sales?status=pending',
    );
    expect(screen.queryByText('Returns to process')).not.toBeInTheDocument();
  });

  it('shows a calm message when nothing needs attention', () => {
    render(
      <HomeAttention
        tiles={[baseTile({ state: 'ready', count: 0, items: [] })]}
      />,
    );
    expect(screen.getByText(/nothing needs your attention/i)).toBeInTheDocument();
  });

  it('notes when more rows exist than are previewed', () => {
    render(
      <HomeAttention
        tiles={[
          baseTile({
            state: 'ready',
            count: 9,
            items: [{ id: 'o1', href: '/sales/o1', primary: 'ORD-1' }],
          }),
        ]}
      />,
    );
    expect(screen.getByText(/showing 1 of 9/i)).toBeInTheDocument();
  });
});

describe('HomeQuickActions', () => {
  it('renders nothing when there are no permitted actions', () => {
    const { container } = render(<HomeQuickActions actions={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a link per action', () => {
    render(
      <HomeQuickActions
        actions={[
          { label: 'New sale', href: '/sales/new' },
          { label: 'Import catalog', href: '/imports/new' },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: 'New sale' })).toHaveAttribute('href', '/sales/new');
    expect(screen.getByRole('link', { name: 'Import catalog' })).toHaveAttribute(
      'href',
      '/imports/new',
    );
  });
});
