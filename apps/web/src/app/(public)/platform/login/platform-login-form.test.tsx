import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { PlatformLoginForm } from './platform-login-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: vi.fn() }),
  useSearchParams: () => searchParams,
}));

vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const OK = { admin: { id: 'a', email: 'root@platform.example', fullName: 'Root', status: 'active' }, accessTokenExpiresAt: 'x' };

function typeCredentials(): void {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'root@platform.example' } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-password' } });
}

function submit(): void {
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
}

describe('PlatformLoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
  });
  afterEach(() => cleanup());

  it('renders an email + password form only — no workspace/tenant field', () => {
    render(<PlatformLoginForm />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.queryByText(/workspace|empresa|company|tenant/i)).not.toBeInTheDocument();
  });

  it('submits only { email, password } to the platform login endpoint and redirects to /platform', async () => {
    mockedFetch.mockResolvedValueOnce(OK);
    render(<PlatformLoginForm />);
    typeCredentials();
    submit();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/platform'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/platform/auth/login', {
      method: 'POST',
      body: { email: 'root@platform.example', password: 'a-long-password' },
    });
    const [, options] = mockedFetch.mock.calls.at(-1)!;
    expect(Object.keys((options as { body: object }).body)).toEqual(['email', 'password']);
  });

  it('honours a safe returnTo', async () => {
    searchParams = new URLSearchParams('returnTo=/platform/tenants');
    mockedFetch.mockResolvedValueOnce(OK);
    render(<PlatformLoginForm />);
    typeCredentials();
    submit();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/platform/tenants'));
  });

  it('ignores an off-site returnTo and falls back to /platform', async () => {
    searchParams = new URLSearchParams('returnTo=https://evil.example');
    mockedFetch.mockResolvedValueOnce(OK);
    render(<PlatformLoginForm />);
    typeCredentials();
    submit();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/platform'));
  });

  it('shows one generic, safe error on a failed login and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid email or password.', undefined),
    );
    render(<PlatformLoginForm />);
    typeCredentials();
    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password.');
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('never echoes a 5xx body', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(500, 'INTERNAL', 'stack trace at Object.<anonymous>', undefined),
    );
    render(<PlatformLoginForm />);
    typeCredentials();
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).not.toHaveTextContent(/stack trace/i);
    expect(alert).toHaveTextContent(/something went wrong/i);
  });

  it('does not fire a second request on a double submit', async () => {
    let resolveLogin: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(
      () => new Promise((resolve) => { resolveLogin = resolve; }),
    );
    render(<PlatformLoginForm />);
    typeCredentials();
    const button = screen.getByRole('button', { name: /sign in/i });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockedFetch.mock.calls.filter(([p]) => p === '/api/v1/platform/auth/login')).toHaveLength(1);
    resolveLogin(OK);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });
});
