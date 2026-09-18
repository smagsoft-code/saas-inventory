import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImportsFilters } from './imports-filters';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const initial = {
  from: '2026-08-01T00:00:00.000Z',
  to: '2026-08-31T00:00:00.000Z',
  groupBy: 'day' as const,
  status: '',
};

describe('ImportsFilters', () => {
  beforeEach(() => pushMock.mockClear());
  afterEach(() => cleanup());

  it('hides the panel until "Filtros" is pressed', () => {
    render(<ImportsFilters initial={initial} />);
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toBeInTheDocument();
    expect(screen.getByLabelText('Agrupar por')).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
  });

  it('closes the panel on an outside click', () => {
    render(
      <div>
        <ImportsFilters initial={initial} />
        <button type="button">Fuera</button>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Fuera' }));
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  });

  it('renders the initial from/to/groupBy/status values', () => {
    render(<ImportsFilters initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('Hasta')).toHaveValue('2026-08-31');
    expect(screen.getByLabelText('Agrupar por')).toHaveValue('day');
    expect(screen.getByLabelText('Estado')).toHaveValue('');
  });

  it('navigates with reportGroupBy on a groupBy change, preserving the dates, anchored at #report', () => {
    render(<ImportsFilters initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    fireEvent.change(screen.getByLabelText('Agrupar por'), { target: { value: 'status' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url.startsWith('/imports?')).toBe(true);
    expect(url).toContain('reportGroupBy=status');
    expect(url).toContain('reportFrom=2026-08-01T00%3A00%3A00.000Z');
    expect(url.endsWith('#report')).toBe(true);
  });

  it('picking Estado sets BOTH reportStatus (report) and status (historial) — one control, two params', () => {
    render(<ImportsFilters initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'completed_with_errors' } });
    let url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain('reportStatus=completed_with_errors');
    expect(url).toContain('status=completed_with_errors');

    pushMock.mockClear();
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: '' } });
    url = pushMock.mock.calls[0]![0] as string;
    expect(url).not.toContain('reportStatus');
    expect(url).not.toMatch(/[?&]status=/);
  });

  it('sends `to` as the start of the NEXT day so the picked end date is fully included ([from, to))', () => {
    render(<ImportsFilters initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtros$/ }));
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-09-05' } });
    const url = pushMock.mock.calls[0]![0] as string;
    expect(url).toContain(`reportTo=${encodeURIComponent('2026-09-06T00:00:00.000Z')}`);
  });

  it('shows "Filtros (activos)" once a non-default filter is set', () => {
    render(<ImportsFilters initial={{ ...initial, status: 'failed' }} />);
    expect(screen.getByRole('button', { name: 'Filtros (activos)' })).toBeInTheDocument();
  });

  it('"Quitar filtros" resets to the plain /imports#report URL', () => {
    render(<ImportsFilters initial={{ ...initial, status: 'failed' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filtros/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(pushMock).toHaveBeenCalledWith('/imports#report');
  });
});
