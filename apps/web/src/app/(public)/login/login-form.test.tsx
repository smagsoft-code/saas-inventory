import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

async function renderForm(): Promise<void> {
  render(<LoginForm />);
  // The silent-restore attempt on mount resolves first; wait for the form to appear.
  await screen.findByRole('button', { name: /sign in/i });
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    searchParams = new URLSearchParams();
    // Default: the silent session-restore refresh fails, so the form renders.
    mockedFetch.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED', 'no session', undefined));
  });

  it('shows the form after the silent session check fails', async () => {
    await renderForm();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('redirects to a valid returnTo without showing the form when the session is restored', async () => {
    searchParams = new URLSearchParams('returnTo=/users');
    mockedFetch.mockResolvedValueOnce(undefined);
    render(<LoginForm />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/users'));
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('ignores an off-site returnTo and falls back to /', async () => {
    searchParams = new URLSearchParams('returnTo=https://evil.example/phish');
    await renderForm();
    mockedFetch.mockResolvedValueOnce(undefined);
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@acme.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
  });

  it('submits tenantSlug/email/password and redirects on success', async () => {
    await renderForm();
    mockedFetch.mockResolvedValueOnce(undefined);

    fireEvent.change(screen.getByPlaceholderText('acme-corp'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@acme.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'a-long-password' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/auth/login', {
      method: 'POST',
      body: { tenantSlug: 'acme', email: 'admin@acme.com', password: 'a-long-password' },
    });
  });

  it('shows one generic error on failed login', async () => {
    await renderForm();
    mockedFetch.mockRejectedValueOnce(
      new ApiError(401, 'UNAUTHORIZED', 'Invalid tenant, email, or password.', undefined),
    );

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid tenant, email, or password.',
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
