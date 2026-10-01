import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersFilters } from './users-filters';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

describe('UsersFilters', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('does not navigate on mount even with an existing q', () => {
    render(<UsersFilters initial={{ q: 'juan' }} />);
    vi.advanceTimersByTime(1000);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('searches live as the owner types — debounced, not on every keystroke', () => {
    render(<UsersFilters initial={{}} />);
    const input = screen.getByLabelText('Buscar usuarios por nombre');
    fireEvent.change(input, { target: { value: 'j' } });
    fireEvent.change(input, { target: { value: 'ju' } });
    fireEvent.change(input, { target: { value: 'juan' } });
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(349);
    expect(pushMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith('/users?q=juan');
  });

  it('finds a partial match regardless of case — the request just carries whatever was typed, the server matches it', () => {
    render(<UsersFilters initial={{}} />);
    fireEvent.change(screen.getByLabelText('Buscar usuarios por nombre'), { target: { value: 'JuAn' } });
    vi.advanceTimersByTime(400);
    expect(pushMock).toHaveBeenCalledWith('/users?q=JuAn');
  });

  it('trims the search box and omits q entirely when it is blank', () => {
    render(<UsersFilters initial={{}} />);
    fireEvent.change(screen.getByLabelText('Buscar usuarios por nombre'), { target: { value: '   ' } });
    vi.advanceTimersByTime(400);
    expect(pushMock).toHaveBeenCalledWith('/users');
  });

  it('clearing an existing search navigates back to the unfiltered list', () => {
    render(<UsersFilters initial={{ q: 'juan' }} />);
    fireEvent.change(screen.getByLabelText('Buscar usuarios por nombre'), { target: { value: '' } });
    vi.advanceTimersByTime(400);
    expect(pushMock).toHaveBeenCalledWith('/users');
  });
});
