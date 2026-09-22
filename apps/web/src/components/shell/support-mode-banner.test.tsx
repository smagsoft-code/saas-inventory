import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../../lib/api/client';
import type { SupportSession } from '../../lib/types/platform-tenant';
import { SupportModeBanner } from './support-mode-banner';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
}));
vi.mock('../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1',
    tenantId: 't1',
    mode: 'read',
    reason: 'checking data',
    status: 'active',
    startedAt: '2026-01-01T00:00:00Z',
    expiresAt: new Date(Date.now() + 20 * 60000).toISOString(),
    ...overrides,
  };
}

describe('SupportModeBanner', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('always identifies "MODO SOPORTE" prominently, not a tooltip', () => {
    render(<SupportModeBanner session={session()} />);
    expect(screen.getByText('MODO SOPORTE')).toBeInTheDocument();
  });

  it('shows "Solo lectura" for a read session and "Intervención" for a write session', () => {
    const { rerender } = render(<SupportModeBanner session={session({ mode: 'read' })} />);
    expect(screen.getByText(/solo lectura/i)).toBeInTheDocument();
    rerender(<SupportModeBanner session={session({ mode: 'write' })} />);
    expect(screen.getByText(/intervención/i)).toBeInTheDocument();
  });

  it('exiting: POSTs the end endpoint and redirects to the tenant list', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<SupportModeBanner session={session()} />);
    fireEvent.click(screen.getByRole('button', { name: /salir del modo soporte/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/platform/tenants'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/support-sessions/current/end', { method: 'POST' });
  });

  it('never calls router.refresh() after exiting — this banner can render inside the still-mounted tenant shell, and a trailing refresh raced the stale (tenant) layout into firing a competing redirect (see the fix comment in support-mode-banner.tsx)', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<SupportModeBanner session={session()} />);
    fireEvent.click(screen.getByRole('button', { name: /salir del modo soporte/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/platform/tenants'));
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('shows a safe error on failure and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    render(<SupportModeBanner session={session()} />);
    fireEvent.click(screen.getByRole('button', { name: /salir del modo soporte/i }));

    await waitFor(() => expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
