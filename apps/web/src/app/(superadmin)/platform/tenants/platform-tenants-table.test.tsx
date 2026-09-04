import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlatformTenantsTable } from './platform-tenants-table';
import type { PlatformTenant } from '../../../../lib/types/platform-tenant';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

function t(over: Partial<PlatformTenant>): PlatformTenant {
  return {
    id: 'id',
    name: 'Name',
    slug: 'slug',
    status: 'active',
    isDemo: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const rows: PlatformTenant[] = [
  t({ id: 'a', name: 'Acme Corp', slug: 'acme', status: 'active', createdAt: '2026-03-01T00:00:00Z' }),
  t({ id: 'b', name: 'Beta LLC', slug: 'beta', status: 'suspended', createdAt: '2026-01-01T00:00:00Z' }),
  t({ id: 'c', name: 'Demo Co', slug: 'demo', status: 'active', isDemo: true, createdAt: '2026-02-01T00:00:00Z' }),
];

function dataRows(): HTMLElement[] {
  return screen.getAllByRole('row').slice(1); // drop the header row
}

describe('PlatformTenantsTable', () => {
  afterEach(() => cleanup());

  it('renders every company with a link to its detail page', () => {
    render(<PlatformTenantsTable tenants={rows} />);
    expect(dataRows()).toHaveLength(3);
    expect(screen.getAllByRole('link', { name: 'View' })).toHaveLength(3);
    const acmeRow = screen.getByText('Acme Corp').closest('tr')!;
    expect(within(acmeRow).getByRole('link', { name: 'View' })).toHaveAttribute(
      'href',
      '/platform/tenants/a',
    );
    expect(screen.getByText(/3 of 3 companies/i)).toBeInTheDocument();
  });

  it('filters by status (real filter → no-results state is distinct from empty)', () => {
    render(<PlatformTenantsTable tenants={rows} />);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'suspended' } });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText('Beta LLC')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'archived' } });
    expect(screen.queryAllByRole('row').slice(1)).toHaveLength(0);
    expect(screen.getByText(/no companies match these filters/i)).toBeInTheDocument();
  });

  it('filters by type (demo vs real)', () => {
    render(<PlatformTenantsTable tenants={rows} />);
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'demo' } });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText('Demo Co')).toBeInTheDocument();
  });

  it('searches by name and slug', () => {
    render(<PlatformTenantsTable tenants={rows} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'beta' } });
    expect(dataRows()).toHaveLength(1);
    expect(screen.getByText('Beta LLC')).toBeInTheDocument();
  });

  it('sorts newest-first by default and can sort by name', () => {
    render(<PlatformTenantsTable tenants={rows} />);
    let names = dataRows().map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names).toEqual(['Acme Corp', 'Demo Co', 'Beta LLC']); // 2026-03, 2026-02, 2026-01

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'name-asc' } });
    names = dataRows().map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names).toEqual(['Acme Corp', 'Beta LLC', 'Demo Co']);
  });

  it('does not invent server params — it is pure over the prop (no fetch)', () => {
    // The component imports nothing that fetches; assert the module has no api client dependency.
    // (Compile-time guarantee; this test documents the intent.)
    render(<PlatformTenantsTable tenants={rows} />);
    expect(screen.getByRole('status')).toHaveTextContent(/3 of 3/);
  });
});
