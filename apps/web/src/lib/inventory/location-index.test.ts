import { describe, expect, it, vi, beforeEach } from 'vitest';
import { listLocations } from './locations';
import { listWarehouses } from './warehouses';
import { buildLocationIndex, shortId } from './location-index';

vi.mock('./locations', () => ({ listLocations: vi.fn() }));
vi.mock('./warehouses', () => ({ listWarehouses: vi.fn() }));
const mockedLocations = vi.mocked(listLocations);
const mockedWarehouses = vi.mocked(listWarehouses);

const page = <T,>(data: T[]) => ({ data, meta: { page: 1, pageSize: 100, total: data.length, totalPages: 1 } });

describe('buildLocationIndex', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves location and warehouse names', async () => {
    mockedLocations.mockResolvedValueOnce(
      page([{ id: 'l1', warehouseId: 'w1', name: 'Aisle A', code: 'A', isSellable: true, status: 'active', createdAt: '' }]),
    );
    mockedWarehouses.mockResolvedValueOnce(page([{ id: 'w1', name: 'Central', code: 'C', status: 'active', createdAt: '' }]));

    const index = await buildLocationIndex(true);
    expect(index.locationName('l1')).toBe('Aisle A');
    expect(index.warehouseName('l1')).toBe('Central');
  });

  it('does not fetch warehouses without the permission, and falls back to a short id', async () => {
    mockedLocations.mockResolvedValueOnce(page([]));
    const index = await buildLocationIndex(false);
    expect(mockedWarehouses).not.toHaveBeenCalled();
    expect(index.locationName('0123456789abcdef')).toBe('01234567…');
    expect(index.warehouseName('missing')).toBe('—');
  });
});

describe('shortId', () => {
  it('truncates long ids and leaves short ones', () => {
    expect(shortId('abcdefghij')).toBe('abcdefgh…');
    expect(shortId('abc')).toBe('abc');
  });
});
