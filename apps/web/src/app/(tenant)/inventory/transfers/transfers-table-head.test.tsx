import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Table } from '../../../../components/ui/table';
import { TransfersMobileFilters, TransfersTableHead } from './transfers-table-head';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const statusOptions = [{ value: 'draft', label: 'Borrador' }, { value: 'dispatched', label: 'Despachada' }];
const locationOptions = [{ value: 'l1', label: 'Centro' }, { value: 'l2', label: 'Norte' }];

describe('transfers filters', () => {
  beforeEach(() => push.mockClear());

  it('applies a column filter at once, keeping the others and dropping the page', () => {
    render(
      <Table>
        <TransfersTableHead params={{ status: 'draft', page: '3', all: '1' }} statusOptions={statusOptions} locationOptions={locationOptions} />
      </Table>,
    );
    fireEvent.change(screen.getByLabelText('Filtrar por origen'), { target: { value: 'l1' } });
    expect(push).toHaveBeenCalledWith('/inventory/transfers?status=draft&all=1&sourceLocationId=l1', { scroll: false });
  });

  it('clears a filter when "Todos" is chosen', () => {
    render(
      <Table>
        <TransfersTableHead params={{ status: 'draft' }} statusOptions={statusOptions} locationOptions={locationOptions} />
      </Table>,
    );
    fireEvent.change(screen.getByLabelText('Filtrar por estado'), { target: { value: '' } });
    expect(push).toHaveBeenCalledWith('/inventory/transfers', { scroll: false });
  });

  it('offers the same filters on the phone layout', () => {
    render(<TransfersMobileFilters params={{}} statusOptions={statusOptions} locationOptions={locationOptions} />);
    fireEvent.change(screen.getByLabelText('Filtrar por almacén de destino'), { target: { value: 'l2' } });
    expect(push).toHaveBeenCalledWith('/inventory/transfers?destinationLocationId=l2', { scroll: false });
  });
});
