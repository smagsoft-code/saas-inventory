import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InventoryReportError, InventoryReportSection } from './inventory-report-section';
import type { InventorySummary } from '../../../lib/types/inventory-reports';

function baseSummary(overrides: Partial<InventorySummary> = {}): InventorySummary {
  return {
    generatedAt: '2026-09-01T00:00:00.000Z',
    groupBy: 'warehouse',
    totals: { availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 0 },
    buckets: [],
    ...overrides,
  };
}

describe('InventoryReportSection', () => {
  it('always shows the totals KPI tiles, even with zero buckets', () => {
    render(<InventoryReportSection summary={baseSummary({ totals: { availableQuantity: 5, reservedQuantity: 1, outOfStockCount: 0 } })} />);
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Reserved')).toBeInTheDocument();
    expect(screen.getByText('Out of stock (SKUs)')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows an empty state when there are no buckets — never a fake zero row', () => {
    render(<InventoryReportSection summary={baseSummary()} />);
    expect(screen.getByText('No stock recorded yet')).toBeInTheDocument();
  });

  it('renders warehouse buckets with the warehouse name, quantities, and an "out" badge at zero available', () => {
    const summary = baseSummary({
      groupBy: 'warehouse',
      buckets: [
        { key: 'wh-1', warehouseName: 'Main Warehouse', availableQuantity: 120, reservedQuantity: 20, outOfStockCount: 3 },
        { key: 'wh-2', warehouseName: 'Secondary', availableQuantity: 0, reservedQuantity: 0, outOfStockCount: 1 },
      ],
    });
    render(<InventoryReportSection summary={summary} />);
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Secondary')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('out')).toBeInTheDocument();
    expect(screen.getByText('Warehouse')).toBeInTheDocument(); // column header
  });

  it('renders category buckets with the category name, including the "Uncategorized" bucket', () => {
    const summary = baseSummary({
      groupBy: 'category',
      buckets: [
        { key: 'cat-1', categoryName: 'Appliances', availableQuantity: 50, reservedQuantity: 5, outOfStockCount: 0 },
        { key: 'uncategorized', categoryName: 'Uncategorized', availableQuantity: 3, reservedQuantity: 0, outOfStockCount: 0 },
      ],
    });
    render(<InventoryReportSection summary={summary} />);
    expect(screen.getByText('Appliances')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument(); // column header
  });
});

describe('InventoryReportError', () => {
  it('shows an access-denied title for a 403 — never a redirect to login', () => {
    render(<InventoryReportError status={403} message="You don't have permission to do that." />);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });

  it('shows a friendly title and the correlation id for a 5xx', () => {
    render(<InventoryReportError status={500} message="Something went wrong on our end. Please try again." correlationId="corr-456" />);
    expect(screen.getByText('Something went wrong on our end')).toBeInTheDocument();
    expect(screen.getByText(/corr-456/)).toBeInTheDocument();
  });

  it('offers a retry link back to #report', () => {
    render(<InventoryReportError status={0} message="Could not reach the server." />);
    const retry = screen.getByRole('link', { name: 'Try again' });
    expect(retry).toHaveAttribute('href', '#report');
  });
});
