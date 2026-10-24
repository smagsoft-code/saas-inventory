import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useIsMobile } from './use-is-mobile';

function Probe(): React.JSX.Element {
  return <p>{useIsMobile() ? 'movil' : 'escritorio'}</p>;
}

function stubMatchMedia(initial: boolean): { setMatches: (value: boolean) => void } {
  let matches = initial;
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    get matches() {
      return matches;
    },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
  return {
    setMatches: (value) => {
      matches = value;
      listeners.forEach((listener) => listener());
    },
  };
}

describe('useIsMobile', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is desktop when matchMedia is unavailable (tests, old browsers, server)', () => {
    vi.stubGlobal('matchMedia', undefined);
    render(<Probe />);
    expect(screen.getByText('escritorio')).toBeInTheDocument();
  });

  it('follows the (max-width: 767px) query, live', () => {
    const media = stubMatchMedia(true);
    render(<Probe />);
    expect(screen.getByText('movil')).toBeInTheDocument();
    act(() => media.setMatches(false));
    expect(screen.getByText('escritorio')).toBeInTheDocument();
  });
});
