import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreatedToast } from './created-toast';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/inventory/transfers/t-1',
}));

describe('CreatedToast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    replaceMock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when show is false', () => {
    const { container } = render(<CreatedToast show={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the toast, and on dismiss strips the query param via router.replace(pathname)', () => {
    render(<CreatedToast show />);
    expect(screen.getByRole('status')).toHaveTextContent('Transferencia creada correctamente.');
    expect(replaceMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(replaceMock).toHaveBeenCalledWith('/inventory/transfers/t-1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
