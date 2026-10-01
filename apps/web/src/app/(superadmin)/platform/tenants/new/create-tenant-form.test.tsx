import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../lib/api/errors';
import { apiFetch } from '../../../../../lib/api/client';
import { CreateTenantForm } from './create-tenant-form';

vi.mock('../../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

function fillForm(): void {
  fireEvent.change(screen.getByLabelText(/nombre de la empresa/i), { target: { value: 'Acme' } });
  fireEvent.change(screen.getByLabelText(/nombre del administrador/i), { target: { value: 'Jane Doe' } });
  fireEvent.change(screen.getByLabelText(/correo del administrador/i), { target: { value: 'jane@acme.test' } });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: /crear empresa/i }));
}

describe('CreateTenantForm', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('has no password field — ADR-0036 §1', () => {
    render(<CreateTenantForm />);
    expect(screen.queryByLabelText(/contraseñ/i)).not.toBeInTheDocument();
  });

  it('POSTs exactly companyName/adminFullName/adminEmail, never a password', async () => {
    mockedFetch.mockResolvedValueOnce({
      tenant: { id: 't1', name: 'Acme', slug: 'acme', status: 'active', isDemo: false, createdAt: '2026-01-01T00:00:00Z' },
      admin: { id: 'u1', email: 'jane@acme.test', fullName: 'Jane Doe' },
      identityReused: false,
      invitationUrl: 'https://app.example/accept-invitation/tok123',
      invitationExpiresAt: '2026-01-08T00:00:00Z',
    });
    render(<CreateTenantForm />);
    fillForm();
    submit();

    await screen.findByText(/copia este enlace/i);
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/platform/tenants', {
      method: 'POST',
      body: { companyName: 'Acme', adminFullName: 'Jane Doe', adminEmail: 'jane@acme.test' },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/password/i);
  });

  it('shows the invitation link exactly once on success, with a copy button', async () => {
    mockedFetch.mockResolvedValueOnce({
      tenant: { id: 't1', name: 'Acme', slug: 'acme', status: 'active', isDemo: false, createdAt: '2026-01-01T00:00:00Z' },
      admin: { id: 'u1', email: 'jane@acme.test', fullName: 'Jane Doe' },
      identityReused: false,
      invitationUrl: 'https://app.example/accept-invitation/tok123',
      invitationExpiresAt: '2026-01-08T00:00:00Z',
    });
    render(<CreateTenantForm />);
    fillForm();
    submit();

    expect(await screen.findByDisplayValue('https://app.example/accept-invitation/tok123')).toBeInTheDocument();
  });

  it('identityReused: explains no invitation was needed and shows no link', async () => {
    mockedFetch.mockResolvedValueOnce({
      tenant: { id: 't1', name: 'Acme', slug: 'acme', status: 'active', isDemo: false, createdAt: '2026-01-01T00:00:00Z' },
      admin: { id: 'u1', email: 'jane@acme.test', fullName: 'Jane Doe' },
      identityReused: true,
    });
    render(<CreateTenantForm />);
    fillForm();
    submit();

    expect(await screen.findByText(/ya tenía una cuenta activa/i)).toBeInTheDocument();
    expect(screen.queryByText(/copia este enlace/i)).not.toBeInTheDocument();
  });

  it('copies the invitation link to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mockedFetch.mockResolvedValueOnce({
      tenant: { id: 't1', name: 'Acme', slug: 'acme', status: 'active', isDemo: false, createdAt: '2026-01-01T00:00:00Z' },
      admin: { id: 'u1', email: 'jane@acme.test', fullName: 'Jane Doe' },
      identityReused: false,
      invitationUrl: 'https://app.example/accept-invitation/tok123',
      invitationExpiresAt: '2026-01-08T00:00:00Z',
    });
    render(<CreateTenantForm />);
    fillForm();
    submit();

    const copyButton = await screen.findByRole('button', { name: /copiar/i });
    fireEvent.click(copyButton);
    expect(writeText).toHaveBeenCalledWith('https://app.example/accept-invitation/tok123');
    expect(await screen.findByRole('button', { name: /copiado/i })).toBeInTheDocument();
  });

  it('shows a safe error and stays on the form on failure', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(409, 'CONFLICT', 'The admin email belongs to a disabled identity.', undefined));
    render(<CreateTenantForm />);
    fillForm();
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(/disabled identity/i);
    expect(screen.getByLabelText(/nombre de la empresa/i)).toBeInTheDocument();
  });

  it('never echoes a 5xx body', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'stack trace at Object.<anonymous>', undefined));
    render(<CreateTenantForm />);
    fillForm();
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/stack trace/i);
  });
});
