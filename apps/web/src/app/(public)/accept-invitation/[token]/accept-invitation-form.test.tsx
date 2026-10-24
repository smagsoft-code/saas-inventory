import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { AcceptInvitationForm } from './accept-invitation-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: vi.fn() }),
}));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

describe('AcceptInvitationForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('shows the tenant name and email, but never lets the visitor edit them', () => {
    render(<AcceptInvitationForm token="tok123" tenantName="Acme" email="jane@acme.test" />);
    expect(screen.getByText(/acme/i)).toBeInTheDocument();
    expect(screen.getByText(/jane@acme.test/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/correo/i)).not.toBeInTheDocument();
  });

  it('POSTs exactly { token, password } to accept-invitation and redirects to /', async () => {
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<AcceptInvitationForm token="tok123" tenantName="Acme" email="jane@acme.test" />);
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/auth/accept-invitation', {
      method: 'POST',
      body: { token: 'tok123', password: 'a-long-password' },
    });
  });

  it('shows a safe error and does not redirect on failure', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'This invitation has expired.', undefined));
    render(<AcceptInvitationForm token="tok123" tenantName="Acme" email="jane@acme.test" />);
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La invitación no es válida o ya venció');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('never echoes a 5xx body', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'stack trace at Object.<anonymous>', undefined));
    render(<AcceptInvitationForm token="tok123" tenantName="Acme" email="jane@acme.test" />);
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /activar cuenta/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/stack trace/i);
  });
});
