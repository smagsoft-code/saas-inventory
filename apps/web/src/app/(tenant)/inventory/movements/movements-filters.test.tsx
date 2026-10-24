import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MovementsFilters } from './movements-filters';

const pushMock = vi.fn();
let currentSearch = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/inventory/movements',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

const LOCATIONS = [
  { id: 'loc-1', label: 'Sucursal Centro — Almacén Principal' },
  { id: 'loc-2', label: 'Sucursal Centro — General' },
  { id: 'loc-3', label: 'Sucursal Norte — General' },
];

describe('MovementsFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
    currentSearch = '';
  });

  it('renders the initial from/to/location/type values', () => {
    render(
      <MovementsFilters
        initial={{
          occurredFrom: '2026-06-01T00:00:00.000Z',
          occurredTo: '2026-06-15T00:00:00.000Z',
          locationId: 'loc-2',
          movementType: 'RECEIPT',
        }}
        locations={LOCATIONS}
      />,
    );
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-06-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-06-15');
    expect(screen.getByLabelText('Almacén')).toHaveValue('loc-2');
    expect(screen.getByLabelText('Tipo')).toHaveValue('RECEIPT');
  });

  it('lists every location warehouse-prefixed, disambiguating same-named locations across warehouses', () => {
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    expect(screen.getByRole('option', { name: 'Sucursal Centro — General' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sucursal Norte — General' })).toBeInTheDocument();
  });

  it('sends occurredFrom as the picked date at 00:00:00.000Z', () => {
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-07-01' } });
    expect(pushMock).toHaveBeenCalledWith(
      '/inventory/movements?occurredFrom=2026-07-01T00%3A00%3A00.000Z',
      { scroll: false },
    );
  });

  it('sends occurredTo as the START of the NEXT day, so the picked end date is fully included ([occurredFrom, occurredTo))', () => {
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-07-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(encodeURIComponent('2026-07-06T00:00:00.000Z'));
  });

  it('applies the Almacén filter by locationId and resets page', () => {
    currentSearch = 'page=3';
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: 'loc-1' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('locationId=loc-1');
    expect(url).not.toContain('page=3');
  });

  it('applies the Tipo filter by movementType', () => {
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'SALE' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('movementType=SALE');
  });

  it('carries other existing filters (e.g. productVariantId) forward, never dropping them', () => {
    currentSearch = 'productVariantId=v1';
    render(<MovementsFilters initial={{}} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-07-01' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('productVariantId=v1');
  });

  it('clears occurredFrom from the URL when the field is cleared', () => {
    currentSearch = 'occurredFrom=2026-06-01T00%3A00%3A00.000Z';
    render(
      <MovementsFilters
        initial={{ occurredFrom: '2026-06-01T00:00:00.000Z' }}
        locations={LOCATIONS}
      />,
    );
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('occurredFrom');
  });

  it('clears locationId from the URL when "Todos los almacenes" is picked', () => {
    currentSearch = 'locationId=loc-1';
    render(<MovementsFilters initial={{ locationId: 'loc-1' }} locations={LOCATIONS} />);
    fireEvent.change(screen.getByLabelText('Almacén'), { target: { value: '' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('locationId');
  });

  it('phone: the filter icon toggles the panel and shows how many filters are active', () => {
    render(
      <MovementsFilters
        initial={{ locationId: 'loc-2', movementType: 'RECEIPT' }}
        locations={LOCATIONS}
      />,
    );
    expect(screen.getByLabelText('2 filtros activos')).toBeTruthy();
    const toggle = screen.getByRole('button', { name: /mostrar filtros/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: /ocultar filtros/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
