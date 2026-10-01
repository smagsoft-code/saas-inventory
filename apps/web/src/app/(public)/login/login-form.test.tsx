import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { LoginForm } from './login-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);

const SESSION_USER = {
  id: 'u1',
  identityId: 'i1',
  tenantId: 't1',
  tenantSlug: 'acme',
  email: 'admin@acme.com',
  fullName: 'Admin',
  status: 'active',
  permissions: [] as string[],
  timezone: 'UTC',
};

async function renderForm(): Promise<void> {
  render(<LoginForm />);
  // The silent-restore attempt on mount resolves first; wait for the form to appear.
  await screen.findByRole('button', { name: /iniciar sesión/i });
}

function typeCredentials(): void {
  fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: 'admin@acme.com' } });
  fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'a-long-password' } });
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    searchParams = new URLSearchParams();
    // Default: the silent session-restore refresh (and anything else not overridden) fails.
    mockedFetch.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'no session', undefined));
  });

  it('shows an email + password form only — no workspace/tenant field', async () => {
    await renderForm();
    const form = screen.getByRole('button', { name: /iniciar sesión/i }).closest('form')!;
    expect(screen.getByLabelText(/correo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/contraseña/i)).toBeInTheDocument();
    expect(within(form).queryByText(/workspace/i)).not.toBeInTheDocument();
    expect(within(form).queryByText(/empresa|organi[sz]ation/i)).not.toBeInTheDocument();
    expect(within(form).queryByRole('textbox', { name: /company|workspace|empresa/i })).not.toBeInTheDocument();
  });

  it('shows no "crear empresa" / register CTA — tenant creation is invitation-only now', async () => {
    await renderForm();
    expect(screen.queryByRole('link', { name: /crea tu empresa|crear empresa|crear cuenta|registrarse/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/¿aún no tienes cuenta\?/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('accepts a non-email identifier in the credential field (backend now allows a 10+ char username, not just an email)', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'authenticated',
      user: SESSION_USER,
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });

    fireEvent.change(screen.getByLabelText(/correo/i), { target: { value: 'vendedor01' } });
    fireEvent.change(screen.getByLabelText(/contraseña/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'vendedor01', password: 'a-long-password' },
    });
  });

  it('submits only { email, password } and redirects on a single-tenant login', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'authenticated',
      user: SESSION_USER,
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });

    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'admin@acme.com', password: 'a-long-password' },
    });
    // The body has no tenantSlug (or any third field).
    const [, options] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((options as { body: object }).body)).toEqual(['email', 'password']);
  });

  it('shows the company picker when the identity has more than one membership', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'tenant_selection_required',
      availableTenants: [
        { tenantId: 't1', name: 'Acme Corp' },
        { tenantId: 't2', name: 'Beta Inc' },
      ],
      selectionTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });

    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Inc')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
    // Still no session; the picker is not shown before credentials succeed.
    expect(screen.queryByLabelText(/contraseña/i)).not.toBeInTheDocument();
  });

  it('calls POST /auth/select-tenant with only the chosen tenantId, then redirects', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'tenant_selection_required',
      availableTenants: [
        { tenantId: 't1', name: 'Acme Corp' },
        { tenantId: 't2', name: 'Beta Inc' },
      ],
      selectionTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await screen.findByText('Beta Inc');

    mockedFetch.mockResolvedValueOnce({ user: SESSION_USER, accessTokenExpiresAt: 'x' });
    fireEvent.click(screen.getByRole('button', { name: /beta inc/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/auth/select-tenant', {
      method: 'POST',
      body: { tenantId: 't2' },
    });
  });

  it('does not fire a second login request on a double submit', async () => {
    await renderForm();
    let resolveLogin: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLogin = resolve; }),
    );

    typeCredentials();
    const button = screen.getByRole('button', { name: /iniciar sesión/i });
    fireEvent.click(button);
    fireEvent.click(button);

    const loginCalls = mockedFetch.mock.calls.filter(([path]) => path === '/api/v1/auth/login');
    expect(loginCalls).toHaveLength(1);
    resolveLogin({ status: 'authenticated', user: SESSION_USER, accessTokenExpiresAt: 'x' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });

  it('shows one generic, safe error on a failed login and does not redirect', async () => {
    await renderForm();
    mockedFetch.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password.', undefined),
    );

    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('never echoes a 5xx body as the login error', async () => {
    await renderForm();
    mockedFetch.mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL', 'stack trace: at Object.<anonymous>', undefined),
    );

    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/stack trace/i);
    expect(alert).toHaveTextContent(/algo salió mal/i);
  });

  it('lets the user return to sign in after an expired tenant selection', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'tenant_selection_required',
      availableTenants: [{ tenantId: 't1', name: 'Acme Corp' }],
      selectionTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await screen.findByText('Acme Corp');

    mockedFetch.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired selection.', undefined),
    );
    fireEvent.click(screen.getByRole('button', { name: /acme corp/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/inicia sesión de nuevo/i);
    fireEvent.click(screen.getByRole('button', { name: /volver a iniciar sesión/i }));
    expect(await screen.findByRole('button', { name: /^iniciar sesión$/i })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('keeps no selection token or access token in web storage', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'tenant_selection_required',
      availableTenants: [{ tenantId: 't1', name: 'Acme Corp' }],
      selectionTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    });
    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await screen.findByText('Acme Corp');

    mockedFetch.mockResolvedValueOnce({ user: SESSION_USER, accessTokenExpiresAt: 'x' });
    fireEvent.click(screen.getByRole('button', { name: /acme corp/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());

    const dump = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(dump.toLowerCase()).not.toMatch(/token|selection|bearer|jwt/);
  });

  it('redirects to a valid returnTo without showing the form when the session is restored', async () => {
    searchParams = new URLSearchParams('returnTo=/users');
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<LoginForm />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/users'));
    expect(screen.queryByRole('button', { name: /iniciar sesión/i })).not.toBeInTheDocument();
  });

  it('ignores an off-site returnTo and falls back to /', async () => {
    searchParams = new URLSearchParams('returnTo=https://evil.example/phish');
    await renderForm();
    mockedFetch.mockResolvedValueOnce({
      status: 'authenticated',
      user: SESSION_USER,
      accessTokenExpiresAt: 'x',
    });
    typeCredentials();
    fireEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
  });
});
