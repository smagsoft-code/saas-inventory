import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from './toast';

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders the message immediately, fully visible', () => {
    render(<Toast message="Transferencia aprobada correctamente." onDismiss={vi.fn()} />);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('Transferencia aprobada correctamente.');
    expect(toast.className).toMatch(/opacity-100/);
  });

  it('fades out after durationMs, then calls onDismiss once the fade finishes', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Listo." onDismiss={onDismiss} durationMs={3000} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole('status').className).toMatch(/opacity-0/);
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('respects a custom durationMs', () => {
    const onDismiss = vi.fn();
    render(<Toast message="Listo." onDismiss={onDismiss} durationMs={500} />);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.getByRole('status').className).toMatch(/opacity-100/);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('status').className).toMatch(/opacity-0/);
  });
});
