import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { StartSupportSessionForm } from './start-support-session-form';
import type { SupportSession } from '../../../../../lib/types/platform-tenant';

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock, replace: vi.fn() }),
}));
vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

function session(overrides: Partial<SupportSession> = {}): SupportSession {
  return {
    id: 's1',
    tenantId: 't1',
    mode: 'read',
    reason: 'checking data',
    status: 'active',
    startedAt: '2026-01-01T00:00:00Z',
    expiresAt: '2026-01-01T00:30:00Z',
    ...overrides,
  };
}

describe('StartSupportSessionForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('an existing session for this tenant: offers to resume, no form', () => {
    render(<StartSupportSessionForm tenantId="t1" existingSession={session()} />);
    expect(screen.getByText(/ya tienes una sesión de soporte activa/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /entrar a la empresa/i }));
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('an existing session also offers the curated support panel for the warehouse-toggle action', () => {
    render(<StartSupportSessionForm tenantId="t1" existingSession={session()} />);
    fireEvent.click(screen.getByRole('button', { name: /panel de soporte/i }));
    expect(pushMock).toHaveBeenCalledWith('/platform/tenants/t1/support');
  });

  it('no existing session: starts collapsed behind a trigger button', () => {
    render(<StartSupportSessionForm tenantId="t1" existingSession={null} />);
    expect(screen.queryByText(/motivo/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /acceder como soporte/i }));
    expect(screen.getByText(/motivo/i)).toBeInTheDocument();
  });

  it('read mode is the default; write requires a longer justification but this component always sends whatever reason is typed', async () => {
    mockedFetch.mockResolvedValueOnce(session());
    render(<StartSupportSessionForm tenantId="t1" existingSession={null} />);
    fireEvent.click(screen.getByRole('button', { name: /acceder como soporte/i }));
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'investigating a support ticket' } });
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/support-sessions', {
        method: 'POST',
        body: { mode: 'read', reason: 'investigating a support ticket' },
      }),
    );
    expect(pushMock).toHaveBeenCalledWith('/');
  });

  it('switching to Intervención sends mode: write', async () => {
    mockedFetch.mockResolvedValueOnce(session({ mode: 'write' }));
    render(<StartSupportSessionForm tenantId="t1" existingSession={null} />);
    fireEvent.click(screen.getByRole('button', { name: /acceder como soporte/i }));
    fireEvent.click(screen.getByRole('radio', { name: /intervención/i }));
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'fixing a stuck warehouse status' } });
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));

    await waitFor(() =>
      expect(mockedFetch).toHaveBeenCalledWith(
        '/api/v1/platform/tenants/t1/support-sessions',
        expect.objectContaining({ body: expect.objectContaining({ mode: 'write' }) }),
      ),
    );
  });

  it('cancel collapses the form back without calling the API', () => {
    render(<StartSupportSessionForm tenantId="t1" existingSession={null} />);
    fireEvent.click(screen.getByRole('button', { name: /acceder como soporte/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(screen.queryByText(/motivo/i)).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('shows a safe error on failure and never leaves as if it started', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(400, 'VALIDATION_ERROR', 'reason must be at least 3 characters', undefined));
    render(<StartSupportSessionForm tenantId="t1" existingSession={null} />);
    fireEvent.click(screen.getByRole('button', { name: /acceder como soporte/i }));
    fireEvent.change(screen.getByLabelText(/motivo/i), { target: { value: 'ok' } });
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 3 characters/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
