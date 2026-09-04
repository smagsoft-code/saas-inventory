import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InventoryReportFilters } from './inventory-report-filters';
import type { Warehouse } from '../../../lib/types/inventory';
import type { Category } from '../../../lib/types/catalog';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const warehouses: Warehouse[] = [
  { id: 'wh-1', name: 'Main Warehouse', code: 'MAIN', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
];
const categories: Category[] = [{ id: 'cat-1', name: 'Appliances', slug: 'appliances', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }];

const initial = { groupBy: 'warehouse' as const };

describe('InventoryReportFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
  });

  it('renders the initial groupBy value and the passed-in warehouse/category options', () => {
    render(<InventoryReportFilters initial={initial} warehouses={warehouses} categories={categories} />);
    expect(screen.getByLabelText('Group by')).toHaveValue('warehouse');
    expect(screen.getByText('Main Warehouse')).toBeInTheDocument();
    expect(screen.getByText('Appliances')).toBeInTheDocument();
  });

  it('navigates with reportGroupBy on a groupBy change', () => {
    render(<InventoryReportFilters initial={initial} warehouses={warehouses} categories={categories} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'category' } });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('reportGroupBy=category'));
  });

  it('navigates with reportWarehouseId on a warehouse selection', () => {
    render(<InventoryReportFilters initial={initial} warehouses={warehouses} categories={categories} />);
    fireEvent.change(screen.getByLabelText('Warehouse'), { target: { value: 'wh-1' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportWarehouseId=wh-1');
  });

  it('navigates with reportCategoryId on a category selection', () => {
    render(<InventoryReportFilters initial={initial} warehouses={warehouses} categories={categories} />);
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cat-1' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportCategoryId=cat-1');
  });

  it('navigates to /inventory with a #report anchor, never off the inventory page', () => {
    render(<InventoryReportFilters initial={initial} warehouses={warehouses} categories={categories} />);
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'category' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/inventory?')).toBe(true);
    expect(url.endsWith('#report')).toBe(true);
  });
});
