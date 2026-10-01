import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { AdminInvitationPanel } from './admin-invitation-panel';
import type { AdminInvitationStatus } from '../../../../../lib/types/platform-tenant';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

function invitation(overrides: Partial<AdminInvitationStatus>): AdminInvitationStatus {
  return { id: 'inv1', status: 'sent', expiresAt: '2026-01-08T00:00:00Z', ...overrides };
}

describe('AdminInvitationPanel', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('null invitation: explains the identity was reused, offers no action', () => {
    render(<AdminInvitationPanel tenantId="t1" invitation={null} />);
    expect(screen.getByText(/ya tenía una cuenta activa/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('pending/sent: offers both Reenviar and Revocar', () => {
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'sent', sentAt: '2026-01-01T00:00:00Z' })} />);
    expect(screen.getByRole('button', { name: /reenviar invitación/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /revocar invitación/i })).toBeInTheDocument();
  });

  it('accepted: no actions offered, shows the accepted date', () => {
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'accepted', acceptedAt: '2026-01-02T00:00:00Z' })} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('revoked: offers only Reenviar', () => {
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'revoked', revokedAt: '2026-01-02T00:00:00Z' })} />);
    expect(screen.getByRole('button', { name: /reenviar invitación/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /revocar invitación/i })).not.toBeInTheDocument();
  });

  it('resend: POSTs the resend endpoint, shows the new link once, and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce({ invitationUrl: 'https://app.example/accept-invitation/new-tok', expiresAt: '2026-01-15T00:00:00Z' });
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'sent' })} />);
    fireEvent.click(screen.getByRole('button', { name: /reenviar invitación/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/admin-invitation/resend', { method: 'POST' });
    expect(await screen.findByText(/new-tok/i)).toBeInTheDocument();
  });

  it('revoke: POSTs the revoke endpoint and refreshes', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'pending' })} />);
    fireEvent.click(screen.getByRole('button', { name: /revocar invitación/i }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants/t1/admin-invitation/revoke', { method: 'POST' });
  });

  it('shows a safe error on failure and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'This invitation was already accepted.', undefined));
    render(<AdminInvitationPanel tenantId="t1" invitation={invitation({ status: 'sent' })} />);
    fireEvent.click(screen.getByRole('button', { name: /reenviar invitación/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already accepted/i);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
